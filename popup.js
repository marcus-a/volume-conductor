(async function () {
  const mainViewEl = document.getElementById("main-view");
  const settingsViewEl = document.getElementById("settings-view");
  const settingsBtnEl = document.getElementById("settings-btn");
  const backBtnEl = document.getElementById("back-btn");
  const themeRadios = document.querySelectorAll('input[name="theme"]');

  const hostnameEl = document.getElementById("hostname");
  const valueEl = document.getElementById("value");
  const valueEditEl = document.getElementById("value-edit");
  const valueInputEl = document.getElementById("value-input");
  const sliderEl = document.getElementById("slider");
  const disabledMessageEl = document.getElementById("disabled-message");

  const limiterSectionEl = document.getElementById("limiter-section");
  const limiterToggleEl = document.getElementById("limiter-toggle");
  const limiterValueEl = document.getElementById("limiter-value");
  const limiterControlsEl = document.getElementById("limiter-controls");
  const limiterSliderEl = document.getElementById("limiter-slider");
  const meterStatusEl = document.getElementById("meter-status");
  const peakMarkerEl = document.getElementById("peak-marker");
  const peakLabelEl = document.getElementById("peak-label");
  const limiterGlobalHintEl = document.getElementById("limiter-global-hint");
  const limiterModeRadios = document.querySelectorAll('input[name="limiter-mode"]');
  const limiterModeRowEl = document.getElementById("limiter-mode-row");
  const baseMarkerEl = document.getElementById("base-marker");
  const headroomRowEl = document.getElementById("headroom-row");
  const headroomSliderEl = document.getElementById("headroom-slider");
  const headroomValueEl = document.getElementById("headroom-value");

  const globalToggleEl = document.getElementById("global-limiter-toggle");
  const globalValueEl = document.getElementById("global-limiter-value");
  const globalControlsEl = document.getElementById("global-limiter-controls");
  const globalSliderEl = document.getElementById("global-limiter-slider");
  const globalModeRadios = document.querySelectorAll('input[name="global-limiter-mode"]');
  const globalCeilingRowEl = document.getElementById("global-ceiling-row");
  const globalHeadroomRowEl = document.getElementById("global-headroom-row");
  const globalHeadroomSliderEl = document.getElementById("global-headroom-slider");
  const globalHeadroomValueEl = document.getElementById("global-headroom-value");

  const METER_MIN_DB = -60;
  const THUMB_PX = 14;
  const PEAK_HOLD_MS = 1500;

  // Position along a range input's track that lines up with the thumb center at fraction f.
  function trackPos(f) {
    return f <= 0 ? "0px" : `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${f})`;
  }

  function dbFraction(db) {
    return Math.min(1, Math.max(0, (db - METER_MIN_DB) / -METER_MIN_DB));
  }

  function fillTrack(sliderEl) {
    const f = (sliderEl.value - sliderEl.min) / (sliderEl.max - sliderEl.min);
    sliderEl.style.setProperty("--track",
      `linear-gradient(to right, var(--accent) ${trackPos(f)}, var(--border) ${trackPos(f)})`);
  }

  function limiterSummary(limiter) {
    return limiter.mode === "auto" ? `auto +${limiter.headroom} dB` : `${limiter.ceiling} dB`;
  }

  let globalLimiter = await VolumeStore.getLimiter(null);

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

  function renderGlobalLimiter() {
    const auto = globalLimiter.mode === "auto";
    globalToggleEl.checked = globalLimiter.enabled;
    globalControlsEl.hidden = !globalLimiter.enabled;
    for (const radio of globalModeRadios) radio.checked = radio.value === globalLimiter.mode;
    globalCeilingRowEl.hidden = auto;
    globalHeadroomRowEl.hidden = !auto;
    globalSliderEl.value = globalLimiter.ceiling;
    globalHeadroomSliderEl.value = globalLimiter.headroom;
    globalHeadroomValueEl.textContent = `+${globalLimiter.headroom} dB`;
    globalValueEl.textContent = globalLimiter.enabled ? limiterSummary(globalLimiter) : "";
    fillTrack(globalSliderEl);
    fillTrack(globalHeadroomSliderEl);
  }

  async function saveGlobalLimiter(changes) {
    globalLimiter = { ...globalLimiter, ...changes };
    renderGlobalLimiter();
    renderSiteLimiter();
    await VolumeStore.setLimiter(null, globalLimiter);
  }

  globalToggleEl.addEventListener("change", () => saveGlobalLimiter({ enabled: globalToggleEl.checked }));
  globalSliderEl.addEventListener("input", () => saveGlobalLimiter({ ceiling: Number(globalSliderEl.value) }));
  globalHeadroomSliderEl.addEventListener("input", () => saveGlobalLimiter({ headroom: Number(globalHeadroomSliderEl.value) }));
  for (const radio of globalModeRadios) {
    radio.addEventListener("change", () => radio.checked && saveGlobalLimiter({ mode: radio.value }));
  }
  renderGlobalLimiter();

  // Replaced once the site limiter is loaded; called by saveGlobalLimiter to refresh the hint.
  let renderSiteLimiter = () => {};

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
    limiterSectionEl.hidden = true;
    disabledMessageEl.hidden = false;
    hostnameEl.textContent = "Volume Conductor";
    return;
  }

  hostnameEl.textContent = hostname.replace(/^www\./, "");

  const volume = await VolumeStore.getVolume(hostname);
  sliderEl.value = volume;
  valueEl.textContent = `${volume}%`;
  fillTrack(sliderEl);

  async function applyVolume(newVolume) {
    sliderEl.value = newVolume;
    valueEl.textContent = `${newVolume}%`;
    fillTrack(sliderEl);
    await VolumeStore.setVolume(hostname, newVolume);
    chrome.tabs.sendMessage(tab.id, { type: "setVolume", volume: newVolume }).catch(() => {});
  }

  sliderEl.addEventListener("input", () => {
    applyVolume(Number(sliderEl.value));
  });

  function sizeValueInput() {
    valueInputEl.style.width = Math.max(1, String(valueInputEl.value).length) + "ch";
  }

  valueEl.addEventListener("click", () => {
    valueInputEl.value = sliderEl.value;
    sizeValueInput();
    valueEl.hidden = true;
    valueEditEl.hidden = false;
    valueInputEl.focus();
    valueInputEl.select();
  });

  valueInputEl.addEventListener("input", sizeValueInput);

  function commitValueEdit() {
    const parsed = Math.round(Number(valueInputEl.value));
    const clamped = Number.isFinite(parsed) ? Math.min(500, Math.max(0, parsed)) : Number(sliderEl.value);
    valueEditEl.hidden = true;
    valueEl.hidden = false;
    applyVolume(clamped);
  }

  valueInputEl.addEventListener("blur", commitValueEdit);
  valueInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      valueInputEl.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      valueEditEl.hidden = true;
      valueEl.hidden = false;
    }
  });

  let siteLimiter = await VolumeStore.getLimiter(hostname);
  // A never-touched site starts from the global settings rather than the built-in defaults.
  if (JSON.stringify(siteLimiter) === JSON.stringify(VolumeStore.DEFAULT_LIMITER)) {
    siteLimiter = { ...globalLimiter, enabled: false };
  }
  let latestStats = null; // from the page's worklet: learned normal level, live auto ceiling
  const frameReports = new Map(); // iframe id -> { level, at }: embedded players report separately

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "frameLevel" && sender.tab && sender.tab.id === tab.id) {
      frameReports.set(sender.frameId, { level: message.level, at: Date.now() });
    }
  });

  // Combine the top page's level with any iframe reports from the last few polls.
  function mergeLevels(levels) {
    return levels.reduce((acc, l) => ({
      peakDb: l.peakDb === null ? acc.peakDb : acc.peakDb === null ? l.peakDb : Math.max(acc.peakDb, l.peakDb),
      playing: acc.playing + l.playing,
      blocked: acc.blocked + l.blocked,
      stats: l.stats && (!acc.stats || l.stats.learnedSec > acc.stats.learnedSec) ? l.stats : acc.stats,
      workletFailed: acc.workletFailed || l.workletFailed,
    }));
  }

  // The limiter that applies to this site: its own if ticked, else the global one, else none.
  function activeLimiter() {
    if (siteLimiter.enabled) return siteLimiter;
    return globalLimiter.enabled ? globalLimiter : null;
  }
  let shownPeakDb = null;
  let holdDb = null;
  let holdAt = 0;
  let meterStatus = "";

  // Auto mode's ceiling moves with the learned normal level; 0 dB until the first second is heard.
  function effectiveCeiling() {
    const active = activeLimiter();
    if (!active) return 0;
    if (active.mode !== "auto") return active.ceiling;
    return latestStats && latestStats.normalDb !== null ? latestStats.ceilingDb : 0;
  }

  function paintMeter() {
    const active = activeLimiter();
    const ceiling = effectiveCeiling();
    if (active && active.mode === "auto") limiterSliderEl.value = Math.round(ceiling);
    const ceilingF = dbFraction(ceiling);
    const levelF = shownPeakDb === null ? 0 : dbFraction(shownPeakDb);
    const a = trackPos(Math.min(levelF, ceilingF));
    const b = trackPos(levelF);
    limiterSliderEl.style.setProperty("--track",
      `linear-gradient(to right, var(--meter) ${a}, var(--over) ${a} ${b}, var(--border) ${b})`);
    meterStatusEl.textContent = meterStatus;
    peakMarkerEl.hidden = holdDb === null;
    if (holdDb !== null) {
      const f = dbFraction(holdDb);
      peakMarkerEl.style.left = trackPos(f);
      peakMarkerEl.classList.toggle("over", holdDb > ceiling);
      // Slide the label from left-anchored to right-anchored so it never leaves the popup.
      peakLabelEl.style.transform = `translateX(${-f * 100}%)`;
      peakLabelEl.textContent = holdDb <= METER_MIN_DB ? `< ${METER_MIN_DB} dB` : `${Math.round(holdDb)} dB`;
    }
    const normalDb = latestStats ? latestStats.normalDb : null;
    baseMarkerEl.hidden = normalDb === null;
    if (normalDb !== null) baseMarkerEl.style.left = trackPos(dbFraction(normalDb));
  }

  renderSiteLimiter = function () {
    const own = siteLimiter.enabled;
    const active = activeLimiter();
    const auto = active !== null && active.mode === "auto";
    limiterToggleEl.checked = own;
    // The meter shows whenever a limiter applies here, including the global one;
    // the site's own controls only when it has its own limiter.
    limiterControlsEl.hidden = !active;
    limiterModeRowEl.hidden = !own;
    for (const radio of limiterModeRadios) radio.checked = radio.value === siteLimiter.mode;
    // Read-only when it shows the live auto ceiling or the global limiter's ceiling.
    limiterSliderEl.disabled = auto || !own;
    limiterSliderEl.title = auto ? "Current auto ceiling" : own ? "Ceiling (dBFS)" : "Global limiter ceiling";
    if (active && !auto) limiterSliderEl.value = active.ceiling;
    headroomRowEl.hidden = !(own && auto);
    headroomSliderEl.value = siteLimiter.headroom;
    headroomValueEl.textContent = `+${siteLimiter.headroom} dB`;
    fillTrack(headroomSliderEl);
    limiterValueEl.textContent = siteLimiter.enabled ? limiterSummary(siteLimiter) : "";
    limiterGlobalHintEl.hidden = siteLimiter.enabled || !globalLimiter.enabled;
    limiterGlobalHintEl.textContent = `Using global limiter (${limiterSummary(globalLimiter)})`;
    paintMeter();
  };

  async function saveSiteLimiter(changes) {
    siteLimiter = { ...siteLimiter, ...changes };
    renderSiteLimiter();
    await VolumeStore.setLimiter(hostname, siteLimiter);
  }

  limiterToggleEl.addEventListener("change", () => saveSiteLimiter({ enabled: limiterToggleEl.checked }));
  limiterSliderEl.addEventListener("input", () => saveSiteLimiter({ ceiling: Number(limiterSliderEl.value) }));
  headroomSliderEl.addEventListener("input", () => saveSiteLimiter({ headroom: Number(headroomSliderEl.value) }));
  for (const radio of limiterModeRadios) {
    radio.addEventListener("change", () => radio.checked && saveSiteLimiter({ mode: radio.value }));
  }
  renderSiteLimiter();

  // Poll the page's level while the meter is visible. Peaks fall back slowly so the bar doesn't flicker.
  setInterval(async () => {
    if (limiterControlsEl.hidden) return;
    const topLevel = await chrome.tabs.sendMessage(tab.id, { type: "getLevel" }).catch(() => null);
    const now = Date.now();
    for (const [frameId, report] of frameReports) if (now - report.at > 300) frameReports.delete(frameId);
    const response = topLevel && mergeLevels([topLevel, ...[...frameReports.values()].map((r) => r.level)]);
    const peakDb = response ? response.peakDb : null;
    latestStats = response ? response.stats : null;
    const active = activeLimiter();
    const auto = active !== null && active.mode === "auto";
    if (!response) meterStatus = "refresh this tab";
    else if (response.playing === 0 && response.blocked > 0) meterStatus = "can't read this player";
    else if (response.playing === 0) meterStatus = "no audio playing";
    else if (auto && response.workletFailed) meterStatus = "auto unavailable on this site";
    else if (auto && !(latestStats && latestStats.ready)) {
      meterStatus = `learning ${Math.floor(latestStats ? latestStats.learnedSec : 0)} / 10 s, +0 dB`;
    } else if (latestStats && latestStats.ready) meterStatus = `normal ${Math.round(latestStats.normalDb)} dB`;
    else meterStatus = "";

    if (peakDb !== null && (holdDb === null || peakDb >= holdDb || now - holdAt > PEAK_HOLD_MS)) {
      holdDb = peakDb;
      holdAt = now;
    } else if (peakDb === null && now - holdAt > PEAK_HOLD_MS) {
      holdDb = null;
    }
    let next = shownPeakDb === null ? null : shownPeakDb - 1;
    if (peakDb !== null && (next === null || peakDb > next)) next = peakDb;
    if (next !== null && next <= METER_MIN_DB) next = null;
    shownPeakDb = next;
    paintMeter();
  }, 50);
})();
