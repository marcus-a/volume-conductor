(async function () {
  const hostnameEl = document.getElementById("hostname");
  const valueEl = document.getElementById("value");
  const sliderEl = document.getElementById("slider");
  const disabledMessageEl = document.getElementById("disabled-message");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let hostname = null;
  try {
    hostname = new URL(tab.url).hostname || null;
  } catch (err) {
    hostname = null;
  }

  if (!hostname) {
    sliderEl.hidden = true;
    valueEl.hidden = true;
    disabledMessageEl.hidden = false;
    hostnameEl.textContent = "Volume Conductor";
    return;
  }

  hostnameEl.textContent = hostname;

  const volume = await VolumeStore.getVolume(hostname);
  sliderEl.value = volume;
  valueEl.textContent = `${volume}%`;

  sliderEl.addEventListener("input", async () => {
    const newVolume = Number(sliderEl.value);
    valueEl.textContent = `${newVolume}%`;
    await VolumeStore.setVolume(hostname, newVolume);
    chrome.tabs.sendMessage(tab.id, { type: "setVolume", volume: newVolume }).catch(() => {});
  });
})();
