#!/usr/bin/env bash
# Install a GNOME/KDE app-menu launcher for QA Dashboard (user-local, no root).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
ICON_SVG_DIR="$ICON_BASE/scalable/apps"
DESKTOP_SRC="$ROOT/packaging/qa-dashboard.desktop.in"
# Basename must match Gtk.Application id so Dash to Dock / GNOME Shell
# associate the running window with this launcher.
DESKTOP_ID="it.davidcoen.qa-dashboard"
DESKTOP_DST="$APP_DIR/${DESKTOP_ID}.desktop"
ICON_SRC="$ROOT/packaging/qa-dashboard.svg"
ICON_SVG_DST="$ICON_SVG_DIR/qa-dashboard.svg"

mkdir -p "$APP_DIR" "$ICON_SVG_DIR"
chmod +x "$ROOT/start-app.sh"

sed "s|@ROOT@|$ROOT|g" "$DESKTOP_SRC" > "$DESKTOP_DST"
chmod 644 "$DESKTOP_DST"

# Remove legacy launcher id (WM class mismatch → generic dock icon).
rm -f "$APP_DIR/qa-dashboard.desktop"

cp -f "$ICON_SRC" "$ICON_SVG_DST"

# Raster sizes help Dash to Dock / icon themes that skip SVG.
if command -v rsvg-convert >/dev/null 2>&1; then
  for size in 48 64 128 256 512; do
    out_dir="$ICON_BASE/${size}x${size}/apps"
    mkdir -p "$out_dir"
    rsvg-convert -w "$size" -h "$size" -o "$out_dir/qa-dashboard.png" "$ICON_SRC"
  done
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$ICON_BASE" >/dev/null 2>&1 || true
fi

echo "Installed launcher:"
echo "  $DESKTOP_DST"
echo "  $ICON_SVG_DST"
echo
echo "Search for “QA Dashboard” in the app menu, or run:"
echo "  gtk-launch $DESKTOP_ID"
echo "  $ROOT/start-app.sh"
echo
echo "If the dock still shows a generic icon, quit QA Dashboard and reopen it."
