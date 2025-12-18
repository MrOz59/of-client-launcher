# VoidLauncher (OF-Client)

Launcher/atualizador para jogos do **online-fix.me**.

> Status: protótipo/experimental.

## Visão geral

O projeto é um app desktop baseado em **Electron** (processo *main*) + **React/Vite** (processo *renderer*).
Ele centraliza:

- Biblioteca de jogos (lista, favoritos, status)
- Login/sessão para o site (via cookies)
- Download de updates (torrent)
- Extração/instalação (zip/rar/7z, etc.)
- Execução de jogos no Linux via **Proton/Wine** (gerenciamento de prefix/runtime)
- Suporte a VPN (salas/peers) via **WireGuard** + um **VPN Controller** (API HTTP)
- Cloud saves (integração com Google Drive)

## Arquitetura

- **Main process**: `src/main/main.ts`
  - Cria as janelas (`BrowserWindow`) e carrega a UI
  - Implementa os handlers IPC (`ipcMain.handle`) usados pela interface
  - Orquestra downloads, extração, persistência, execução via Proton, etc.

- **Preload**: `src/main/preload.ts` → `dist-preload/preload.js`
  - Expõe uma API segura para o renderer via `contextBridge.exposeInMainWorld('electronAPI', ...)`
  - Toda comunicação UI↔Main acontece via IPC (invoke/on)

- **Renderer (UI)**: `src/renderer/`
  - React + Vite, build para `dist/renderer`

- **Persistência local**: `src/main/db.ts`
  - Preferência por **SQLite** (`better-sqlite3`) em `userData/launcher.db`
  - Fallback automático para JSON (`userData/launcher.json`) se o SQLite não estiver disponível

- **Torrent sidecar (Python)**: `services/torrent-agent/libtorrent_rpc.py`
  - Controlado pelo main via `src/main/torrentLibtorrentRpc.ts`
  - Protocolo simples tipo JSON-RPC por stdin/stdout
  - Permite torrents via libtorrent mantendo o main leve

### Fluxo de dados (alto nível)

1. UI chama `window.electronAPI.*` (preload)
2. Preload faz `ipcRenderer.invoke(...)` / `ipcRenderer.on(...)`
3. Main executa (db/download/scraper/proton/etc.)
4. Main retorna o resultado para a UI ou emite eventos (`webContents.send`) como:
   - `download-progress`
   - `download-complete`
   - `game-launch-status`
   - `update-queue-status`

## Tecnologias usadas

- **Electron** (desktop shell)
- **TypeScript** (main + renderer + preload)
- **React** (UI)
- **Vite** (build do renderer)
- **electron-builder** (empacotamento: AppImage/deb/rpm/pacman e NSIS no Windows)
- **better-sqlite3** (persistência local em SQLite) + fallback JSON
- **axios** (HTTP)
- **cheerio** (parsing/scraping HTML)
- **libtorrent (via Python sidecar)** (downloads torrent)
- **7zip-bin / node-7z / node-unrar-js / extract-zip** (extração/instalação)
- **googleapis** (Google Drive / cloud saves)
- **WireGuard** (VPN local: `wg`/`wg-quick` no Linux e WireGuard for Windows)

## Estrutura de pastas (principal)

- `src/main/`: backend do launcher (Electron main)
- `src/renderer/`: frontend (React)
- `dist/`: artefatos de build
- `dist-preload/`: preload compilado
- `services/lan-controller/`: legado (referências antigas a ZeroTier; não é o fluxo de VPN atual)
- `services/torrent-agent/`: sidecar Python (libtorrent)
- `compatTools/`: ferramentas de compatibilidade (Proton)

## Desenvolvimento

### Requisitos

- Node.js + npm

### Instalar dependências

```bash
npm install
```

### Rodar em modo dev

```bash
npm run dev
```

Em dev:
- Vite (renderer) sobe em `http://localhost:5173`
- Electron (main) carrega o renderer do Vite

## Build e release

### Build (renderer + main + preload)

```bash
npm run build
```

### Gerar AppImage (Linux)

```bash
npm run dist:appimage
```

O output vai para `release/`.

## Linux: sandbox do Electron (AppImage)

Em AppImage, o Chromium não consegue usar o **SUID sandbox** (ele depende de `chrome-sandbox` com permissões `root:4755`, que o AppImage não preserva).

Este launcher faz o seguinte (em `src/main/main.ts`):

- Se o kernel permite **user namespaces**, desabilita apenas o SUID sandbox (`--disable-setuid-sandbox`) e deixa o Chromium usar **namespace sandbox** (preferível)
- Se user namespaces não estiverem disponíveis, usa `--no-sandbox` apenas como último recurso

Isso evita um workaround permanente de `--no-sandbox` e resolve a tela branca em ambientes comuns.

## VPN (WireGuard) e salas

O launcher suporta VPN baseada em **WireGuard**:

- O *cliente* roda localmente (Linux: `wg`/`wg-quick`; Windows: WireGuard instalado)
- O launcher recebe um `.conf` pronto para conexão (túnel `ofvpn`) e sobe/derruba o túnel quando solicitado
- A UI conversa com o main via IPC (`vpn-status`, `vpn-room-create`, `vpn-room-join`, `vpn-room-peers`, `vpn-connect`, `vpn-disconnect`)

O fluxo de “salas” usa um **VPN Controller** (API HTTP) configurado em `lan_controller_url` (por padrão `https://vpn.mroz.dev.br`).
Ele expõe endpoints como `/api/vpn/rooms/create`, `/api/vpn/rooms/join`, `/api/vpn/rooms/peers` e retorna configs WireGuard para o cliente.

Implementação no código:

- Cliente local WireGuard: `src/main/ofVpnManager.ts`
- Client HTTP do controller: `src/main/vpnControllerClient.ts`

> Nota: `services/lan-controller/` ainda existe no repositório por histórico/legado e contém documentação de ZeroTier, mas não representa o fluxo de VPN atual do launcher.

## Notas de segurança

- `nodeIntegration` desabilitado e `contextIsolation` habilitado nas janelas.
- A API do Electron exposta ao renderer é controlada via `preload` (sem acesso direto ao Node no UI).

## Troubleshooting

### Tela branca no AppImage

Verifique se user namespaces estão habilitados:

```bash
cat /proc/sys/kernel/unprivileged_userns_clone
```

Se retornar `0`, o kernel está bloqueando user namespaces. Nesse caso, o launcher vai cair no modo `--no-sandbox` (menos seguro) ou pode falhar dependendo do ambiente.

### Torrents não iniciam

- Confirme que há `python3` disponível (ou defina `OF_PYTHON_PATH`).
- O sidecar usa `services/torrent-agent/libtorrent_rpc.py` e depende do `PYTHONPATH` apontando para `services/torrent-agent/pydeps` (dev) ou `resources/torrent-agent/pydeps` (empacotado).

## Licença

MIT.
