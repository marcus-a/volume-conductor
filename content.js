(function () {
  const graphsByElement = new WeakMap();
  let audioContext = null;
  let currentVolume = VolumeStore.DEFAULT_VOLUME;

  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }

  function applyGain(mediaElement, volumePercent) {
    const existing = graphsByElement.get(mediaElement);
    if (existing) {
      if (existing.fallback) {
        mediaElement.volume = Math.min(1, Math.max(0, volumePercent / 100));
      } else {
        existing.gainNode.gain.value = volumePercent / 100;
      }
      return;
    }

    if (!existing && volumePercent === VolumeStore.DEFAULT_VOLUME) {
      return;
    }

    try {
      const ctx = getAudioContext();
      const source = ctx.createMediaElementSource(mediaElement);
      const gainNode = ctx.createGain();
      gainNode.gain.value = volumePercent / 100;
      source.connect(gainNode).connect(ctx.destination);
      graphsByElement.set(mediaElement, { gainNode, source });

      mediaElement.addEventListener("play", () => {
        if (ctx.state === "suspended") {
          ctx.resume();
        }
      });
    } catch (err) {
      // Cross-origin media without CORS headers, or other Web Audio failure.
      // Fall back to native volume (0-100% only, no boost for this element).
      mediaElement.volume = Math.min(1, Math.max(0, volumePercent / 100));
      graphsByElement.set(mediaElement, { fallback: true });
    }
  }

  function applyToAllMedia(volumePercent) {
    currentVolume = volumePercent;
    document.querySelectorAll("video, audio").forEach((el) => applyGain(el, volumePercent));
  }

  function watchForNewMedia() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("video, audio")) {
            applyGain(node, currentVolume);
          }
          node.querySelectorAll?.("video, audio").forEach((el) => applyGain(el, currentVolume));
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "setVolume") {
      applyToAllMedia(message.volume);
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    const change = changes[location.hostname];
    if (change) {
      applyToAllMedia(typeof change.newValue === "number" ? change.newValue : VolumeStore.DEFAULT_VOLUME);
    }
  });

  document.addEventListener("click", () => {
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  }, { once: true, capture: true });

  // Attach the observer before the storage read resolves, so media elements
  // inserted during that async gap are still caught (and corrected once the
  // real stored volume arrives via the applyToAllMedia call below).
  watchForNewMedia();

  VolumeStore.getVolume(location.hostname).then((volume) => {
    applyToAllMedia(volume);
  });
})();
