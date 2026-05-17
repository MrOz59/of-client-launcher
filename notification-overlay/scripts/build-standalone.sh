#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_TAURI_DIR="$ROOT_DIR/src-tauri"
DIST_DIR="$ROOT_DIR/dist"
FRONTEND_DIR="$ROOT_DIR/frontend"

APP_NAME="void-toast"
MODE="${1:-linux}"
BUILD_PROFILE="${BUILD_PROFILE:-release-fast}"

mkdir -p "$DIST_DIR"

print_help() {
  cat <<EOF
Uso:
  bash scripts/build-standalone.sh linux
  bash scripts/build-standalone.sh windows
  bash scripts/build-standalone.sh all

Saída:
  dist/void-toast-linux-x86_64
  dist/void-toast-windows-x86_64.exe

Observação:
  Build Linux deve ser feito no Linux.
  Build Windows é mais confiável quando feito no Windows.

  Cross-compile Linux -> Windows pode exigir:
    rustup target add x86_64-pc-windows-gnu
    mingw-w64 instalado no sistema
EOF
}

build_linux() {
  echo "==> Compilando Linux x86_64..."

  mkdir -p "$FRONTEND_DIR"
  if [[ ! -f "$FRONTEND_DIR/toast.html" ]] || ! cmp -s "$ROOT_DIR/toast.html" "$FRONTEND_DIR/toast.html"; then
    cp "$ROOT_DIR/toast.html" "$FRONTEND_DIR/toast.html"
  fi
  rm -f "$FRONTEND_DIR/notification.wav" "$FRONTEND_DIR/achievement.wav"

  (
    cd "$SRC_TAURI_DIR"
    cargo build --profile "$BUILD_PROFILE"
  )

  local src="$SRC_TAURI_DIR/target/$BUILD_PROFILE/$APP_NAME"
  local out="$DIST_DIR/${APP_NAME}-linux-x86_64"

  if [[ ! -f "$src" ]]; then
    echo "ERRO: binário Linux não encontrado em: $src"
    exit 1
  fi

  cp "$src" "$out"
  chmod +x "$out"

  echo "OK: $out"
}

build_windows_from_linux() {
  echo "==> Tentando compilar Windows x86_64 a partir do Linux..."

  if ! rustup target list --installed | grep -q "x86_64-pc-windows-gnu"; then
    echo "Target Windows GNU não instalado."
    echo "Instalando com rustup..."
    rustup target add x86_64-pc-windows-gnu
  fi

  if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
    echo "ERRO: x86_64-w64-mingw32-gcc não encontrado."
    echo ""
    echo "No Arch/CachyOS:"
    echo "  sudo pacman -S mingw-w64-gcc"
    echo ""
    echo "No Ubuntu/Debian:"
    echo "  sudo apt install gcc-mingw-w64-x86-64"
    echo ""
    echo "Build Windows com Tauri/WebView2 costuma ser mais confiável feito no próprio Windows."
    exit 1
  fi

  (
    cd "$SRC_TAURI_DIR"

    CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc \
    CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++ \
    cargo build --release --target x86_64-pc-windows-gnu
  )

  local src="$SRC_TAURI_DIR/target/x86_64-pc-windows-gnu/release/${APP_NAME}.exe"
  local out="$DIST_DIR/${APP_NAME}-windows-x86_64.exe"

  if [[ ! -f "$src" ]]; then
    echo "ERRO: binário Windows não encontrado em: $src"
    exit 1
  fi

  cp "$src" "$out"

  echo "OK: $out"
}

build_windows_from_windows_hint() {
  cat <<EOF
Para compilar no Windows, use:

  npm run build:windows

ou diretamente:

  powershell -ExecutionPolicy Bypass -File scripts/build-standalone.ps1 windows

EOF
}

case "$MODE" in
  linux)
    build_linux
    ;;
  windows)
    if [[ "${OS:-}" == "Windows_NT" ]]; then
      build_windows_from_windows_hint
    else
      build_windows_from_linux
    fi
    ;;
  all)
    build_linux
    build_windows_from_linux
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    echo "Modo inválido: $MODE"
    print_help
    exit 1
    ;;
esac
