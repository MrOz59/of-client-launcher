#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-root@chaos.mroz.dev.br}"
REMOTE_DIR="${REMOTE_DIR:-/opt/lan-controller}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing env var: $name" >&2
    exit 2
  fi
}

require_env ZT_API_TOKEN
require_env ZT_DEFAULT_NETWORK_ID

echo "[deploy] Host: ${HOST}"
echo "[deploy] Remote dir: ${REMOTE_DIR}"
echo "[deploy] Compose file: ${COMPOSE_FILE}"

echo "[deploy] Checking docker on remote..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "${HOST}" 'command -v docker >/dev/null && docker version >/dev/null' \
  || { echo "[deploy] Docker not available on remote. Install Docker/Compose first." >&2; exit 3; }

echo "[deploy] Uploading service files..."
tar -C "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" -czf - \
  Dockerfile \
  Caddyfile \
  compose.yml \
  compose.direct.yml \
  server.mjs \
  README.md \
  .dockerignore \
  .env.example \
  nginx.vpn.mroz.dev.br.conf.example \
  | ssh "${HOST}" "mkdir -p '${REMOTE_DIR}' && tar -xzf - -C '${REMOTE_DIR}'"

echo "[deploy] Writing .env on remote..."
ssh "${HOST}" "cat > '${REMOTE_DIR}/.env' <<'EOF'
ZT_API_TOKEN=${ZT_API_TOKEN}
ZT_DEFAULT_NETWORK_ID=${ZT_DEFAULT_NETWORK_ID}
LAN_CONTROLLER_API_KEY=${LAN_CONTROLLER_API_KEY:-}
EOF"

echo "[deploy] Starting stack..."
ssh "${HOST}" "cd '${REMOTE_DIR}' && docker compose -f '${COMPOSE_FILE}' up -d --build"

echo "[deploy] Done. Check status with:"
echo "  ssh ${HOST} \"cd '${REMOTE_DIR}' && docker compose ps\""
