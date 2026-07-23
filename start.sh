#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

if [[ ! -d web/node_modules ]]; then
  (cd web && npm install)
fi

if [[ ! -f web/dist/index.html ]]; then
  (cd web && npm run build)
fi

exec .venv/bin/python -m server.main
