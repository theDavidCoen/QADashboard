# Changelog

All notable changes to QA Dashboard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
