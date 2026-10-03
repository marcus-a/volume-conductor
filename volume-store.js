(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.VolumeStore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_VOLUME = 100;

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

  return { getVolume, setVolume, DEFAULT_VOLUME };
});
