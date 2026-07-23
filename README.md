# QA Dashboard

Multi-device manual testing dashboard for Android ([scrcpy](https://github.com/Genymobile/scrcpy)) and iOS ([libimobiledevice](https://libimobiledevice.org/)). Local UI with light/dark theme (same visual language as [davidcoen.it](https://davidcoen.it)).

**Version:** 0.1

## Requirements

- **Linux workstation** (tested on CachyOS)
- **Python 3.11+**
- **Node.js 20+** (to build the frontend)
- **Android:** `adb`, `scrcpy` (USB debugging enabled)
- **iOS:** `libimobiledevice` (`idevice_id`, `ideviceinfo`, `idevicescreenshot`; optional app version via AUR `ideviceinstaller`)

```bash
# Arch / CachyOS — ideviceinstaller is not in the official repos
sudo pacman -S android-tools scrcpy libimobiledevice

# Optional (iOS app version label only): AUR
# yay -S ideviceinstaller
```

## Quick start

```bash
cd "~/Documenti/QA Dashboard"
chmod +x start.sh
./start.sh
```

Open **http://127.0.0.1:9470/**

The script creates a Python venv, installs dependencies, builds the web UI if needed, and starts the server.

## Development

Terminal 1 — backend:

```bash
cd "~/Documenti/QA Dashboard"
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m server.main
```

Terminal 2 — frontend with hot reload:

```bash
cd "~/Documenti/QA Dashboard/web"
npm install
npm run dev
```

Use **http://127.0.0.1:5173/** (proxies API/WebSocket to port 9470).

Rebuild the production UI after frontend changes:

```bash
cd web && npm run build
```

## Usage

1. Connect phone(s) via USB.
2. Android: accept USB debugging. iOS: tap **Trust** on the device.
3. Click **Add device (USB)** / **Connect device** (+) → pick a device.
4. Click the large **+** to add another column and select the next device.
5. Each slot shows device name and foreground app / Edge build when detected.
6. Toggle theme with sun/moon in the sidebar (same pattern as davidcoen.it).
7. Open **Settings** (gear) for capture path, encrypted Edge account vault, sidebar actions, and custom ADB buttons.

Remove a device with **×** on its header.

### Device control (Android)

- **Click / drag** on the mirrored screen (scrcpy-style touch)
- **Keyboard** while the canvas is focused (click the screen): printable keys → text input; `Backspace` / `Esc` → back; `Home` → home; `Enter` → enter
- System navigation is available via the mirrored UI (and related control messages)

For higher stream resolution, change `max_size` in `config.yaml` (e.g. `1440`, or `0` for no limit).

### Sidebar actions

Launch / stop / capture / device actions (Edge, Edge Develop, Edge account, Arkade, screenshots, screen record, airplane mode, reboot, kill apps, etc.) can be toggled in Settings. Custom ADB one-shots can be added there as well.

**Start Edge account** lists local users from the device SideMenu / PIN UI and from the encrypted vault (`~/.config/qa-dashboard/`). Saved passwords and PINs never leave this machine.

## Configuration

Edit `config.yaml`:

| Key | Purpose |
|-----|---------|
| `server.host` / `server.port` | Bind address (default `127.0.0.1:9470`) |
| `scrcpy.*` | Stream quality (`max_size` default **1080**, `bit_rate`, `max_fps`, server jar/version) |
| `ios.screenshot_fps` | iOS refresh rate (default 8 fps) |
| `apps.edge.*` / `apps.edge_develop.*` | Package / bundle IDs for labels and launch |
| `chrome.android` | Chrome package for PWA / URL open |
| `pwas` | Known PWAs (name + hosts) for foreground detection |

Device mockup frames live under `web/public/mockups/` — see [web/public/mockups/README.md](web/public/mockups/README.md).

## Architecture

| Layer | Stack |
|-------|--------|
| UI | React + Vite, WebCodecs (Android H.264), JPEG stream (iOS) |
| API | FastAPI — `/api/devices`, `/api/settings`, `/api/actions/*`, WebSocket `/ws/stream/{id}` |
| Android | scrcpy server jar + adb forward + UI Automator for Edge account flows |
| Vault | Local Fernet-encrypted credentials under `~/.config/qa-dashboard/` |

**iOS control (mouse/keyboard):** requires [WebDriverAgent](https://github.com/appium/WebDriverAgent) on the device (Xcode: build & run `WebDriverAgentRunner` once). Without WDA, streaming still works; taps/typing show an error in the status pill.

## Troubleshooting

- **No devices listed:** `adb devices -l` / `idevice_id -l`
- **Black Android stream:** confirm `scrcpy` works standalone; check `config.yaml` `server_version` (default `4.1` for scrcpy 4.x)
- **iOS screenshot fails:** install `libimobiledevice`, unlock the device, re-trust USB
- **iOS control fails:** install WebDriverAgent on the iPhone (Xcode → `WebDriverAgent.xcodeproj` → run `WebDriverAgentRunner`). Keep Developer Mode on.
- **App version missing (iOS):** optional `yay -S ideviceinstaller`, or add the bundle ID in `config.yaml` (without ideviceinstaller you still get device name + platform)

## License / credit

Built for local QA workflows by [davidcoen.it](https://davidcoen.it).
