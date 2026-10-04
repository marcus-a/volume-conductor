(function () {
  const graphsByElement = new WeakMap();
  const watchedElements = new WeakSet();
  let audioContext = null;
  let workletReady = null; // Promise<boolean>: brickwall limiter loaded into audioContext
  let workletFailed = false;
  let currentVolume = VolumeStore.DEFAULT_VOLUME;
  let currentLimiter = null; // { mode, ceiling, headroom } from VolumeStore, null = limiter off
  const LIMITER_RATIO = 20;

  // This script also runs inside iframes (embedded players). Settings belong to the
  // site in the tab's address bar, so look up the top-level page's hostname.
  const isTopFrame = window === window.top;
  const siteHost = (() => {
    const origins = location.ancestorOrigins;
    if (isTopFrame || !origins || origins.length === 0) return location.hostname;
    try {
      return new URL(origins[origins.length - 1]).hostname;
    } catch (err) {
      return location.hostname; // sandboxed frames report "null"
    }
  })();

  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // Some sites' CSP blocks the worklet; those keep the compressor (soft limit, can overshoot ~1 dB).
      workletReady = audioContext.audioWorklet
        .addModule(chrome.runtime.getURL("limiter-worklet.js"))
        .then(() => true, () => {
          workletFailed = true;
          return false;
        });
    }
    return audioContext;
  }

  // Media from another site, fetched without CORS, plays as silence once routed
  // through Web Audio. Those elements are left alone (native volume only).
  function canHook(mediaElement) {
    if (mediaElement.srcObject || mediaElement.crossOrigin) return true;
    const src = mediaElement.currentSrc || mediaElement.src;
    if (!src) return true;
    try {
      const url = new URL(src, location.href);
      return url.protocol === "blob:" || url.protocol === "data:" || url.origin === location.origin;
    } catch (err) {
      return false;
    }
  }

  // source -> gain -> compressor -> trim -> speakers, plus an analyser tap after
  // gain so the popup meter shows the level going into the limiter. Once the
  // worklet loads, the compressor + trim are swapped out for the brickwall limiter.
  function buildGraph(mediaElement) {
    try {
      const ctx = getAudioContext();
      const source = ctx.createMediaElementSource(mediaElement);
      const gainNode = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.knee.value = 0;
      compressor.attack.value = 0;
      compressor.release.value = 0.1;
      const trim = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(gainNode).connect(compressor).connect(trim).connect(ctx.destination);
      gainNode.connect(analyser);
      const graph = { source, gainNode, compressor, trim, analyser, brickwall: null, recentPeakDb: -Infinity };

      workletReady.then((ok) => {
        if (!ok) return;
        graph.brickwall = new AudioWorkletNode(ctx, "brickwall-limiter");
        // Every 100 ms: learned normal level, live auto ceiling, and that block's peak.
        // The peaks fill the gaps between the popup's analyser snapshots.
        graph.brickwall.port.onmessage = (event) => {
          graph.stats = event.data;
          graph.recentPeakDb = Math.max(graph.recentPeakDb, event.data.blockPeakDb);
        };
        // Disconnect first: both paths live at once could sum past the ceiling.
        gainNode.disconnect(compressor);
        gainNode.connect(graph.brickwall).connect(ctx.destination);
        applyLimiter(graph);
      });
      return graph;
    } catch (err) {
      // Web Audio refused this element.
      // Fall back to native volume (0-100% only, no boost or limiter for this element).
      return { fallback: true };
    }
  }

  function applyLimiter(graph) {
    const manual = currentLimiter !== null && currentLimiter.mode === "manual";
    if (graph.brickwall) {
      const params = graph.brickwall.parameters;
      params.get("ceiling").value = manual ? Math.pow(10, currentLimiter.ceiling / 20) : 1e6;
      params.get("auto").value = currentLimiter !== null && currentLimiter.mode === "auto" ? 1 : 0;
      params.get("headroom").value = currentLimiter ? currentLimiter.headroom : VolumeStore.DEFAULT_LIMITER.headroom;
      params.get("volumeDb").value = Math.max(-100, 20 * Math.log10(currentVolume / 100));
      return;
    }
    // Compressor fallback: manual ceiling, or for auto (which needs the worklet) just stop clipping at 0 dB.
    const on = currentLimiter !== null;
    const ratio = on ? LIMITER_RATIO : 1;
    const threshold = manual ? currentLimiter.ceiling : 0;
    graph.compressor.threshold.value = threshold;
    graph.compressor.ratio.value = ratio;
    // The compressor adds automatic makeup gain of 0.6 * (its gain reduction at 0 dBFS),
    // per the Web Audio spec. Trim it back off so the ceiling actually holds.
    const trimDb = 0.6 * threshold * (1 - 1 / ratio);
    graph.trim.gain.value = Math.pow(10, trimDb / 20);
  }

  // At 100% leave the player's own volume control alone, unless we changed it earlier.
  const nativeVolumeTouched = new WeakSet();
  function setNativeVolume(mediaElement) {
    if (currentVolume === VolumeStore.DEFAULT_VOLUME && !nativeVolumeTouched.has(mediaElement)) return;
    nativeVolumeTouched.add(mediaElement);
    mediaElement.volume = Math.min(1, Math.max(0, currentVolume / 100));
  }

  function applyAudio(mediaElement) {
    let graph = graphsByElement.get(mediaElement);
    if (!graph) {
      if (!watchedElements.has(mediaElement)) {
        watchedElements.add(mediaElement);
        // Hook on play, not on sight: a feed full of videos only pays for the ones
        // that actually play, and by then we know where the media comes from.
        mediaElement.addEventListener("play", () => {
          applyAudio(mediaElement);
          if (audioContext && audioContext.state === "suspended") audioContext.resume();
        });
      }
      if (mediaElement.paused) return;
      if (currentVolume === VolumeStore.DEFAULT_VOLUME && currentLimiter === null) return;
      if (!canHook(mediaElement)) {
        setNativeVolume(mediaElement);
        return;
      }
      graph = buildGraph(mediaElement);
      graphsByElement.set(mediaElement, graph);
    }

    if (graph.fallback) {
      setNativeVolume(mediaElement);
      return;
    }
    graph.gainNode.gain.value = currentVolume / 100;
    applyLimiter(graph);
  }

  function applyToAllMedia() {
    document.querySelectorAll("video, audio").forEach(applyAudio);
  }

  // Peak level (dBFS, null when silent) across playing media, plus counts so the
  // popup can explain an empty meter.
  function measureLevel() {
    let peakDb = -Infinity;
    let playing = 0;
    let blocked = 0;
    let stats = null;
    document.querySelectorAll("video, audio").forEach((el) => {
      if (el.paused) return;
      const graph = graphsByElement.get(el);
      if (!graph) {
        if (!canHook(el)) blocked++;
        return;
      }
      if (graph.fallback) {
        blocked++;
        return;
      }
      playing++;
      if (graph.stats && graph.stats.learnedSec >= (stats?.learnedSec ?? 0)) stats = graph.stats;
      const buf = new Float32Array(graph.analyser.fftSize);
      graph.analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const sample of buf) peak = Math.max(peak, Math.abs(sample));
      peakDb = Math.max(peakDb, 20 * Math.log10(peak), graph.recentPeakDb);
      graph.recentPeakDb = -Infinity;
    });
    return { peakDb: Number.isFinite(peakDb) ? peakDb : null, playing, blocked, stats, workletFailed };
  }

  async function refreshLimiter() {
    const [site, global] = await Promise.all([
      VolumeStore.getLimiter(siteHost),
      VolumeStore.getLimiter(null),
    ]);
    currentLimiter = VolumeStore.resolveLimiter(site, global);
    applyToAllMedia();
  }

  function watchForNewMedia() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("video, audio")) {
            applyAudio(node);
          }
          node.querySelectorAll?.("video, audio").forEach(applyAudio);
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "setVolume") {
      currentVolume = message.volume;
      applyToAllMedia();
    } else if (message.type === "getLevel") {
      const level = measureLevel();
      if (isTopFrame) {
        sendResponse(level);
      } else if (level.playing > 0 || level.blocked > 0) {
        // Only the first sendResponse reaches the popup, so iframes report separately.
        chrome.runtime.sendMessage({ type: "frameLevel", level }).catch(() => {});
      }
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    const change = changes[siteHost];
    if (change) {
      currentVolume = typeof change.newValue === "number" ? change.newValue : VolumeStore.DEFAULT_VOLUME;
      applyToAllMedia();
    }
    if (changes[VolumeStore.limiterKey(siteHost)] || changes[VolumeStore.limiterKey(null)]) {
      refreshLimiter();
    }
  });

  document.addEventListener("click", () => {
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  }, { once: true, capture: true });

  // Attach the observer before the storage read resolves, so media elements
  // inserted during that async gap are still caught (and corrected once the
  // real stored settings arrive below).
  watchForNewMedia();

  VolumeStore.getVolume(siteHost).then((volume) => {
    currentVolume = volume;
    return refreshLimiter();
  });
})();
