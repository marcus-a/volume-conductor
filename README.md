# Volume Conductor

Chromium extension that boosts volume up to 500% and remembers the level per site. Set youtube.com to 300% once and it stays that way, every tab, every restart.

## Features

- Boost any video or audio element up to 500%, past the native 100% ceiling
- Volume is remembered per site and persists across restarts
- Drag the slider in steps of 5, or click the percentage to type an exact value
- Optional limiter, per site or globally, with a live level meter:
  - Manual: a hard ceiling from -60 to 0 dB that audio never goes past
  - Auto: learns the normal level of what you're watching (up to the last minute) and holds sudden loud noises to a set amount above it
- Works inside embedded players (iframes), using the settings of the site you're on
- Light, Dark, or Auto theme (Auto follows your OS setting live)
- No account, no network requests, no tracking

## Install

Not published to a web store, so load it as an unpacked extension.

1. Clone this repository
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, any Chromium browser)
3. Enable Developer mode
4. Click Load unpacked and select this folder

After editing the code, reload the extension on that page and refresh any open tab you're testing in.

## How it works

A content script wires video and audio elements into a Web Audio GainNode when they start playing, which can boost volume beyond what the browser normally allows. The limiter is an AudioWorklet (`limiter-worklet.js`) with a 5 ms lookahead, so peaks are turned down before they arrive instead of being clipped. Settings for each hostname are stored in `chrome.storage.local`, so they survive reloads and restarts, and update every open tab on that site live.

Media loaded from another site without CORS headers is left alone, since Chromium would play it silently once routed through Web Audio. On sites whose security policy blocks the worklet, the limiter falls back to the browser's built-in compressor (a softer limit).

Only needs the `storage` permission and access to run on the pages you visit. No other permissions, no remote code.

## Development

No build step, plain HTML/CSS/JS. Run `npm test` for the automated tests of the storage module and the limiter.
