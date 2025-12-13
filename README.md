# OF Client Launcher (prototype)

This is a prototype Electron-based launcher for games on online-fix.me. It demonstrates:

- Web login via a separate window (captures cookies)
- Scraping a game page using cookies to extract version info
- Basic SQLite persistence for games
- Skeleton modules for download/torrent and zip extraction with password
- Proton prefix management placeholder for Linux

## Development

Install dependencies:

```fish
npm install
```

Run development server (renderer) and electron main in parallel:

```fish
npm run dev
```

Then open the app. The renderer runs Vite at `localhost:5173` and the main process will open the Electron window.

## How to test

- Click "Open Login Window" and log in to `online-fix.me` (use a test account).
- After closing the login window the app will save cookies; click "Check Version" to scrape the given game URL and display the version.

### Offline/Unit test for version extractor

- To run a simple offline test of the version extractor (uses compiled dist files):

```fish
npm run build
npm run test:scraper
```

## Builds (Windows / Linux / pacman / rpm)

O projeto usa `electron-builder` e salva os artefatos em `release/`.

- Linux (AppImage + deb + rpm + pacman): `npm run dist:linux`
- Linux (somente AppImage): `npm run dist:appimage`
- Linux (somente rpm): `npm run dist:rpm`
- Linux (somente pacman): `npm run dist:pacman`
- Windows (NSIS): `npm run dist:win`

### GitHub Actions

Workflows prontos:
- `.github/workflows/build.yml`: roda em push/PR (sem anexar artefatos via Actions).
- `.github/workflows/release.yml`: ao criar tag `v*`, compila e publica um Release com os arquivos.

Instalação:
- Arch: `sudo pacman -U <arquivo>.pkg.tar.zst`
- rpm: `sudo rpm -Uvh <arquivo>.rpm` (ou `dnf install ./arquivo.rpm`)

## Notes

- This is a prototype; the modules for torrent downloads, zip extraction and Proton management are placeholders and need more robust implementation for production.
- For extracting password protected archives this prototype uses `node-7z`, which requires `7z` binary available in the system.
 - For extracting password protected archives this prototype uses `node-7z`, which requires `7z` binary available in the system. On Debian/Ubuntu: `sudo apt install p7zip-full`.

## License
MIT
