"""Batch ADB actions for the QA Dashboard sidebar."""

from __future__ import annotations

import asyncio
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from .config import load_config
from .devices import DeviceInfo, list_devices_sync

AppKey = Literal["edge", "edge_develop"]


@dataclass(slots=True)
class ActionResult:
    device_id: str
    name: str
    ok: bool
    detail: str | None = None

    def to_dict(self) -> dict:
        return {
            "deviceId": self.device_id,
            "name": self.name,
            "ok": self.ok,
            "detail": self.detail,
        }


def _run(cmd: list[str], timeout: float = 12.0) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        text = (result.stdout or "") + (result.stderr or "")
        return result.returncode, text.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return 1, str(exc)


def _android_packages(app: AppKey) -> list[str]:
    cfg = load_config().get("apps", {})
    key = "edge_develop" if app == "edge_develop" else "edge"
    group = cfg.get(key) or {}
    packages = list(group.get("android") or [])
    if packages:
        return packages
    # Hardcoded fallbacks if config is incomplete
    if app == "edge_develop":
        return ["app.edge.develop"]
    return ["co.edgesecure.app", "co.edgesecure.app.staging"]


def _chrome_package() -> str:
    cfg = load_config().get("chrome", {})
    return str(cfg.get("android") or "com.android.chrome")


def _resolve_targets(
    device_ids: list[str] | None,
    *,
    android_only: bool = True,
) -> list[DeviceInfo]:
    devices = list_devices_sync()
    if device_ids:
        wanted = set(device_ids)
        devices = [d for d in devices if d.id in wanted]
    if android_only:
        devices = [d for d in devices if d.platform == "android"]
    return devices


def _package_installed(serial: str, package: str) -> bool:
    code, out = _run(["adb", "-s", serial, "shell", "pm", "path", package], timeout=6)
    return code == 0 and "package:" in out


def start_app_on_device(device: DeviceInfo, app: AppKey) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    for package in _android_packages(app):
        if not _package_installed(device.id, package):
            continue
        code, out = _run(
            [
                "adb",
                "-s",
                device.id,
                "shell",
                "monkey",
                "-p",
                package,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            ],
            timeout=15,
        )
        if code == 0 and "Error" not in out and "No activities" not in out:
            return ActionResult(device.id, device.name, True, f"Started {package}")
        # Fallback to am start with resolved activity
        _, resolve = _run(
            ["adb", "-s", device.id, "shell", "cmd", "package", "resolve-activity", "--brief", package],
            timeout=8,
        )
        activity = None
        for line in resolve.splitlines():
            line = line.strip()
            if "/" in line and not line.startswith("priority"):
                activity = line
        if activity:
            code2, out2 = _run(
                ["adb", "-s", device.id, "shell", "am", "start", "-n", activity],
                timeout=12,
            )
            if code2 == 0 and "Error" not in out2:
                return ActionResult(device.id, device.name, True, f"Started {activity}")
            return ActionResult(device.id, device.name, False, out2 or out or "Launch failed")
        return ActionResult(device.id, device.name, False, out or f"{package} launch failed")

    label = "Edge Develop" if app == "edge_develop" else "Edge"
    return ActionResult(device.id, device.name, False, f"{label} not installed")


def open_url_on_device(device: DeviceInfo, url: str) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    chrome = _chrome_package()
    code, out = _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            url,
            chrome,
        ],
        timeout=12,
    )
    if code == 0 and "Error" not in out:
        return ActionResult(device.id, device.name, True, f"Opened in {chrome}")
    # Fallback: any handler
    code2, out2 = _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            url,
        ],
        timeout=12,
    )
    if code2 == 0 and "Error" not in out2:
        return ActionResult(device.id, device.name, True, "Opened with default browser")
    return ActionResult(device.id, device.name, False, out2 or out or "Open URL failed")


def get_airplane_mode(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    code, out = _run(
        ["adb", "-s", device.id, "shell", "cmd", "connectivity", "airplane-mode"],
        timeout=8,
    )
    if code == 0 and out.strip():
        enabled = out.strip().lower() in {"enabled", "1", "true", "on"}
        return ActionResult(device.id, device.name, True, "on" if enabled else "off")
    # Fallback: settings global
    _, setting = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "global", "airplane_mode_on"],
        timeout=8,
    )
    if setting.strip() in {"1", "0"}:
        return ActionResult(device.id, device.name, True, "on" if setting.strip() == "1" else "off")
    return ActionResult(device.id, device.name, False, out or setting or "Status failed")


def set_airplane_mode(device: DeviceInfo, enabled: bool) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    mode = "enable" if enabled else "disable"
    code, out = _run(
        ["adb", "-s", device.id, "shell", "cmd", "connectivity", "airplane-mode", mode],
        timeout=10,
    )
    # OEM fallback (MIUI / older): settings + broadcast
    flag = "1" if enabled else "0"
    _run(
        ["adb", "-s", device.id, "shell", "settings", "put", "global", "airplane_mode_on", flag],
        timeout=8,
    )
    _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "am",
            "broadcast",
            "-a",
            "android.intent.action.AIRPLANE_MODE",
            "--ez",
            "state",
            "true" if enabled else "false",
        ],
        timeout=8,
    )
    # Verify
    status = get_airplane_mode(device)
    if status.ok and ((enabled and status.detail == "on") or ((not enabled) and status.detail == "off")):
        return ActionResult(device.id, device.name, True, status.detail)
    if code == 0:
        return ActionResult(device.id, device.name, True, "on" if enabled else "off")
    return ActionResult(device.id, device.name, False, out or f"Airplane mode {mode} failed")


def normalize_http_url(raw: str) -> str | None:
    text = raw.strip()
    if not text:
        return None
    if not re.match(r"^https?://", text, re.I):
        text = f"https://{text}"
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return text


def run_start_app(app: AppKey, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [start_app_on_device(d, app) for d in _resolve_targets(device_ids)]


def run_open_url(url: str, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [open_url_on_device(d, url) for d in _resolve_targets(device_ids)]


def run_airplane_mode(
    enabled: bool,
    device_ids: list[str] | None = None,
) -> list[ActionResult]:
    return [set_airplane_mode(d, enabled) for d in _resolve_targets(device_ids)]


def run_airplane_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [get_airplane_mode(d) for d in _resolve_targets(device_ids)]


def _force_stop_packages() -> list[str]:
    packages: list[str] = []
    for app in ("edge", "edge_develop"):
        for package in _android_packages(app):  # type: ignore[arg-type]
            if package not in packages:
                packages.append(package)
    return packages


def force_stop_on_device(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    stopped: list[str] = []
    errors: list[str] = []
    for package in _force_stop_packages():
        if not _package_installed(device.id, package):
            continue
        code, out = _run(
            ["adb", "-s", device.id, "shell", "am", "force-stop", package],
            timeout=10,
        )
        if code == 0:
            stopped.append(package)
        else:
            errors.append(out or package)
    if stopped:
        return ActionResult(device.id, device.name, True, f"Stopped {', '.join(stopped)}")
    if errors:
        return ActionResult(device.id, device.name, False, errors[0])
    return ActionResult(device.id, device.name, False, "No target apps installed")


def reboot_device(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    code, out = _run(["adb", "-s", device.id, "reboot"], timeout=20)
    if code == 0:
        return ActionResult(device.id, device.name, True, "Rebooting")
    # Some builds return non-zero even when reboot starts
    if "error" not in out.lower() and "fail" not in out.lower():
        return ActionResult(device.id, device.name, True, "Rebooting")
    code2, out2 = _run(["adb", "-s", device.id, "shell", "svc", "power", "reboot"], timeout=15)
    if code2 == 0:
        return ActionResult(device.id, device.name, True, "Rebooting")
    return ActionResult(device.id, device.name, False, out2 or out or "Reboot failed")


def screenshots_dir() -> Path:
    from .settings_store import load_settings

    raw = load_settings().get("capturePath") or str(Path.home() / "Immagini" / "Schermate")
    path = Path(str(raw)).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_slug(text: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", text.strip()) or "device"
    return slug.strip("-")[:48]


def screenshot_device(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    local = screenshots_dir() / f"QA-{_safe_slug(device.name)}-{stamp}.png"

    # Prefer exec-out (no device temp file; reliable with scrcpy active)
    try:
        result = subprocess.run(
            ["adb", "-s", device.id, "exec-out", "screencap", "-p"],
            capture_output=True,
            timeout=25,
            check=False,
        )
        data = result.stdout or b""
        if result.returncode == 0 and data.startswith(b"\x89PNG") and len(data) > 1000:
            local.write_bytes(data)
            return ActionResult(device.id, device.name, True, str(local))
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        exec_err = str(exc)
    else:
        exec_err = (result.stderr or b"").decode("utf-8", errors="replace")[:200]

    remote = f"/data/local/tmp/qa-dashboard-{stamp}.png"
    code, out = _run(
        ["adb", "-s", device.id, "shell", "screencap", "-p", remote],
        timeout=20,
    )
    if code != 0:
        return ActionResult(
            device.id,
            device.name,
            False,
            out or exec_err or "screencap failed",
        )

    code2, out2 = _run(["adb", "-s", device.id, "pull", remote, str(local)], timeout=30)
    _run(["adb", "-s", device.id, "shell", "rm", "-f", remote], timeout=8)
    if code2 != 0 or not local.is_file() or local.stat().st_size < 1000:
        return ActionResult(device.id, device.name, False, out2 or "pull failed")
    return ActionResult(device.id, device.name, True, str(local))


_recording_procs: dict[str, subprocess.Popen[str]] = {}
_recording_remotes: dict[str, str] = {}


def screenrecord_start(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    if device.id in _recording_procs:
        return ActionResult(device.id, device.name, False, "Already recording")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    # /data/local/tmp is more reliable than /sdcard on some OEMs with scrcpy
    remote = f"/data/local/tmp/qa-dashboard-{stamp}.mp4"
    _run(["adb", "-s", device.id, "shell", "rm", "-f", remote], timeout=8)
    try:
        proc = subprocess.Popen(
            [
                "adb",
                "-s",
                device.id,
                "shell",
                "screenrecord",
                "--bit-rate",
                "8000000",
                "--time-limit",
                "180",
                remote,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError:
        return ActionResult(device.id, device.name, False, "adb not found")

    time.sleep(0.6)
    if proc.poll() is not None:
        err = (proc.stderr.read() if proc.stderr else "") or "screenrecord exited"
        return ActionResult(device.id, device.name, False, err.strip())

    _recording_procs[device.id] = proc
    _recording_remotes[device.id] = remote
    return ActionResult(device.id, device.name, True, "Recording…")


def screenrecord_stop(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    proc = _recording_procs.pop(device.id, None)
    remote = _recording_remotes.pop(device.id, None)
    if proc is None or remote is None:
        return ActionResult(device.id, device.name, False, "No active recording")

    # Graceful stop: SIGINT to screenrecord on device
    _run(["adb", "-s", device.id, "shell", "pkill", "-SIGINT", "screenrecord"], timeout=8)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        _run(["adb", "-s", device.id, "shell", "pkill", "-9", "screenrecord"], timeout=8)

    # screenrecord needs a moment to finalize the file
    time.sleep(0.8)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    local = screenshots_dir() / f"QA-{_safe_slug(device.name)}-{stamp}.mp4"
    code, out = _run(["adb", "-s", device.id, "pull", remote, str(local)], timeout=60)
    _run(["adb", "-s", device.id, "shell", "rm", "-f", remote], timeout=8)
    if code != 0 or not local.is_file() or local.stat().st_size < 100:
        return ActionResult(device.id, device.name, False, out or "pull failed / empty file")
    return ActionResult(device.id, device.name, True, str(local))


def screenrecord_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    devices = _resolve_targets(device_ids)
    results: list[ActionResult] = []
    for device in devices:
        active = device.id in _recording_procs
        results.append(
            ActionResult(
                device.id,
                device.name,
                True,
                "recording" if active else "idle",
            )
        )
    return results


def run_force_stop(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [force_stop_on_device(d) for d in _resolve_targets(device_ids)]


def run_reboot(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [reboot_device(d) for d in _resolve_targets(device_ids)]


def run_screenshot(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [screenshot_device(d) for d in _resolve_targets(device_ids)]


async def force_stop_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_force_stop, device_ids)


async def reboot_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_reboot, device_ids)


async def screenshot_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_screenshot, device_ids)


async def screenrecord_start_async(device_id: str) -> ActionResult:
    loop = asyncio.get_running_loop()

    def _run_one() -> ActionResult:
        devices = _resolve_targets([device_id])
        if not devices:
            return ActionResult(device_id, device_id, False, "Device not found")
        return screenrecord_start(devices[0])

    return await loop.run_in_executor(None, _run_one)


async def screenrecord_stop_async(device_id: str) -> ActionResult:
    loop = asyncio.get_running_loop()

    def _run_one() -> ActionResult:
        devices = _resolve_targets([device_id])
        if not devices:
            return ActionResult(device_id, device_id, False, "Device not found")
        return screenrecord_stop(devices[0])

    return await loop.run_in_executor(None, _run_one)


async def start_app_async(app: AppKey, device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_start_app, app, device_ids)


async def open_url_async(url: str, device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_open_url, url, device_ids)


@dataclass(slots=True)
class OpenWebSession:
    name: str
    url: str
    source: str  # chrome | webapk | browser
    package: str | None = None
    device_id: str | None = None
    device_name: str | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "url": self.url,
            "source": self.source,
            "package": self.package,
            "deviceId": self.device_id,
            "deviceName": self.device_name,
        }


def _arkade_hosts() -> set[str]:
    hosts: set[str] = set()
    for entry in load_config().get("pwas", []) or []:
        name = str(entry.get("name") or entry.get("label") or "").lower()
        entry_hosts = entry.get("hosts") or entry.get("match_hosts") or []
        # Prefer explicit arkade hosts; also include any entry whose name mentions arkade
        for host in entry_hosts:
            host_l = str(host).lower().strip()
            if not host_l:
                continue
            if "arkade" in host_l or "arkade" in name:
                hosts.add(host_l)
        url = str(entry.get("url") or "")
        if "arkade" in url.lower():
            try:
                hosts.add(urlparse(url).netloc.lower())
            except Exception:
                pass
    if not hosts:
        hosts.add("arkade.money")
    return hosts


def _url_matches_hosts(url: str, hosts: set[str]) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    host = (parsed.netloc or "").lower()
    if not host:
        return False
    return any(host == h or host.endswith("." + h) for h in hosts)


def _normalize_session_url(url: str) -> str:
    text = url.strip().rstrip(".,);]'\"")
    if not re.match(r"^https?://", text, re.I):
        text = f"https://{text}"
    parsed = urlparse(text)
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{parsed.scheme}://{parsed.netloc}{path}{query}"


def _session_display_name(url: str, package: str | None = None, apk_label: str | None = None) -> str:
    from .app_info import _config_pwa_for_host

    parsed = urlparse(url)
    host = parsed.netloc.lower()
    pwa = _config_pwa_for_host(host)
    base = apk_label or (str(pwa.get("name") or pwa.get("label")) if pwa else None) or "Arkade"
    path = parsed.path or "/"
    if path not in ("/", ""):
        short = path if len(path) <= 42 else path[:39] + "…"
        return f"{base} · {short}"
    return str(base)


def _extract_http_urls(text: str) -> list[str]:
    found: list[str] = []
    for match in re.finditer(r"https?://[^\s\"'<>\]]+", text):
        raw = match.group(0).rstrip(".,);]'\"")
        # Collapse dumpsys truncation markers like https://arkade.money/...
        if raw.endswith("..."):
            raw = raw[:-3]
        found.append(raw)
    return found


def _find_arkade_sessions_on_device(device: DeviceInfo) -> list[OpenWebSession]:
    from .app_info import _cached_apk_label, _package_versions, _webapk_host

    hosts = _arkade_hosts()
    chrome = _chrome_package()
    by_url: dict[str, OpenWebSession] = {}

    def add(url: str, source: str, package: str | None = None, apk_label: str | None = None) -> None:
        if not _url_matches_hosts(url, hosts):
            return
        normalized = _normalize_session_url(url)
        if normalized in by_url:
            return
        by_url[normalized] = OpenWebSession(
            name=_session_display_name(normalized, package, apk_label),
            url=normalized,
            source=source,
            package=package,
            device_id=device.id,
            device_name=device.name,
        )

    # Recent tasks + activity dumps often retain VIEW intents with dat=https://…
    for dump_cmd in (
        ["adb", "-s", device.id, "shell", "dumpsys", "activity", "recents"],
        ["adb", "-s", device.id, "shell", "dumpsys", "activity", "activities"],
    ):
        _, out = _run(dump_cmd, timeout=12)
        for url in _extract_http_urls(out):
            source = "chrome" if chrome in out[max(0, out.find(url) - 120) : out.find(url) + 80] else "browser"
            # Prefer chrome when package appears near the URL
            idx = out.find(url)
            window = out[max(0, idx - 200) : idx + 200]
            if chrome in window or "com.android.chrome" in window:
                source = "chrome"
            elif "firefox" in window.lower():
                source = "browser"
            add(url, source)

    # Installed WebAPKs for Arkade hosts (PWA windows)
    _, pkg_out = _run(["adb", "-s", device.id, "shell", "pm", "list", "packages"], timeout=10)
    for line in pkg_out.splitlines():
        if "webapk" not in line or not line.startswith("package:"):
            continue
        package = line.split(":", 1)[1].strip()
        host = _webapk_host(device.id, package)
        if not host or not any(host == h or host.endswith("." + h) for h in hosts):
            continue
        version_name, version_code = _package_versions(device.id, package)
        label = _cached_apk_label(device.id, package, version_code or version_name or "0")
        add(f"https://{host}", "webapk", package=package, apk_label=label)

    return list(by_url.values())


def list_arkade_sessions(device_ids: list[str] | None = None) -> list[OpenWebSession]:
    """Open Arkade Chrome/WebAPK sessions across target Android devices (deduped by URL)."""
    merged: dict[str, OpenWebSession] = {}
    for device in _resolve_targets(device_ids):
        for session in _find_arkade_sessions_on_device(device):
            key = session.url.lower()
            existing = merged.get(key)
            if not existing:
                merged[key] = session
                continue
            # Prefer chrome/webapk over generic browser; keep first device name
            rank = {"webapk": 0, "chrome": 1, "browser": 2}
            if rank.get(session.source, 9) < rank.get(existing.source, 9):
                merged[key] = session
    return sorted(merged.values(), key=lambda item: item.name.lower())


async def list_arkade_sessions_async(device_ids: list[str] | None = None) -> list[OpenWebSession]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, list_arkade_sessions, device_ids)


async def airplane_mode_async(
    enabled: bool,
    device_ids: list[str] | None = None,
) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_airplane_mode, enabled, device_ids)


async def airplane_status_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_airplane_status, device_ids)


@dataclass(slots=True)
class LaunchableApp:
    package: str
    activity: str
    label: str

    def to_dict(self) -> dict:
        return {
            "package": self.package,
            "activity": self.activity,
            "label": self.label,
        }


_launcher_cache: dict[str, tuple[float, list[LaunchableApp]]] = {}
_LAUNCHER_TTL = 90.0

_KNOWN_LABELS = {
    "co.edgesecure.app": "Edge",
    "co.edgesecure.app.staging": "Edge Staging",
    "app.edge.develop": "Edge Develop",
    "com.android.chrome": "Chrome",
    "com.android.settings": "Settings",
    "com.android.camera": "Camera",
    "com.android.vending": "Play Store",
    "com.google.android.apps.maps": "Maps",
    "com.google.android.gm": "Gmail",
    "com.whatsapp": "WhatsApp",
    "org.telegram.messenger": "Telegram",
}


def _friendly_label(package: str, activity: str) -> str:
    if package in _KNOWN_LABELS:
        return _KNOWN_LABELS[package]
    cfg = load_config().get("apps", {})
    for group in cfg.values():
        if package in (group.get("android") or []):
            return str(group.get("label") or group.get("name") or package)
    # Prefer last package segment; fall back to activity class short name
    leaf = package.rsplit(".", 1)[-1]
    if leaf and leaf.lower() not in {"app", "android", "main", "ui"}:
        return leaf.replace("_", " ").title()
    act = activity.rsplit(".", 1)[-1]
    return act or package


def list_launchable_apps(serial: str) -> list[LaunchableApp]:
    now = time.monotonic()
    cached = _launcher_cache.get(serial)
    if cached and now - cached[0] < _LAUNCHER_TTL:
        return cached[1]

    code, out = _run(
        [
            "adb",
            "-s",
            serial,
            "shell",
            "cmd package query-activities --brief "
            "-a android.intent.action.MAIN "
            "-c android.intent.category.LAUNCHER",
        ],
        timeout=20,
    )
    if code != 0 and not out:
        return []

    apps: list[LaunchableApp] = []
    seen: set[str] = set()
    for line in out.splitlines():
        line = line.strip()
        if "/" not in line or line.startswith("priority") or "Activity #" in line:
            continue
        if line.startswith("370 ") or "activities found" in line:
            continue
        package, _, rest = line.partition("/")
        package = package.strip()
        activity_class = rest.strip()
        if not package or not activity_class or package in seen:
            continue
        if package.count(".") < 1:
            continue
        seen.add(package)
        component = f"{package}/{activity_class}"
        apps.append(
            LaunchableApp(
                package=package,
                activity=component,
                label=_friendly_label(package, activity_class),
            )
        )

    apps.sort(key=lambda item: item.label.lower())
    _launcher_cache[serial] = (now, apps)
    return apps


def start_package_on_device(device: DeviceInfo, package: str, activity: str | None = None) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    package = package.strip()
    if not package:
        return ActionResult(device.id, device.name, False, "Missing package")

    # Prefer explicit component when available
    component = (activity or "").strip()
    if component and "/" not in component:
        component = f"{package}/{component}"
    if component.startswith("/"):
        component = f"{package}{component}"

    if component and "/" in component:
        code, out = _run(
            ["adb", "-s", device.id, "shell", "am", "start", "-n", component],
            timeout=12,
        )
        if code == 0 and "Error" not in out and "Exception" not in out:
            return ActionResult(device.id, device.name, True, f"Started {package}")

    # LAUNCHER intent for the package (more reliable than monkey on some OEMs)
    code, out = _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            "-p",
            package,
        ],
        timeout=12,
    )
    if code == 0 and "Error" not in out and "Exception" not in out:
        return ActionResult(device.id, device.name, True, f"Started {package}")

    code, out = _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "monkey",
            "-p",
            package,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
        timeout=15,
    )
    if code == 0 and "Error" not in out and "No activities" not in out:
        return ActionResult(device.id, device.name, True, f"Started {package}")
    return ActionResult(device.id, device.name, False, out or "Launch failed")


def _parse_recent_tasks(dumpsys_out: str) -> list[tuple[int, str, str]]:
    """Return (task_id, task_type, package) from dumpsys activity recents.

    Prefer real packages from mActivityComponent / cmp= / pkg= — not task affinity
    (MIUI uses affinities like ``A=10196:google.android.task.calendar``).
    """
    tasks: list[tuple[int, str, str]] = []
    blocks = re.split(r"\n\s*\* Recent #\d+:\s*", dumpsys_out)
    for block in blocks[1:]:
        header = block.split("\n", 1)[0]
        match = re.search(r"Task\{[^#\n]*#(\d+)\s+type=(\w+)", header)
        if not match:
            continue
        task_id = int(match.group(1))
        task_type = match.group(2)
        package = ""
        for pattern in (
            r"mActivityComponent=([^/\s]+)/",
            r"\bcmp=([^/\s]+)/",
            r"\bpkg=([^\s\}]+)",
            r"\bI=([^/\s]+)/",
            r"\bA=\d+:([^\s\}]+)",
        ):
            found = re.search(pattern, block)
            if found:
                package = found.group(1).strip()
                break
        if "/" in package:
            package = package.split("/", 1)[0]
        tasks.append((task_id, task_type, package))
    return tasks


_LAUNCHER_PACKAGES = {
    "com.miui.home",
    "com.android.launcher",
    "com.android.launcher3",
    "com.google.android.apps.nexuslauncher",
    "com.huawei.android.launcher",
    "com.sec.android.app.launcher",
    "com.oppo.launcher",
    "com.bbk.launcher2",
}


def _is_launcher_or_recents(package: str) -> bool:
    pkg = (package or "").strip().lower()
    if not pkg:
        return False
    if pkg in _LAUNCHER_PACKAGES:
        return True
    if "launcher" in pkg or pkg.endswith(".recents") or ".home.recents" in pkg:
        return True
    return False


def _top_recent_app_task(serial: str) -> tuple[int, str] | None:
    """Most-recent non-home app task (useful while Overview / Recents is showing)."""
    _, out = _run(
        ["adb", "-s", serial, "shell", "dumpsys", "activity", "recents"],
        timeout=15,
    )
    for task_id, task_type, package in _parse_recent_tasks(out):
        if task_type == "home" or _is_launcher_or_recents(package):
            continue
        if package:
            return task_id, package
    return None


def _clear_recent_tasks(
    serial: str,
    *,
    keep_packages: set[str] | None = None,
    only_packages: set[str] | None = None,
) -> int:
    """Remove tasks from the recents/overview list via `cmd activity stack remove`."""
    keep = keep_packages or set()
    only = only_packages
    _, out = _run(
        ["adb", "-s", serial, "shell", "dumpsys", "activity", "recents"],
        timeout=15,
    )
    removed = 0
    for task_id, task_type, package in _parse_recent_tasks(out):
        if task_type == "home" or _is_launcher_or_recents(package):
            continue
        if only is not None and package not in only:
            continue
        if package in keep:
            continue
        code, _ = _run(
            ["adb", "-s", serial, "shell", "cmd", "activity", "stack", "remove", str(task_id)],
            timeout=8,
        )
        if code == 0:
            removed += 1
    return removed


def kill_background_apps(device: DeviceInfo) -> ActionResult:
    """Force-stop every third-party app except the foreground, and clear them from recents."""
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    from .app_info import android_foreground_app
    from . import app_info as app_info_mod

    app_info_mod._app_cache.pop(device.id, None)
    fg = (android_foreground_app(device.id).package or "").strip()
    if _is_launcher_or_recents(fg):
        fg = ""

    fg_q = fg.replace("'", "'\\''")
    script = (
        f"FG='{fg_q}'; "
        "n=0; "
        "for p in $(pm list packages -3 2>/dev/null | cut -d: -f2); do "
        "  [ -z \"$p\" ] && continue; "
        "  [ -n \"$FG\" ] && [ \"$p\" = \"$FG\" ] && continue; "
        "  am force-stop \"$p\" >/dev/null 2>&1; "
        "  n=$((n+1)); "
        "done; "
        "echo STOPPED:$n"
    )
    code, out = _run(["adb", "-s", device.id, "shell", script], timeout=180)
    stopped = 0
    for token in out.split():
        if token.startswith("STOPPED:"):
            try:
                stopped = int(token.split(":", 1)[1])
            except ValueError:
                stopped = 0

    keep = {fg} if fg else set()
    cleared = _clear_recent_tasks(device.id, keep_packages=keep)

    if code == 0 or "STOPPED:" in out:
        keep_txt = f", kept {fg}" if fg else ""
        return ActionResult(
            device.id,
            device.name,
            True,
            f"Force-stopped {stopped} apps, cleared {cleared} from recents{keep_txt}",
        )
    return ActionResult(device.id, device.name, False, out or "force-stop background failed")


def kill_foreground_app(device: DeviceInfo) -> ActionResult:
    """Force-stop the foreground app and remove it from the multitasking/recents list.

    When Overview/Recents is showing (launcher is 'foreground'), kill the top
    visible recent app card instead of trying to force-stop the launcher.
    """
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    from .app_info import android_foreground_app
    from . import app_info as app_info_mod

    app_info_mod._app_cache.pop(device.id, None)
    app = android_foreground_app(device.id)
    target = (app.package or "").strip()
    label = app.name or target
    from_recents = False

    if not target or _is_launcher_or_recents(target):
        top = _top_recent_app_task(device.id)
        if not top:
            return ActionResult(
                device.id,
                device.name,
                False,
                "No app in recents to kill (Overview/home is active)",
            )
        _task_id, target = top
        label = target
        from_recents = True

    only = {target}
    if target.startswith("org.chromium.webapk."):
        only.add("com.android.chrome")

    code, out = _run(
        ["adb", "-s", device.id, "shell", "am", "force-stop", target],
        timeout=12,
    )
    _run(["adb", "-s", device.id, "shell", "am", "force-stop", target], timeout=12)
    if "com.android.chrome" in only:
        _run(
            ["adb", "-s", device.id, "shell", "am", "force-stop", "com.android.chrome"],
            timeout=10,
        )

    cleared = _clear_recent_tasks(device.id, only_packages=only)
    # If Overview is open, also drop the matching stack by id when package clear missed it
    if cleared == 0 and from_recents:
        top = _top_recent_app_task(device.id)
        if top and top[1] == target:
            c, _ = _run(
                ["adb", "-s", device.id, "shell", "cmd", "activity", "stack", "remove", str(top[0])],
                timeout=8,
            )
            if c == 0:
                cleared = 1

    _run(
        ["adb", "-s", device.id, "shell", "input", "keyevent", "KEYCODE_HOME"],
        timeout=8,
    )

    if code == 0:
        where = " (from Overview)" if from_recents else ""
        return ActionResult(
            device.id,
            device.name,
            True,
            f"Force-stopped {label}{where}, cleared {cleared} from recents",
        )
    return ActionResult(device.id, device.name, False, out or "force-stop failed")


def run_start_package(
    package: str,
    activity: str | None = None,
    device_ids: list[str] | None = None,
) -> list[ActionResult]:
    return [start_package_on_device(d, package, activity) for d in _resolve_targets(device_ids)]


def run_kill_background(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [kill_background_apps(d) for d in _resolve_targets(device_ids)]


def run_kill_foreground(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [kill_foreground_app(d) for d in _resolve_targets(device_ids)]


async def list_launchable_apps_async(device_id: str) -> list[LaunchableApp]:
    loop = asyncio.get_running_loop()

    def _run_one() -> list[LaunchableApp]:
        devices = _resolve_targets([device_id])
        if not devices:
            return []
        return list_launchable_apps(devices[0].id)

    return await loop.run_in_executor(None, _run_one)


async def start_package_async(
    package: str,
    activity: str | None = None,
    device_ids: list[str] | None = None,
) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_start_package, package, activity, device_ids)


async def kill_background_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_kill_background, device_ids)


async def kill_foreground_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_kill_foreground, device_ids)


def _split_adb_args(args: str) -> list[str]:
    import shlex

    text = args.strip()
    if text.startswith("adb "):
        text = text[4:].strip()
    return shlex.split(text)


def run_custom_adb(action_id: str, device_ids: list[str] | None = None) -> list[ActionResult]:
    from .settings_store import load_settings

    settings = load_settings()
    action = next(
        (item for item in settings.get("customAdbActions") or [] if item.get("id") == action_id),
        None,
    )
    if not action:
        return []
    try:
        extra = _split_adb_args(str(action.get("args") or ""))
    except ValueError as exc:
        return [ActionResult("", "custom", False, f"Invalid args: {exc}")]
    if not extra:
        return [ActionResult("", str(action.get("label") or "custom"), False, "Empty adb args")]

    results: list[ActionResult] = []
    for device in _resolve_targets(device_ids, android_only=True):
        cmd = ["adb", "-s", device.id, *extra]
        code, out = _run(cmd, timeout=60)
        ok = code == 0 and "error:" not in (out or "").lower()
        results.append(
            ActionResult(
                device.id,
                device.name,
                ok,
                out or str(action.get("label") or "ok"),
            )
        )
    return results


async def custom_adb_async(action_id: str, device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_custom_adb, action_id, device_ids)
