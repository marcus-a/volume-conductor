(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.VolumeStore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_VOLUME = 100;
  const DEFAULT_THEME = "auto";
  const THEME_KEY = "volumeConductor:theme";
  // mode "manual": fixed ceiling (dBFS). mode "auto": ceiling follows the learned normal level + headroom (dB).
  const DEFAULT_LIMITER = { enabled: false, mode: "manual", ceiling: -6, headroom: 10 };

  // hostname null = the global limiter. Hostnames never contain this prefix, so no collision with volume keys.
  function limiterKey(hostname) {
    return hostname ? `volumeConductor:limiter:${hostname}` : "volumeConductor:limiter";
  }

  function getLimiter(hostname) {
    const key = limiterKey(hostname);
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        const v = result[key];
        const valid = v && typeof v.enabled === "boolean" && typeof v.ceiling === "number";
        if (!valid) return resolve({ ...DEFAULT_LIMITER });
        // Older saves have no mode/headroom; fill those in from the defaults.
        resolve({
          ...DEFAULT_LIMITER,
          ...v,
          mode: v.mode === "auto" ? "auto" : "manual",
          headroom: typeof v.headroom === "number" ? v.headroom : DEFAULT_LIMITER.headroom,
        });
      });
    });
  }

  function setLimiter(hostname, limiter) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [limiterKey(hostname)]: limiter }, resolve);
    });
  }

  // Limiter settings to apply, or null for no limiting. A ticked site setting wins over the global one.
  function resolveLimiter(site, global) {
    if (site.enabled) return site;
    if (global.enabled) return global;
    return null;
  }

  function getVolume(hostname) {
    return new Promise((resolve) => {
      chrome.storage.local.get(hostname, (result) => {
        resolve(typeof result[hostname] === "number" ? result[hostname] : DEFAULT_VOLUME);
      });
    });
  }

  function setVolume(hostname, volume) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [hostname]: volume }, resolve);
    });
  }

  function getTheme() {
    return new Promise((resolve) => {
      chrome.storage.local.get(THEME_KEY, (result) => {
        resolve(typeof result[THEME_KEY] === "string" ? result[THEME_KEY] : DEFAULT_THEME);
      });
    });
  }

  function setTheme(theme) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [THEME_KEY]: theme }, resolve);
    });
  }

  return {
    getVolume, setVolume, DEFAULT_VOLUME, getTheme, setTheme, DEFAULT_THEME,
    getLimiter, setLimiter, limiterKey, resolveLimiter, DEFAULT_LIMITER,
  };
});
