# Volume Conductor

Per-site volume boost (0-500%) for Chrome/Brave. Remembers the volume you
set for each site and re-applies it automatically, including after a
browser restart.

## Install (unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory.
4. Visit any site with audio/video, click the Volume Conductor icon in
   the toolbar, and drag the slider.

## How it works

- A content script wires every `<video>`/`<audio>` element into a Web
  Audio `GainNode` so volume can go above the native 100% ceiling.
- The volume you set is stored per hostname (`chrome.storage.local`),
  so `youtube.com` and any other site each keep their own setting,
  persisted across restarts.

## Manual verification checklist

- [ ] Set youtube.com to 300%, confirm audible boost.
- [ ] Reload the page — 300% re-applies automatically.
- [ ] Restart the browser entirely, revisit youtube.com — 300% still applied.
- [ ] Visit a second site with audio/video — it defaults to 100%,
      independent of YouTube's setting.
- [ ] Navigate within YouTube to another video without a full page
      reload (SPA navigation) — the new `<video>` element picks up the
      hostname's stored volume.
