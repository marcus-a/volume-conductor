# Volume Conductor

Chromium extension that boosts volume up to 500% and remembers the level per site. Set youtube.com to 300% once and it stays that way, every tab, every restart.

## Features

- Boost any video or audio element up to 500%, past the native 100% ceiling
- Volume is remembered per site and persists across restarts
- Drag the slider in steps of 5, or click the percentage to type an exact value
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

A content script wires video and audio elements into a Web Audio GainNode, which can boost volume beyond what the browser normally allows. The volume for each hostname is stored in `chrome.storage.local`, so it survives reloads and restarts, and updates every open tab on that site live.

Only needs the `storage` permission and access to run on the pages you visit. No other permissions, no remote code.

## Development

No build step, plain HTML/CSS/JS. Run `npm test` for the storage module's automated tests.
