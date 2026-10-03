# Volume Conductor

A Chromium browser extension that boosts volume up to 500% and remembers
the level per site — automatically, across restarts.

Works like Volume Master, but instead of resetting every time you reload
a page or restart the browser, it remembers the volume you set for each
site and re-applies it the moment a video or audio element shows up.

## Features

- **Volume boost up to 500%** on any `<video>` or `<audio>` element, via
  a Web Audio `GainNode` — goes well past the native 100% ceiling.
- **Per-site memory.** Set youtube.com to 300% once; it stays 300% on
  every future visit, every tab, every browser restart. Other sites
  keep their own independent setting, defaulting to 100%.
- **Exact values.** Drag the slider for quick adjustments (5% steps),
  or click the percentage to type an exact number.
- **Light / Dark / Auto theme**, with Auto following your OS's
  `prefers-color-scheme` live.
- No account, no network requests, no tracking — everything is local
  to your browser (`chrome.storage.local`).

## Install

This isn't published to a web store — load it as an unpacked extension:

1. Download or clone this repository.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`,
   etc. — any Chromium-based browser works the same way).
3. Enable **Developer mode** (toggle, usually top right).
4. Click **Load unpacked** and select this folder.
5. Visit any site with audio/video, click the Volume Conductor icon in
   the toolbar, and drag the slider.

After editing the code, click the reload icon for the extension on the
extensions page, then refresh any open tab you're testing in — a
content script only re-injects on page load, not automatically when the
extension updates.

## Usage

- **Slider** — drag to adjust in steps of 5, 0 to 500%.
- **Click the `%` number** — type an exact value, Enter to confirm,
  Escape to cancel.
- **Gear icon** (top right) — opens Settings, where you can pick the
  popup's theme. The back chevron returns to the volume view.

## How it works

- A content script wires every `<video>`/`<audio>` element on the page
  into a Web Audio `MediaElementSource -> GainNode -> destination`
  graph. Gain is `volume / 100`, so 300% is a gain of 3.0. Elements
  stay on their native audio path untouched until a non-default volume
  is actually requested, and a dynamic-content watcher (`MutationObserver`)
  picks up players that load in later (SPA navigation, lazy-loaded
  embeds, ads).
- The volume you set is stored per hostname in `chrome.storage.local`,
  so it survives reloads and full browser restarts, and updates every
  open tab on that hostname live — not just the one you adjusted it from.
- If a page's own script already claims the media element for Web Audio
  (rare, but happens with some players' own visualizers/analyzers), the
  extension falls back to the native `volume` property for that element
  — capped at 100%, no boost, but no breakage either.
- The theme choice is global (not per-site), stored under a dedicated
  key that can't collide with any hostname's volume entry.

## Development

No build step — it's plain HTML/CSS/JS, loaded directly by the browser.

```bash
npm test
```

Runs the automated tests for the storage module (`volume-store.js`) via
Node's built-in test runner. The content script and popup are
DOM/Chrome-API/Web-Audio-dependent and are verified manually — see the
checklist below.

## Manual verification checklist

- [ ] Set youtube.com to 300%, confirm audible boost.
- [ ] Reload the page — 300% re-applies automatically.
- [ ] Restart the browser entirely, revisit youtube.com — 300% still applied.
- [ ] Visit a second site with audio/video — it defaults to 100%,
      independent of YouTube's setting.
- [ ] Navigate within YouTube to another video without a full page
      reload (SPA navigation) — the new `<video>` element picks up the
      hostname's stored volume.
- [ ] Open the popup in a second tab on the same hostname after
      changing volume in the first — it updates there too, live.
- [ ] Click the gear icon — Settings view appears, back chevron returns
      to the slider view.
- [ ] Pick Light, then Dark — popup colors switch immediately.
- [ ] Pick Auto, then change your OS theme — popup follows it while open.
- [ ] Reopen the popup later — the theme choice persisted.
- [ ] Click the `%` number, type a value, press Enter — exact value applies.
- [ ] Open the popup on a `chrome://` or `brave://` page — shows the
      disabled state instead of a live (but useless) slider.

## Permissions

- `storage` — to remember per-site volume and the theme choice.
- `<all_urls>` host permission — the content script needs to run on
  any site you might want to boost; there's no way to know your sites
  in advance.

No other permissions, no remote code, no analytics.
