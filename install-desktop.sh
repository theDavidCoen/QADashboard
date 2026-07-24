#!/usr/bin/env bash
# Install a GNOME/KDE app-menu launcher for QA Dashboard (user-local, no root).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
DESKTOP_SRC="$ROOT/packaging/qa-dashboard.desktop.in"
DESKTOP_DST="$APP_DIR/qa-dashboard.desktop"
ICON_SRC="$ROOT/packaging/qa-dashboard.svg"
ICON_DST="$ICON_DIR/qa-dashboard.svg"

mkdir -p "$APP_DIR" "$ICON_DIR"
chmod +x "$ROOT/start-app.sh"

sed "s|@ROOT@|$ROOT|g" "$DESKTOP_SRC" > "$DESKTOP_DST"
chmod 644 "$DESKTOP_DST"
cp -f "$ICON_SRC" "$ICON_DST"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "Installed launcher:"
echo "  $DESKTOP_DST"
echo "  $ICON_DST"
echo
echo "Search for “QA Dashboard” in the app menu, or run:"
echo "  gtk-launch qa-dashboard"
echo "  $ROOT/start-app.sh"
