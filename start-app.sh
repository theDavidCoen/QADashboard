#!/usr/bin/env bash
# Desktop launcher: starts the API (if needed) and opens a native webview window.
# For development with browser + hot reload, keep using ./start.sh instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# WebKitGTK on Wayland can paint a blank white surface without this.
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name="QA Dashboard" "QA Dashboard" "$1" || true
  fi
}

if [[ ! -d .venv ]]; then
  python3 -m venv --system-site-packages .venv
  .venv/bin/pip install -r requirements.txt
fi

# Desktop shell needs system PyGObject (gi) + WebKitGTK.
if [[ -f .venv/pyvenv.cfg ]] && grep -q '^include-system-site-packages = false$' .venv/pyvenv.cfg; then
  sed -i 's/^include-system-site-packages = false$/include-system-site-packages = true/' .venv/pyvenv.cfg
fi

if ! .venv/bin/python -c "import webview" 2>/dev/null; then
  .venv/bin/pip install -r requirements.txt
fi

if [[ ! -d web/node_modules ]]; then
  (cd web && npm install)
fi

if [[ ! -f web/dist/index.html ]]; then
  (cd web && npm run build)
fi

exec .venv/bin/python -m server.desktop
