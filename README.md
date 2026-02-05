# VoidLauncher (OF-Client)

Launcher/updater for games from **online-fix.me**.

> Status: prototype / experimental. Some subsystems (notifications/overlays UI) are intentionally disabled for now.

## Overview

VoidLauncher is a desktop app built with **Electron** (main process) and **React/Vite** (renderer). It centralizes:

- Game library (list, favorites, status)
- Session/login (cookie-based)
- Updates and downloads (torrent + HTTP fallbacks)
- Extraction/installation (zip/rar/7z)
- Linux game launching via **Proton/Wine** (prefix/runtime management)
- Steam overlay and Epic EOS overlay integration (Linux)
- VPN rooms/peers via **WireGuard** + a controller API
- Cloud saves (Google Drive)

## Key Features

- **OnlineFix integration**
  - Parses `OnlineFix.ini` to detect Steam/Epic games.
  - Uses Steam AppID / Epic Product ID to configure overlays and saves.

- **Steam overlay (Linux)**
  - Sets `LD_PRELOAD` and Vulkan overlay layer envs when a valid Steam AppID is found.

- **Epic EOS overlay (Linux)**
  - Uses `legendary` to install/enable EOS overlay in the Wine/Proton prefix.
  - Uses Epic-specific `WINEDLLOVERRIDES` for better compatibility.

- **Proton/Wine prefix management**
  - Creates/updates prefixes per game.
  - Runs common redistributables.

- **VPN rooms (WireGuard)**
  - Connect/disconnect per room via a controller API.

- **Cloud saves**
  - Uses Ludusavi and Google Drive.

## Architecture

- **Main process**: `src/main/main.ts`
  - Creates windows and IPC handlers.
  - Orchestrates downloads, extraction, persistence, and game launches.

- **Preload**: `src/main/preload.ts` → `dist-preload/preload.js`
  - Exposes a safe API to the renderer via `contextBridge`.

- **Renderer (UI)**: `src/renderer/`
  - React + Vite, builds into `dist/renderer`.

- **Persistence**: `src/main/db.ts`
  - Prefers **SQLite** (`better-sqlite3`) in `userData/launcher.db`.
  - Falls back to JSON (`userData/launcher.json`) if SQLite is unavailable.

- **Torrent sidecar (Python)**: `services/torrent-agent/libtorrent_rpc.py`
  - Controlled by `src/main/torrentLibtorrentRpc.ts`.
  - JSON-RPC over stdin/stdout keeps the main process lightweight.

## Tech Stack

- Electron
- TypeScript (main + renderer + preload)
- React + Vite
- electron-builder (AppImage/deb/rpm/pacman, NSIS)
- better-sqlite3 (SQLite persistence)
- axios + cheerio (HTTP + scraping)
- libtorrent (via Python sidecar)
- node-7z / node-unrar-js / extract-zip (extraction)
- googleapis (Google Drive)
- WireGuard (VPN)

## Folder Structure (core)

- `src/main/`: main process (Electron backend)
- `src/renderer/`: UI (React)
- `dist/`: compiled output
- `dist-preload/`: compiled preload
- `services/torrent-agent/`: Python sidecar
- `compatTools/`: Proton/compat tools
- `vendor/`: optional bundled tools

## Development

### Requirements

- Node.js + npm

### Install

```bash
npm install
```

### Run (dev)

```bash
npm run dev
```

In dev:
- Vite runs at `http://localhost:5173`
- Electron loads the Vite renderer

## Build & Release

### Build

```bash
npm run build
```

### Linux AppImage

```bash
npm run dist:appimage
```

Artifacts go to `release/`.

## Overlays (Linux)

### Steam Overlay

Enabled when a Steam AppID is resolved (from `OnlineFix.ini`, stored metadata, or detected). The launcher sets:

- `LD_PRELOAD` with Steam overlay renderer
- Vulkan overlay layer vars (`VK_ADD_LAYER_PATH`, `VK_INSTANCE_LAYERS`)

### Epic EOS Overlay

Enabled when `OnlineFix.ini` has `RealProductId` (Epic). The launcher:

- Ensures **Legendary** is available
- Installs/updates EOS overlay if missing
- Enables EOS overlay inside the Wine/Proton prefix
- Applies Epic-specific `WINEDLLOVERRIDES` for compatibility

> Note: EOS overlay requires DXVK and corefonts in the prefix. The launcher attempts to prepare the prefix; if the overlay does not appear, ensure DXVK/corefonts are installed.

## OnlineFix.ini Detection

The launcher reads `OnlineFix.ini` to determine the platform:

- **Epic**: `RealProductId=...`
- **Steam**: `AppId` or `SteamAppId`, with fallback to `FakeAppId`/`RealAppId`

This affects overlay setup and cloud saves paths.

## VPN Rooms (WireGuard)

- The launcher obtains a ready-to-use `.conf` from a controller API and brings the tunnel up/down.
- IPC endpoints include:
  - `vpn-status`, `vpn-room-create`, `vpn-room-join`, `vpn-room-peers`, `vpn-connect`, `vpn-disconnect`

Implementation:
- `src/main/ofVpnManager.ts`
- `src/main/vpnControllerClient.ts`

## Cloud Saves

- Uses Ludusavi + Google Drive
- Cloud saves are synchronized on launch/exit

## Environment Variables (common)

- `OF_ALLOW_TORRENT_FALLBACK=1` — allow torrent fallback
- `OF_PYTHON_PATH=/path/to/python3` — override Python for torrent sidecar
- `LEGENDARY_PATH=/path/to/legendary` — override Legendary path
- `LEGENDARY_REPO=owner/repo` — override Legendary repo
- `LEGENDARY_VERSION=x.y.z` — pin Legendary version

## Linux: Electron Sandbox Notes

AppImage cannot preserve the SUID sandbox permissions. The launcher:

- Uses the user-namespace sandbox when available
- Falls back to `--no-sandbox` only when necessary

## Security Notes

- `nodeIntegration` is disabled and `contextIsolation` is enabled.
- Renderer accesses the main process only via preload IPC.

## Troubleshooting

### AppImage white screen

Check user namespaces:

```bash
cat /proc/sys/kernel/unprivileged_userns_clone
```

If `0`, user namespaces are blocked; the launcher will fall back to `--no-sandbox`.

### Torrents don’t start

- Ensure `python3` exists or set `OF_PYTHON_PATH`.
- Sidecar location: `services/torrent-agent/libtorrent_rpc.py`.

### EOS overlay not showing

- Confirm DXVK and corefonts in the prefix.
- Ensure the EOS overlay is enabled for the prefix via Legendary.

## License

MIT.
