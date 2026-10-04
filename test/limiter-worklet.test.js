const assert = require("node:assert");
const test = require("node:test");

function loadLimiter() {
  let Processor;
  global.sampleRate = 48000;
  global.AudioWorkletProcessor = class {
    constructor() {
      this.port = { postMessage: (msg) => { this.lastMessage = msg; } };
    }
  };
  global.registerProcessor = (name, cls) => { Processor = cls; };
  delete require.cache[require.resolve("../limiter-worklet.js")];
  require("../limiter-worklet.js");
  return new Processor();
}

// Runs a stereo signal through the processor in 128-frame blocks, like the browser does.
function run(limiter, left, right, ceiling, auto = 0, headroom = 6, volumeDb = 0) {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  for (let start = 0; start < left.length; start += 128) {
    const end = start + 128;
    const output = [[outL.subarray(start, end), outR.subarray(start, end)]];
    limiter.process([[left.subarray(start, end), right.subarray(start, end)]], output, { ceiling: [ceiling], auto: [auto], headroom: [headroom], volumeDb: [volumeDb] });
  }
  return [outL, outR];
}

test("output never exceeds the ceiling, including sudden spikes", () => {
  const limiter = loadLimiter();
  const ceiling = Math.pow(10, -6 / 20);
  const n = 48000;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const spike = i % 4801 === 0 ? 5 : 1; // 5x full-scale single-sample transients
    left[i] = rand() * 0.2 * spike;
    right[i] = rand() * (i > n / 2 ? 5 : 0.3); // sudden jump to +14 dB (500% boost)
  }
  const [outL, outR] = run(limiter, left, right, ceiling);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(outL[i]) <= ceiling && Math.abs(outR[i]) <= ceiling, `sample ${i} over ceiling`);
  }
});

test("limits by smooth gain, not by clipping the waveform", () => {
  const limiter = loadLimiter();
  const ceiling = 0.25;
  const n = 48000;
  const sine = new Float32Array(n);
  for (let i = 0; i < n; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
  const [out] = run(limiter, sine, sine, ceiling);
  const lookahead = limiter.lookahead;
  // Once settled, output is the delayed sine scaled to the ceiling.
  for (let i = n / 2; i < n; i++) {
    assert.ok(Math.abs(out[i] - sine[i - lookahead] * ceiling) < 1e-3, `sample ${i} distorted`);
  }
});

test("passes audio through untouched when below the ceiling", () => {
  const limiter = loadLimiter();
  const n = 4800;
  const quiet = new Float32Array(n).map((_, i) => 0.1 * Math.sin(i / 10));
  const [out] = run(limiter, quiet, quiet, 1e6);
  for (let i = limiter.lookahead; i < n; i++) {
    assert.ok(Math.abs(out[i] - quiet[i - limiter.lookahead]) < 1e-6);
  }
});

test("auto mode holds a sudden loud burst near the learned normal level", () => {
  const limiter = loadLimiter();
  const rate = 48000;
  const normalSec = 20;
  const n = rate * (normalSec + 1);
  const signal = new Float32Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    // Talking-ish: noise at ~-20 dB with a slow wobble, then a 1 s blast near full scale.
    const level = i < rate * normalSec ? 0.1 * (0.6 + 0.4 * Math.sin(i / 5000)) : 0.9;
    signal[i] = rand() * level;
  }

  // First second: nothing to compare against yet, so audio passes untouched.
  const [first] = run(limiter, signal.subarray(0, rate), signal.subarray(0, rate), 1e6, 1, 6);
  for (let i = limiter.lookahead; i < rate - 128; i++) {
    assert.ok(Math.abs(first[i] - signal[i - limiter.lookahead]) < 1e-6);
  }
  // 1 s to 10 s: limits at the rough normal level with +0 dB, ignoring the 6 dB setting.
  run(limiter, signal.subarray(rate, rate * 5), signal.subarray(rate, rate * 5), 1e6, 1, 6);
  assert.strictEqual(limiter.lastMessage.ready, false);
  assert.ok(limiter.lastMessage.normalDb !== null);
  assert.ok(Math.abs(limiter.lastMessage.ceilingDb - limiter.lastMessage.normalDb) < 1e-6);

  const rest = signal.subarray(rate * 5);
  const [out] = run(limiter, rest, rest, 1e6, 1, 6);
  assert.strictEqual(limiter.lastMessage.ready, true);

  const blastStart = rate * (normalSec - 5) + limiter.lookahead;
  const peakLimit = Math.pow(10, (limiter.normalPeakDb + 6) / 20);
  const loudLimitDb = limiter.normalLoudDb + 6;
  let blastPeak = 0;
  let blastSquares = 0;
  for (let i = blastStart; i < out.length; i++) {
    blastPeak = Math.max(blastPeak, Math.abs(out[i]));
    blastSquares += out[i] * out[i];
  }
  const blastLoudDb = 10 * Math.log10(blastSquares / (out.length - blastStart));
  assert.ok(blastPeak <= peakLimit, `blast peak ${blastPeak} over ${peakLimit}`);
  assert.ok(blastLoudDb <= loudLimitDb + 1, `blast loudness ${blastLoudDb} dB over ${loudLimitDb} dB`);
  // And it was a real blast: the input was ~19 dB louder than normal.
  assert.ok(20 * Math.log10(0.9 / Math.sqrt(3)) - limiter.normalLoudDb > 15);
});

function noise(n, level, seed = 3) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = (seed / 2147483647 * 2 - 1) * level;
  }
  return out;
}

test("auto mode: changing the volume moves the ceiling at once, no relearning", () => {
  const limiter = loadLimiter();
  const learn = noise(48000 * 15, 0.1);
  run(limiter, learn, learn, 1e6, 1, 3, 0);
  const before = limiter.lastMessage;
  assert.strictEqual(before.ready, true);

  // Same audio, now boosted +6 dB (200%) by the gain node in front of the limiter.
  const boosted = noise(48000, 0.2, 99);
  run(limiter, boosted, boosted, 1e6, 1, 3, 20 * Math.log10(2));
  const after = limiter.lastMessage;
  assert.ok(Math.abs(after.normalDb - before.normalDb - 6.02) < 0.5, `normal moved ${after.normalDb - before.normalDb} dB`);
  assert.ok(Math.abs(after.ceilingDb - before.ceilingDb - 6.02) < 0.5, `ceiling moved ${after.ceilingDb - before.ceilingDb} dB`);
});

test("lowering the ceiling doesn't hard-clip audio already in the lookahead", () => {
  const limiter = loadLimiter();
  const n = 4800;
  const sine = new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
  run(limiter, sine.subarray(0, 2400), sine.subarray(0, 2400), 1e6);
  const [out] = run(limiter, sine.subarray(2400), sine.subarray(2400), 0.25);
  // Audio that entered under the old ceiling ramps down instead of being chopped flat at 0.25.
  let transitionMax = 0;
  for (let i = 0; i < limiter.lookahead; i++) transitionMax = Math.max(transitionMax, Math.abs(out[i]));
  assert.ok(transitionMax > 0.3, `transition peaked at ${transitionMax}`);
  for (let i = limiter.lookahead; i < out.length; i++) assert.ok(Math.abs(out[i]) <= 0.25);
});

test("reports each 100 ms block's peak so the meter can't miss short bangs", () => {
  const limiter = loadLimiter();
  const quiet = new Float32Array(4800);
  quiet[1234] = 0.5; // a single-sample click
  run(limiter, quiet, quiet, 1e6);
  assert.ok(Math.abs(limiter.lastMessage.blockPeakDb - 20 * Math.log10(0.5)) < 1e-4);
});
