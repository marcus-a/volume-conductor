(async function () {
  const mainViewEl = document.getElementById("main-view");
  const settingsViewEl = document.getElementById("settings-view");
  const settingsBtnEl = document.getElementById("settings-btn");
  const backBtnEl = document.getElementById("back-btn");
  const themeRadios = document.querySelectorAll('input[name="theme"]');

  const hostnameEl = document.getElementById("hostname");
  const valueEl = document.getElementById("value");
  const sliderEl = document.getElementById("slider");
  const disabledMessageEl = document.getElementById("disabled-message");

  let themePref = await VolumeStore.getTheme();
  const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function applyResolvedTheme() {
    const resolved = themePref === "auto" ? (darkMediaQuery.matches ? "dark" : "light") : themePref;
    document.documentElement.dataset.theme = resolved;
  }

  applyResolvedTheme();
  for (const radio of themeRadios) {
    radio.checked = radio.value === themePref;
  }

  darkMediaQuery.addEventListener("change", () => {
    if (themePref === "auto") applyResolvedTheme();
  });

  for (const radio of themeRadios) {
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      themePref = radio.value;
      applyResolvedTheme();
      await VolumeStore.setTheme(themePref);
    });
  }

  settingsBtnEl.addEventListener("click", () => {
    mainViewEl.hidden = true;
    settingsViewEl.hidden = false;
  });

  backBtnEl.addEventListener("click", () => {
    settingsViewEl.hidden = true;
    mainViewEl.hidden = false;
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let hostname = null;
  try {
    const u = new URL(tab.url);
    hostname = (u.protocol === "http:" || u.protocol === "https:") ? u.hostname : null;
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

  hostnameEl.textContent = hostname.replace(/^www\./, "");

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
