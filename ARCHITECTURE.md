# Project Architecture (OF Client Launcher)

This document explains the initial architecture implemented in the prototype.

- Main process (src/main)
  - Handles creating the application windows
  - Opens a modal auth window for logging in
  - Exposes IPC handlers to the renderer for: opening auth window, checking game version (scraper), starting downloads
  - Uses the `session` API to retrieve cookies and save them to a file

- Preload (src/main/preload.ts)
  - Exposes a secure API to the renderer via `contextBridge`
  - Methods include `openAuthWindow`, `checkGameVersion`, `downloadHttp`, `downloadTorrent`, and event listeners

- Renderer (src/renderer)
  - React app powered by Vite
  - UI for opening login window, checking a game's version, starting sample downloads, and displaying progress

- Modules
  - cookieManager - saves and loads cookies from the userData path
  - scraper - performs an HTTP GET to the game's page using cookies and extracts the version
  - downloader - provides HTTP stream download and torrent downloading via `webtorrent`
  - zip - prototype extraction via `node-7z` using a password
  - protonManager - placeholder to manage Proton/Wine prefixes on Linux

- Local DB
  - `better-sqlite3` is used for a lightweight local DB stored in `userData/launcher.db`

## Next Steps / Roadmap

- Improve dev setup so `preload` is compiled and ready in dev without hacks
- Proper packaging with `electron-builder` / `electron-forge` to bundle app and include `7z` binaries per platform
- Implement secure storage for cookies and user session
- Add UI for download manager and torrent seeding options
- Implement a robust prefix manager for Proton (detect installed Proton versions, manage prefixes, launch games using Steam/Proton or Wine)
- Add automated tests for the scraper and download modules

