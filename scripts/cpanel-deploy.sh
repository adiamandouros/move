#!/bin/bash
# Run by cPanel's "Git Version Control" on deploy (see .cpanel.yml):
# installs dependencies and restarts the Node.js app.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
echo "[deploy] App folder: $APP_DIR"

# cPanel's "Setup Node.js App" keeps node and npm in a per-app environment at
# ~/nodevenv/<app folder relative to home>/<node version>/. Use the newest one.
VENV_ROOT="$HOME/nodevenv/${APP_DIR#"$HOME"/}"
ACTIVATE="$(ls -d "$VENV_ROOT"/*/bin/activate 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$ACTIVATE" ]; then
    echo "[deploy] Using $ACTIVATE"
    # shellcheck disable=SC1090
    source "$ACTIVATE"
else
    echo "[deploy] No Node.js environment under $VENV_ROOT — using npm from PATH"
fi

if ! command -v npm >/dev/null; then
    echo "[deploy] npm not found. Run \"npm install\" from the Node.js app page in cPanel instead." >&2
    exit 1
fi
echo "[deploy] node $(node -v), npm $(npm -v)"

npm ci --omit=dev --no-audit --no-fund

# Passenger (which runs Node.js apps on cPanel) restarts the app when this file changes
mkdir -p tmp
touch tmp/restart.txt
echo "[deploy] Done — the app restarts on its next request."
