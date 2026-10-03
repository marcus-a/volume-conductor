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

  return { getVolume, setVolume, DEFAULT_VOLUME, getTheme, setTheme, DEFAULT_THEME };
});
