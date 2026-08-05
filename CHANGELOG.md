# Changelog

All notable changes to QA Dashboard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] — 2026-08-05

### Fixed

- **Sidebar layout** — top of the QA Dashboard card and bottom of the footer (settings + version links) align with the workspace rectangle; sidebar and workspace now share the same column height via flex stretch.

## [0.6.0] — 2026-08-04

### Added

- **Hidden easter egg** — a small in-app diversion for curious clickers.

## [0.5.1] — 2026-08-04

### Fixed

- **Focus / REC ring** — outline follows the phone bezel again (was sized to the rotate wrapper including the Live footer) and is no longer clipped by Liquid slot `overflow: hidden`.

## [0.5.0] — 2026-08-04

### Added

- **Appearance themes** — Settings → Appearance: **Default**, **Liquid** (glass chrome), and **Custom** (background only). Preference persisted in `localStorage` (`qa_dashboard_appearance_v2`).
- **Liquid backgrounds** — bundled wallpaper, solid color map, or custom image; Liquid glass follows the sidebar light / dark toggle.
- **Custom backgrounds** — color swatches + file picker (data URL, local only).

### Changed

- Liquid surfaces use theme tokens so light and dark stay readable over wallpapers and solid colors.

## [0.4.0] — 2026-08-04

### Added

- **iPhone 15 mockup** — WithFrame bezel + `screenMask` for Dynamic Island / inner perimeter clip; match rules for iPhone 15 / Pro / Plus / Pro Max.
- **Screen masks** — optional `screenMask` on mockup profiles (Samsung S26, Xiaomi 13T Pro, iPhone 15) so the stream follows the frame hole instead of a CSS-only radius.
- **Android trackpad / mouse-wheel scroll** — two-finger and wheel input inject a touch-drag via scrcpy (with touch-slop and post-scroll click suppression so scrolls are not taps).
- **iOS userspace DVT stream** — on iOS 17+ the mirror uses pymobiledevice3’s in-process RemoteXPC tunnel (no sudo `tunneld`); persistent screenshot session + JPEG frames (Pillow). Requires `pymobiledevice3>=10.3.1`.

### Fixed

- **Mockup corner gaps** — stream clipping aligned to inner bezels (Samsung / Xiaomi / iPhone); elliptical radii preserved where needed so the Dynamic Island is not over-rounded.
- **High-frequency control lag** — touch / scroll / key messages are sent on the event loop instead of the default executor so wheel input does not stall.

## [0.3.3] — 2026-08-04

### Fixed

- **Stream display lag** — Android WebCodecs decoder uses `optimizeForLatency` / hardware decode and drops late delta frames until the next keyframe so backlog no longer grows into visible delay; video TCP sockets enable `TCP_NODELAY` and scrcpy requests realtime MediaCodec priority; iOS screenshot pacing no longer adds a full sleep after a slow capture.

## [0.3.2] — 2026-08-03

### Fixed

- **Device copy → PC clipboard** — on-device Copy now writes the host clipboard via `wl-copy`/`xclip` (not only Ctrl/⌘+C). A short post-connect grace window still ignores the stale device clip so reconnects do not clobber the PC clipboard.
- **Stream freeze on paste** — long LN invoices no longer use `adb input text` (which stalled the device UI/encoder). Paste uses scrcpy `SET_CLIPBOARD` + `PASTE` again, with adb only as fallback; clipboard broadcast to other devices is non-blocking.

## [0.3.1] — 2026-08-01

### Fixed

- **Device-to-device clipboard paste** — server keeps per-device clipboard memory and, on copy, pushes the text onto other mirrored devices’ clipboards (so the Xiaomi IME chip is not stuck on stale local text). Paste types via `adb input text` (MIUI Notes WebView) and also updates the target clipboard before typing.

## [0.3.0] — 2026-07-27

### Added

- **Stream quality** — Settings → General presets (Low / Medium / High 30 / High / Ultra) for Android scrcpy mirrors; reconnect the device to apply.
- **Screen OFF / ON** — blank the physical panel while the mirror stays interactive (scrcpy `SET_DISPLAY_POWER` + Android `display power-reset`, no POWER lock).
- **Collapsible sidebar groups** — Launch / Stop / Capture / Device / Custom ADB collapse state persists in `localStorage`.
- **Workspace screenshot control** — camera button next to Rec when a single Android device is connected.

### Fixed

- **Screenshot shutter sound** — play on the user gesture (before the API round-trip) so WebKitGTK does not block audio.
- **Desktop Settings stale UI** — no-store for `index.html`, cache-busting URL, and a fresh WebKit storage folder so new Settings controls appear after upgrades.

## [0.2.3] — 2026-07-24

### Fixed

- **Desktop “no devices” when API died** — uvicorn runs as an owned child process instead of a daemon thread, with clean shutdown on exit.
- **Misleading empty device list** — status pill shows **Backend offline** when `/api/devices` is unreachable (header note prompts restart).

## [0.2.2] — 2026-07-24

### Fixed

- **Desktop window blank** — pywebview default `private_mode` disabled `localStorage` in WebKitGTK; shell now uses persistent storage and guards theme `localStorage` access.
- **Dash to Dock generic icon** — GTK application id `it.davidcoen.qa-dashboard` matches the installed `.desktop`; PNG icon sizes installed for the dock.

### Changed

- Desktop launcher id is now `it.davidcoen.qa-dashboard.desktop` (`./install-desktop.sh`); Wayland WebKit compositing workaround via `WEBKIT_DISABLE_COMPOSITING_MODE`.

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
