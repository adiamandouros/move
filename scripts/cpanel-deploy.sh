#!/bin/bash
# Run by cPanel's "Git Version Control" on deploy (see .cpanel.yml):
# installs dependencies, restarts the Node.js app and stops any copy of it
# still running from before.
#
# cPanel's "Setup Node.js App" (CloudLinux Node.js Selector) keeps an app's
# packages outside the app: node_modules in the app folder is a symlink to
# ~/nodevenv/<app folder>/<version>/lib/node_modules. Running npm in the app
# folder would replace that symlink with a plain folder the app server
# doesn't use, so packages are installed where the symlink points instead.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${APP_DIR#"$HOME"/}"
cd "$APP_DIR"
echo "[deploy] App folder: $APP_DIR"
# Copies of the app that started before this are from before the restart
STARTED="$(date +%s%3N)"
# The app's Node.js environment (the newest version set up for it)
ACTIVATE="$(ls -d "$HOME/nodevenv/$APP_ROOT"/*/bin/activate 2>/dev/null | sort -V | tail -n 1 || true)"

# Copies left running after a restart use up the account's threads, and at
# its limit nothing new starts (server/processes.js). The app stops its own
# old copies too, but only once a new copy is running.
stop_old_copies() {
    local node
    node="$(command -v node || true)"
    if [ -z "$node" ] && [ -n "$ACTIVATE" ]; then node="$(dirname "$ACTIVATE")/node"; fi
    if [ -x "$node" ]; then
        "$node" scripts/stop-old-copies.js "$APP_DIR" "$STARTED" \
            || echo "[deploy] Couldn't stop old copies; the app stops its own within a few minutes" >&2
    else
        echo "[deploy] node not found, so old copies are left to the app to stop" >&2
    fi
}

# 1. CloudLinux's own tool — the same thing the "Run NPM Install" and "Restart" buttons do
if command -v cloudlinux-selector >/dev/null; then
    echo "[deploy] Using cloudlinux-selector"
    # --skip-web-check: the tool otherwise compares the app's response before and
    # after, and reports an error whenever it changes — e.g. when a broken app
    # starts working again
    if cloudlinux-selector install-modules --json --interpreter nodejs --app-root "$APP_ROOT" --skip-web-check \
        && cloudlinux-selector restart --json --interpreter nodejs --app-root "$APP_ROOT" --skip-web-check; then
        stop_old_copies
        echo "[deploy] Done."
        exit 0
    fi
    echo "[deploy] cloudlinux-selector failed — installing with npm instead"
fi

# 2. npm from the app's environment
if [ -n "$ACTIVATE" ]; then
    echo "[deploy] Using $ACTIVATE"
    # shellcheck disable=SC1090
    source "$ACTIVATE"
fi
if ! command -v npm >/dev/null; then
    echo "[deploy] npm not found. Use \"Run NPM Install\" on the app's page in cPanel → Setup Node.js App." >&2
    exit 1
fi
echo "[deploy] node $(node -v), npm $(npm -v)"

if [ -L node_modules ]; then
    # Install next to the symlink's target, with this app's package files
    TARGET="$(readlink node_modules)"
    INSTALL_DIR="$(dirname "$TARGET")"
    mkdir -p "$TARGET"
    ln -sf "$APP_DIR/package.json" "$INSTALL_DIR/package.json"
    ln -sf "$APP_DIR/package-lock.json" "$INSTALL_DIR/package-lock.json"
    echo "[deploy] node_modules -> $TARGET; installing in $INSTALL_DIR"
else
    INSTALL_DIR="$APP_DIR"
fi
(cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund)

# Passenger (which runs Node.js apps on cPanel) restarts the app when this file changes
mkdir -p tmp
touch tmp/restart.txt
stop_old_copies
echo "[deploy] Done — the app restarts on its next request."
