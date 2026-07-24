# Changelog

All notable changes to QA Dashboard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-07-24

### Added

- **Desktop app shell** — `start-app.sh` + `pywebview` window; `install-desktop.sh` installs a user app-menu launcher (`.desktop` + icon). Dev workflow stays `./start.sh` + browser. Requires system `python-gobject` / `webkit2gtk-4.1` and a venv with `--system-site-packages`.
- **Keyboard shortcuts** — hold Space 1s → Screenshot; Shift+Space → start/stop video Rec; legend at the bottom of Settings.
- **Device actions** — Wi‑Fi, VPN, Battery saver, Rotate device; **VPN WireGuard** toggle (opens WireGuard briefly when remote intents are unavailable, then returns to the previous app).
- **Sidebar group order** — reorder Launch / Stop / Capture / Device / Custom ADB in Settings (↑↓).
- **Action busy veil** — while app-stealing actions run (WireGuard, VPN, Start Edge/Arkade/PWA/other app), target device slots show a spinner overlay and block touch/keyboard.

### Changed

- With a **single Android device** in the workspace, target-picker modals are skipped (screenshot, kill, reboot, Rec/video start immediately; Airplane keeps Enable/Disable only; Start other app goes straight to the app list).
- **Rotate** uses `wm user-rotation lock` and does **not** set `ignore-orientation-request`, so portrait-locked apps (e.g. Edge) are not force-resized (avoids Activity recreate / unexpected logout). Dashboard uses a real landscape phone layout at 90°/270°.
- Rotate UI angle is synced from the device’s reported degrees (not only +90 locally).

### Fixed

- **Battery saver** on MIUI/HyperOS — set `POWER_SAVE_MODE_OPEN` + broadcast; AOSP `low_power` / `cmd power set-mode` kept as fallback.
- Scrcpy **orientation size changes** notify the browser (`MSG_CONFIG`); video decoder is rebuilt so landscape streams are not drawn on a stale portrait canvas.

## [0.2.0] — 2026-07-24

### Added

- **Focus Mode** — top-right control; hover to preview, click to lock; Esc exits when the pointer is not over a device stream; soft enter/exit sounds.
- **Rec control** — fixed top-right Rec button (opens device picker); while recording only **Stop recording** is shown; Esc stops Rec immediately (UI) and finishes save in the background; arm/disarm sounds.
- **Sound effects** — shutter, Focus Mode, and Rec feedback; Settings toggle **Sound effects** (`soundEffectsEnabled`).
- **Screenshot shutter** sound (GNOME `camera-shutter.oga`).
- **Physical keyboard → device** — hover or click a stream to arm input; Esc on an armed stream still sends Android BACK when not used for Focus/Rec.
- **Device reorder** — drag handle on device headers.
- **All Devices** target for Kill app, Kill background, Screenshot, and Start other app.
- Settings: **Edge** / **Arkade** feature master toggles; reorganized Settings by theme with zebra rows; Custom ADB under Sidebar actions.
- Click outside a modal (backdrop) closes without saving.

### Changed

- Edge account modal: cleaner loading state; “Another account…” / Back flow.
- Start Arkade modal: scanning spinner, clearer selection, URL field only when needed.
- Workspace top controls layout (Focus + Rec / Stop).

### Fixed

- Keyboard disarm after click (`setPointerCapture` / `pointerleave` race).
- Sound effects setting ignored when the API/server was stale (field now persisted correctly).

## [0.1.0] — 2026-07-23

### Added

- Initial public release (MIT): multi-device Android/iOS streaming, sidebar actions, Edge credential vault, Settings.
