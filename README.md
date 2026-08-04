# QA Dashboard

Multi-device manual testing dashboard for Android ([scrcpy](https://github.com/Genymobile/scrcpy)) and iOS ([libimobiledevice](https://libimobiledevice.org/)). Local UI with light/dark theme, plus Appearance presets (Default, Liquid Glass, Custom backgrounds) in Settings.

**Version:** 0.5.1

## Requirements

- **Linux workstation** (tested on CachyOS)
- **Python 3.11+**
- **Node.js 20+** (to build the frontend)
- **Android:** `adb`, `scrcpy` (USB debugging enabled)
- **iOS:** `libimobiledevice` (`idevice_id`, `ideviceinfo`, `idevicescreenshot`; optional app version via AUR `ideviceinstaller`)
- **Clipboard (screenshots):** `wl-clipboard` (Wayland) or `xclip` (X11) so captures can be pasted into other apps

```bash
# Arch / CachyOS — ideviceinstaller is not in the official repos
sudo pacman -S android-tools scrcpy libimobiledevice python-gobject webkit2gtk-4.1 wl-clipboard

# Optional (iOS app version label only): AUR
# yay -S ideviceinstaller
```

## Quick start

```bash
git clone https://github.com/theDavidCoen/QADashboard.git
cd QADashboard
chmod +x start.sh
./start.sh
```

Open **http://127.0.0.1:9470/**

The script creates a Python venv, installs dependencies, builds the web UI if needed, and starts the server.

### Desktop app (app menu)

For daily use without a browser tab, install a user launcher (GNOME/KDE) from the **repository root**:

```bash
chmod +x install-desktop.sh start-app.sh
./install-desktop.sh
```

Then open **QA Dashboard** from the app menu (or `./start-app.sh`). That starts the API if needed and opens a native window via [pywebview](https://pywebview.flowrl.com/) (WebKitGTK on Linux).

**System packages (Arch/CachyOS):** `python-gobject` and `webkit2gtk-4.1` (for the GTK webview). The project venv is created with `--system-site-packages` so `gi` is visible.

Development and new features: keep using `./start.sh` + browser (or Vite on `:5173`). The desktop window is only the everyday shell.

## Development

From the repository root.

Terminal 1 — backend:

```bash
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m server.main
```

Terminal 2 — frontend with hot reload:

```bash
cd web
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

**Start Edge account** lists local users from the device SideMenu / PIN UI and from the encrypted vault. See [Credential vault](#credential-vault) below.

## Credential vault

The vault stores **Edge account passwords and/or PINs** on this machine so **Start Edge account** can select a user and log in without retyping secrets each time. Files live under `~/.config/qa-dashboard/` by default (path configurable in Settings).

### What it does

- Saves username + password and/or PIN for Edge test accounts
- Decrypts credentials only in the local FastAPI process when you unlock the vault (if a master password is set) and run an Edge account action
- Exposes to the UI/API only **usernames** and flags like `hasPassword` / `hasPin` — never the secret values in responses or logs meant for the browser

### Encryption

At rest the vault blob is encrypted with **[Fernet](https://cryptography.io/en/latest/fernet/)** from the `cryptography` library:

| Piece | Detail |
|-------|--------|
| Cipher | **AES-128** in CBC mode |
| Integrity | **HMAC-SHA256** (authenticated encryption — tampering is detected) |
| Why Fernet | Standard, audited construction for encrypting small secrets at rest; one API for encrypt + MAC so ciphertext cannot be silently altered |

**Key material** (choose one mode in Settings):

1. **Master password** — key derived with **PBKDF2-HMAC-SHA256** (390 000 iterations) and a per-vault salt file. Prefer this if the disk may be shared or backed up.
2. **Machine key** — a random Fernet key in `~/.config/qa-dashboard/credentials.key` (mode `0600`). Convenient for a single trusted workstation; anyone with that file can decrypt the vault.

Plaintext credentials are **not** written to disk. The master password, when used, is kept only in process memory after unlock until lock/restart — it is not stored.

### Never online

The vault is **local-only**. Credentials are **not** uploaded, synced, or sent to any remote service (no cloud, no Edge servers, no telemetry). They are used only over USB/`adb` on devices you control, from this workstation.

Keep `server.host` at **`127.0.0.1`** (the default). Do **not** bind to `0.0.0.0` or a LAN IP: the dashboard API has no auth, and Settings / Edge-account flows can send vault unlock and account secrets in request bodies. Exposing the port on the network would let anyone on that network use the API and potentially reach those endpoints.

## Configuration

Edit `config.yaml`:

| Key | Purpose |
|-----|---------|
| `server.host` / `server.port` | Bind address (default **`127.0.0.1:9470`** — keep loopback only; see [Never online](#never-online)) |
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
| Vault | Local Fernet (AES-128 + HMAC) credential store — see [Credential vault](#credential-vault) |

**iOS control (mouse/keyboard):** requires [WebDriverAgent](https://github.com/appium/WebDriverAgent) on the device (Xcode: build & run `WebDriverAgentRunner` once). Without WDA, streaming still works; taps/typing show an error in the status pill.

## Troubleshooting

- **No devices listed:** `adb devices -l` / `idevice_id -l`
- **Black Android stream:** confirm `scrcpy` works standalone; check `config.yaml` `server_version` (default `4.1` for scrcpy 4.x)
- **iOS screenshot fails:** install `libimobiledevice`, unlock the device, re-trust USB
- **iOS control fails:** install WebDriverAgent on the iPhone (Xcode → `WebDriverAgent.xcodeproj` → run `WebDriverAgentRunner`). Keep Developer Mode on.
- **App version missing (iOS):** optional `yay -S ideviceinstaller`, or add the bundle ID in `config.yaml` (without ideviceinstaller you still get device name + platform)

## License / credit

Built for local QA workflows by [davidcoen.it](https://davidcoen.it).
