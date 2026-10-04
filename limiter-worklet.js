// Lookahead brickwall limiter with an optional auto mode.
//
// Manual: output never exceeds `ceiling` (linear amplitude).
//
// Auto: the processor learns the "normal" level of what's playing (75th percentile of
// 100 ms blocks over the last 60 s, ignoring silence) and holds sudden loud sounds
// to normal + `headroom` dB. From 1 s to 10 s it uses the rough level heard so far
// with no headroom (strictest), then switches to the chosen headroom. Two checks
// against that limit: the peak level (instant, via the lookahead) and a 100 ms
// loudness level (same window as the learned blocks), so a dense noise squashed to
// the same peak can't still feel louder than normal.
//
// The input arrives after the user's volume boost (`volumeDb`). The normal level is
// learned with the boost taken back out, so changing the volume moves the auto
// ceiling with it immediately instead of being "undone" until it relearns.
//
// Gain: for every incoming sample we compute the gain it needs, take the minimum
// of that over the last L+1 samples, then box-average those minimums over L+1
// samples. Every value in that average already covers the sample leaving the delay
// line, so the gain applied to it is always low enough, while the averaging turns
// the gain change into a smooth ramp.

const BLOCK_SEC = 0.1;
const PROVISIONAL_BLOCKS = 10; // 1 s: start limiting at +0 dB on what's been heard so far
const LEARN_MIN_BLOCKS = 100; // 10 s: normal level trusted, user headroom applies
const LEARN_MAX_BLOCKS = 600; // 60 s
const SILENCE_DB = -60;
const NORMAL_PERCENTILE = 0.75;

const toDb = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fromDb = (db) => Math.pow(10, db / 20);

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

class BrickwallLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Default far above any real signal = effectively off.
      { name: "ceiling", defaultValue: 1e6, minValue: 0, automationRate: "k-rate" },
      { name: "auto", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "headroom", defaultValue: 10, minValue: 0, automationRate: "k-rate" },
      { name: "volumeDb", defaultValue: 0, minValue: -100, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.lookahead = Math.max(1, Math.round(sampleRate * 0.005));
    this.window = this.lookahead + 1;
    this.releaseCoef = 1 - Math.exp(-1 / (sampleRate * 0.1));
    this.channels = 0;
    this.delay = [];
    // Ceiling in force when each delayed sample came in, for the final clamp. Clamping
    // at the newest ceiling would hard-clip audio already in the pipeline when it drops.
    this.ceilingDelay = new Float32Array(this.lookahead).fill(Infinity);
    this.delayPos = 0;
    this.n = 0;
    // Monotonic deque of (sample index, required gain) for the sliding minimum.
    this.dqIdx = new Float64Array(this.window + 1);
    this.dqVal = new Float32Array(this.window + 1);
    this.dqHead = 0;
    this.dqLen = 0;
    this.box = new Float32Array(this.window).fill(1);
    this.boxPos = 0;
    this.boxSum = this.window;
    this.gain = 1;

    // Learning the normal level, in 100 ms blocks.
    this.blockSize = Math.round(sampleRate * BLOCK_SEC);
    this.blockPos = 0;
    this.blockPeak = 0;
    this.blockSquares = 0;
    this.peakHistory = []; // dB, volume boost removed
    this.loudHistory = [];
    this.normalPeakDb = null;
    this.normalLoudDb = null;

    // Sliding 100 ms loudness, matching the block length the normal level is learned from.
    this.squareRing = new Float64Array(this.blockSize);
    this.squareRingPos = 0;
    this.squareSum = 0;
  }

  resetChannels(count) {
    this.channels = count;
    this.delay = Array.from({ length: count }, () => new Float32Array(this.lookahead));
  }

  // [peak ceiling, loudness ceiling] as linear amplitudes, for audio after the volume boost.
  limits(ceiling, auto, headroom, volumeDb) {
    if (!auto) return [ceiling, Infinity];
    if (this.normalPeakDb === null) return [1, Infinity]; // first second: just stop clipping
    const h = this.peakHistory.length >= LEARN_MIN_BLOCKS ? headroom : 0;
    return [
      Math.min(1, fromDb(this.normalPeakDb + volumeDb + h)),
      fromDb(this.normalLoudDb + volumeDb + h),
    ];
  }

  // Called every 100 ms of audio: feeds the block into the normal-level history.
  endBlock(volumeDb) {
    const loudDb = toDb(Math.sqrt(this.blockSquares / this.blockSize)) - volumeDb;
    if (loudDb > SILENCE_DB) {
      this.peakHistory.push(toDb(this.blockPeak) - volumeDb);
      this.loudHistory.push(loudDb);
      if (this.peakHistory.length > LEARN_MAX_BLOCKS) {
        this.peakHistory.shift();
        this.loudHistory.shift();
      }
      if (this.peakHistory.length >= PROVISIONAL_BLOCKS) {
        this.normalPeakDb = percentile(this.peakHistory, NORMAL_PERCENTILE);
        this.normalLoudDb = percentile(this.loudHistory, NORMAL_PERCENTILE);
      }
    }
    this.blockPos = 0;
    this.blockPeak = 0;
    this.blockSquares = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (input.length === 0) return true;
    if (input.length !== this.channels) this.resetChannels(input.length);

    const ceiling = parameters.ceiling[0];
    const auto = parameters.auto[0] >= 0.5;
    const headroom = parameters.headroom[0];
    const volumeDb = parameters.volumeDb[0];
    let [peakCeiling, loudCeiling] = this.limits(ceiling, auto, headroom, volumeDb);
    const cap = this.window + 1;
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      let squares = 0;
      for (let ch = 0; ch < this.channels; ch++) {
        const s = input[ch][i];
        const a = Math.abs(s);
        if (a > peak) peak = a;
        squares += s * s;
      }
      squares /= this.channels;
      this.squareSum += squares - this.squareRing[this.squareRingPos];
      this.squareRing[this.squareRingPos] = squares;
      this.squareRingPos = (this.squareRingPos + 1) % this.blockSize;
      const loudness = Math.sqrt(Math.max(0, this.squareSum) / this.blockSize);

      let required = peak > peakCeiling ? peakCeiling / peak : 1;
      if (loudness > loudCeiling) required = Math.min(required, loudCeiling / loudness);

      // Sliding minimum over the last `window` samples.
      while (this.dqLen > 0 && this.dqVal[(this.dqHead + this.dqLen - 1) % cap] >= required) this.dqLen--;
      const back = (this.dqHead + this.dqLen) % cap;
      this.dqIdx[back] = this.n;
      this.dqVal[back] = required;
      this.dqLen++;
      if (this.dqIdx[this.dqHead] <= this.n - this.window) {
        this.dqHead = (this.dqHead + 1) % cap;
        this.dqLen--;
      }
      const windowMin = this.dqVal[this.dqHead];

      // Box average of the minimums.
      this.boxSum += windowMin - this.box[this.boxPos];
      this.box[this.boxPos] = windowMin;
      this.boxPos = (this.boxPos + 1) % this.window;
      const smoothed = Math.min(1, this.boxSum / this.window);

      // Attack instantly to the smoothed value, release slowly, never above it.
      this.gain = smoothed < this.gain ? smoothed : this.gain + (smoothed - this.gain) * this.releaseCoef;

      // Final clamp only absorbs float rounding; the envelope does the real work.
      const clampAt = this.ceilingDelay[this.delayPos];
      this.ceilingDelay[this.delayPos] = peakCeiling;
      for (let ch = 0; ch < this.channels; ch++) {
        const delayed = this.delay[ch][this.delayPos];
        this.delay[ch][this.delayPos] = input[ch][i];
        const out = delayed * this.gain;
        output[ch][i] = out > clampAt ? clampAt : out < -clampAt ? -clampAt : out;
      }
      this.delayPos = (this.delayPos + 1) % this.lookahead;
      this.n++;

      if (peak > this.blockPeak) this.blockPeak = peak;
      this.blockSquares += squares;
      if (++this.blockPos === this.blockSize) {
        const blockPeakDb = toDb(this.blockPeak);
        this.endBlock(volumeDb);
        [peakCeiling, loudCeiling] = this.limits(ceiling, auto, headroom, volumeDb);
        // Levels reported after the volume boost, to line up with the popup's meter.
        this.port.postMessage({
          learnedSec: this.peakHistory.length * BLOCK_SEC,
          ready: this.peakHistory.length >= LEARN_MIN_BLOCKS,
          normalDb: this.normalPeakDb === null ? null : this.normalPeakDb + volumeDb,
          ceilingDb: toDb(peakCeiling),
          blockPeakDb,
        });
      }
    }
    return true;
  }
}

registerProcessor("brickwall-limiter", BrickwallLimiter);
