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


def get_wifi(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    _, setting = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "global", "wifi_on"],
        timeout=8,
    )
    value = setting.strip()
    if value in {"1", "0"}:
        return ActionResult(device.id, device.name, True, "on" if value == "1" else "off")
    code, out = _run(
        ["adb", "-s", device.id, "shell", "dumpsys", "wifi"],
        timeout=10,
    )
    lower = out.lower()
    if "wi-fi is enabled" in lower or "wifi is enabled" in lower:
        return ActionResult(device.id, device.name, True, "on")
    if "wi-fi is disabled" in lower or "wifi is disabled" in lower:
        return ActionResult(device.id, device.name, True, "off")
    return ActionResult(device.id, device.name, False, out or setting or "Wi‑Fi status failed")


def set_wifi(device: DeviceInfo, enabled: bool) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    mode = "enable" if enabled else "disable"
    code, out = _run(
        ["adb", "-s", device.id, "shell", "svc", "wifi", mode],
        timeout=10,
    )
    flag = "enabled" if enabled else "disabled"
    code2, out2 = _run(
        ["adb", "-s", device.id, "shell", "cmd", "wifi", "set-wifi-enabled", flag],
        timeout=10,
    )
    status = get_wifi(device)
    if status.ok and ((enabled and status.detail == "on") or ((not enabled) and status.detail == "off")):
        return ActionResult(device.id, device.name, True, status.detail)
    if code == 0 or code2 == 0:
        return ActionResult(device.id, device.name, True, "on" if enabled else "off")
    return ActionResult(device.id, device.name, False, out2 or out or f"Wi‑Fi {mode} failed")


def get_battery_saver(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    # MIUI / HyperOS expose POWER_SAVE_MODE_OPEN; AOSP uses global low_power.
    _, miui = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "system", "POWER_SAVE_MODE_OPEN"],
        timeout=8,
    )
    miui_val = miui.strip()
    if miui_val in {"1", "0"}:
        return ActionResult(device.id, device.name, True, "on" if miui_val == "1" else "off")
    _, setting = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "global", "low_power"],
        timeout=8,
    )
    value = setting.strip()
    if value in {"1", "0"}:
        return ActionResult(device.id, device.name, True, "on" if value == "1" else "off")
    _, out = _run(
        ["adb", "-s", device.id, "shell", "dumpsys", "power"],
        timeout=10,
    )
    if re.search(r"mIsPowerSaveMode(?:Enabled)?\s*[:=]\s*true", out, re.I):
        return ActionResult(device.id, device.name, True, "on")
    if re.search(r"mIsPowerSaveMode(?:Enabled)?\s*[:=]\s*false", out, re.I):
        return ActionResult(device.id, device.name, True, "off")
    return ActionResult(device.id, device.name, False, out or setting or "Battery saver status failed")


def set_battery_saver(device: DeviceInfo, enabled: bool) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    flag = "1" if enabled else "0"
    ps_state = "true" if enabled else "false"
    # MIUI / HyperOS: system setting + broadcast (cmd power set-mode alone often no-ops).
    _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "settings",
            "put",
            "system",
            "POWER_SAVE_MODE_OPEN",
            flag,
        ],
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
            "miui.intent.action.POWER_SAVE_MODE_CHANGED",
            "--ez",
            "ps_state",
            ps_state,
        ],
        timeout=10,
    )
    # AOSP / Pixel-style fallbacks.
    _run(
        ["adb", "-s", device.id, "shell", "settings", "put", "global", "low_power", flag],
        timeout=8,
    )
    _run(
        ["adb", "-s", device.id, "shell", "settings", "put", "global", "low_power_sticky", flag],
        timeout=8,
    )
    code, out = _run(
        ["adb", "-s", device.id, "shell", "cmd", "power", "set-mode", flag],
        timeout=10,
    )
    time.sleep(0.4)
    status = get_battery_saver(device)
    if status.ok and ((enabled and status.detail == "on") or ((not enabled) and status.detail == "off")):
        return ActionResult(device.id, device.name, True, status.detail)
    if code == 0:
        return ActionResult(device.id, device.name, True, "on" if enabled else "off")
    return ActionResult(device.id, device.name, False, out or f"Battery saver {'on' if enabled else 'off'} failed")


# Serials whose panel we turned off via scrcpy SET_DISPLAY_POWER (dumpsys stays "on").
_forced_display_off: set[str] = set()


def get_display_power(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    # Scrcpy SurfaceControl off does not flip dumpsys; track dashboard-forced offs.
    if device.id in _forced_display_off:
        return ActionResult(device.id, device.name, True, "off")
    _, out = _run(["adb", "-s", device.id, "shell", "dumpsys", "display"], timeout=12)
    # Android 15+ `cmd display power-off` leaves mScreenState=ON but sets mBrightnessState=-1.
    if re.search(r"mBrightnessState\s*=\s*-1(?:\.0+)?\b", out):
        return ActionResult(device.id, device.name, True, "off")
    # Prefer explicit panel state when present.
    states = re.findall(r"mScreenState=([A-Z_]+)", out)
    if states:
        state = states[-1].upper()
        if state in {"OFF", "OFF_SUSPEND"}:
            return ActionResult(device.id, device.name, True, "off")
        if state in {"ON", "ON_SUSPEND", "DOZE", "DOZE_SUSPEND"}:
            return ActionResult(device.id, device.name, True, "on")
    if re.search(r"mScreenOn\s*=\s*false", out, re.I) or re.search(r"screen.?on\s*[:=]\s*false", out, re.I):
        return ActionResult(device.id, device.name, True, "off")
    if re.search(r"mScreenOn\s*=\s*true", out, re.I):
        return ActionResult(device.id, device.name, True, "on")
    return ActionResult(device.id, device.name, True, "unknown")


def _cmd_display_power_off(serial: str) -> bool:
    code, _ = _run(["adb", "-s", serial, "shell", "cmd", "display", "power-off", "0"], timeout=8)
    return code == 0


def _cmd_display_power_on(serial: str) -> bool:
    # Android 15+: restore panel without POWER key (avoids lock screen / fingerprint).
    code, _ = _run(["adb", "-s", serial, "shell", "cmd", "display", "power-reset", "0"], timeout=8)
    return code == 0


def set_display_power(device: DeviceInfo, on: bool) -> ActionResult:
    """Turn the physical display panel on/off; scrcpy stream should keep running when off."""
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    from .scrcpy_control import set_display_power as encode_display_power
    from .scrcpy_stream import get_active_stream

    stream = get_active_stream(device.id)
    serial = device.id

    if on:
        # Never inject KEYCODE_POWER — on Xiaomi/HyperOS it locks and demands fingerprint/PIN.
        restored = _cmd_display_power_on(serial)
        if stream is not None:
            # Clears keepDisplayPowerOff + SurfaceControl POWER_MODE_NORMAL.
            for _ in range(8):
                stream.send_control(encode_display_power(True))
                time.sleep(0.03)
        _forced_display_off.discard(serial)
        time.sleep(0.1)
        status = get_display_power(device)
        if status.ok and status.detail == "on":
            return ActionResult(device.id, device.name, True, "on")
        if restored or stream is not None:
            return ActionResult(device.id, device.name, True, "on")
        _run(["adb", "-s", serial, "shell", "cmd", "power", "wakeup"], timeout=8)
        _run(["adb", "-s", serial, "shell", "input", "keyevent", "224"], timeout=8)
        return ActionResult(device.id, device.name, True, "on (wake sent)")

    # Screen OFF with an active stream: use scrcpy SET_DISPLAY_POWER only.
    # `cmd display power-off` blanks the panel but blocks injected mouse/keyboard input.
    if stream is not None:
        if stream.send_control(encode_display_power(False)):
            _forced_display_off.add(serial)
            return ActionResult(device.id, device.name, True, "off (stream stays on)")
        return ActionResult(device.id, device.name, False, "Failed to send display power over scrcpy")

    # No stream: Android 15+ DisplayManager power-off (no mirror to control anyway).
    if _cmd_display_power_off(serial):
        _forced_display_off.add(serial)
        return ActionResult(device.id, device.name, True, "off")

    code, out = _run(
        ["adb", "-s", serial, "shell", "input", "keyevent", "223"],
        timeout=8,
    )
    if code == 0:
        _forced_display_off.add(serial)
        return ActionResult(device.id, device.name, True, "off (no active stream; used keyevent)")
    return ActionResult(
        device.id,
        device.name,
        False,
        out or "Display power failed — open the device stream first",
    )


def _vpn_iface_up(device_id: str) -> bool:
    _, out = _run(["adb", "-s", device_id, "shell", "ip", "-o", "link", "show", "up"], timeout=8)
    for line in out.splitlines():
        parts = line.split(":")
        if len(parts) < 2:
            continue
        name = parts[1].strip().split("@")[0].strip().lower()
        if name.startswith(("tun", "ppp", "wg", "vpn")):
            return True
    return False


def get_vpn(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    if _vpn_iface_up(device.id):
        return ActionResult(device.id, device.name, True, "on")
    _, dump = _run(
        ["adb", "-s", device.id, "shell", "dumpsys", "connectivity"],
        timeout=12,
    )
    if re.search(r"VPN.*(CONNECTED|CONNECTED_TO_LEGACY|NetworkAgentInfo)", dump, re.I | re.S):
        if re.search(r"type:\s*VPN[^\n]*(CONNECTED|CONNECTED_TO)", dump, re.I):
            return ActionResult(device.id, device.name, True, "on")
    if re.search(r"\bVPN\b", dump) and re.search(r"CONNECTED", dump, re.I):
        # Heuristic: VPN mentioned with CONNECTED somewhere nearby is noisy; prefer iface.
        pass
    _, lockdown = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "secure", "always_on_vpn_lockdown"],
        timeout=6,
    )
    _, app = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "secure", "always_on_vpn_app"],
        timeout=6,
    )
    app_set = app.strip() not in {"", "null", "none"}
    if lockdown.strip() == "1" and app_set:
        return ActionResult(device.id, device.name, True, "on")
    return ActionResult(device.id, device.name, True, "off")


def set_vpn(device: DeviceInfo, enabled: bool) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    _, app = _run(
        ["adb", "-s", device.id, "shell", "settings", "get", "secure", "always_on_vpn_app"],
        timeout=6,
    )
    app_pkg = app.strip()
    app_set = app_pkg not in {"", "null", "none"}

    if enabled:
        if app_set:
            _run(
                [
                    "adb",
                    "-s",
                    device.id,
                    "shell",
                    "settings",
                    "put",
                    "secure",
                    "always_on_vpn_lockdown",
                    "1",
                ],
                timeout=8,
            )
            status = get_vpn(device)
            if status.ok and status.detail == "on":
                return ActionResult(device.id, device.name, True, "on")
            return ActionResult(device.id, device.name, True, "always-on VPN enabled")
        code, out = _run(
            [
                "adb",
                "-s",
                device.id,
                "shell",
                "am",
                "start",
                "-a",
                "android.net.vpn.SETTINGS",
            ],
            timeout=10,
        )
        if code == 0:
            return ActionResult(
                device.id,
                device.name,
                True,
                "opened VPN settings — complete on device",
            )
        return ActionResult(device.id, device.name, False, out or "Open VPN settings failed")

    # Disable: clear always-on lockdown; best-effort bring down VPN ifaces.
    _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "settings",
            "put",
            "secure",
            "always_on_vpn_lockdown",
            "0",
        ],
        timeout=8,
    )
    _, links = _run(
        ["adb", "-s", device.id, "shell", "ip", "-o", "link", "show", "up"],
        timeout=8,
    )
    for line in links.splitlines():
        parts = line.split(":")
        if len(parts) < 2:
            continue
        name = parts[1].strip().split("@")[0].strip()
        if name.lower().startswith(("tun", "ppp", "wg", "vpn")):
            _run(
                ["adb", "-s", device.id, "shell", "ip", "link", "set", name, "down"],
                timeout=6,
            )
    status = get_vpn(device)
    if status.ok and status.detail == "off":
        return ActionResult(device.id, device.name, True, "off")
    return ActionResult(
        device.id,
        device.name,
        True,
        "always-on lockdown off — disconnect VPN on device if still active",
    )


WIREGUARD_PKG = "com.wireguard.android"
_WIREGUARD_UI_XML = "/sdcard/qa-dashboard-wg-ui.xml"


def _wireguard_installed(device_id: str) -> bool:
    _, out = _run(
        ["adb", "-s", device_id, "shell", "pm", "path", WIREGUARD_PKG],
        timeout=8,
    )
    return "package:" in out


def _wireguard_vpn_active(device_id: str) -> bool:
    _, dump = _run(
        ["adb", "-s", device_id, "shell", "dumpsys", "connectivity"],
        timeout=12,
    )
    return bool(re.search(r"VPN:\s*com\.wireguard\.android", dump))


def _parse_bounds(raw: str) -> tuple[int, int, int, int] | None:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", raw.strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))


def _uiautomator_xml(device_id: str) -> str:
    _run(
        ["adb", "-s", device_id, "shell", "uiautomator", "dump", _WIREGUARD_UI_XML],
        timeout=20,
    )
    _, out = _run(
        ["adb", "-s", device_id, "shell", "cat", _WIREGUARD_UI_XML],
        timeout=10,
    )
    return out


def _wireguard_find_switch(xml: str, tunnel: str | None = None) -> tuple[bool, int, int, str | None] | None:
    """Return (checked, tap_x, tap_y, tunnel_name) for the WireGuard tunnel switch."""
    nodes = re.findall(r"<node\b[^>]*/?>", xml)
    texts: list[tuple[str, tuple[int, int, int, int]]] = []
    switches: list[tuple[bool, tuple[int, int, int, int]]] = []
    for node in nodes:
        bounds_m = re.search(r'\bbounds="([^"]+)"', node)
        if not bounds_m:
            continue
        bounds = _parse_bounds(bounds_m.group(1))
        if not bounds:
            continue
        text_m = re.search(r'\btext="([^"]*)"', node)
        text = text_m.group(1) if text_m else ""
        cls_m = re.search(r'\bclass="([^"]*)"', node)
        cls = cls_m.group(1) if cls_m else ""
        if text and "Switch" not in cls and text not in {"WireGuard"}:
            texts.append((text, bounds))
        if "Switch" in cls:
            checked = 'checked="true"' in node
            switches.append((checked, bounds))
    if not switches:
        return None

    def center(b: tuple[int, int, int, int]) -> tuple[int, int]:
        return (b[0] + b[2]) // 2, (b[1] + b[3]) // 2

    chosen_sw = switches[0]
    chosen_name: str | None = None
    if tunnel:
        tunnel_l = tunnel.casefold()
        for text, tb in texts:
            if text.casefold() != tunnel_l:
                continue
            tcy = (tb[1] + tb[3]) // 2
            best = min(switches, key=lambda s: abs(((s[1][1] + s[1][3]) // 2) - tcy))
            chosen_sw = best
            chosen_name = text
            break
    else:
        # Prefer switch nearest a non-title tunnel label.
        for text, tb in texts:
            tcy = (tb[1] + tb[3]) // 2
            best = min(switches, key=lambda s: abs(((s[1][1] + s[1][3]) // 2) - tcy))
            chosen_sw = best
            chosen_name = text
            break

    cx, cy = center(chosen_sw[1])
    return chosen_sw[0], cx, cy, chosen_name


def _wireguard_broadcast(device_id: str, enabled: bool, tunnel: str) -> None:
    action = (
        "com.wireguard.android.action.SET_TUNNEL_UP"
        if enabled
        else "com.wireguard.android.action.SET_TUNNEL_DOWN"
    )
    # Component + tunnel extra — works when WireGuard "Allow remote control apps" is on
    # and the sender holds CONTROL_TUNNELS (often not true for adb shell).
    _run(
        [
            "adb",
            "-s",
            device_id,
            "shell",
            "am",
            "broadcast",
            "-a",
            action,
            "-n",
            "com.wireguard.android/.model.TunnelManager$IntentReceiver",
            "--es",
            "tunnel",
            tunnel,
        ],
        timeout=12,
    )


def _resume_android_app(device_id: str, package: str | None, activity: str | None) -> None:
    """Bring the previous foreground app back after a brief WireGuard UI visit."""
    if package and package != WIREGUARD_PKG:
        if activity:
            component = f"{package}/{activity}"
            code, _ = _run(
                [
                    "adb",
                    "-s",
                    device_id,
                    "shell",
                    "am",
                    "start",
                    "--activity-single-top",
                    "-n",
                    component,
                ],
                timeout=12,
            )
            if code == 0:
                return
        code, _ = _run(
            [
                "adb",
                "-s",
                device_id,
                "shell",
                "monkey",
                "-p",
                package,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            ],
            timeout=12,
        )
        if code == 0:
            return
    # Fallback: pop WireGuard from the activity stack.
    _run(["adb", "-s", device_id, "shell", "input", "keyevent", "KEYCODE_BACK"], timeout=6)


def get_wireguard(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    if not _wireguard_installed(device.id):
        return ActionResult(device.id, device.name, False, "WireGuard app not installed")
    on = _wireguard_vpn_active(device.id)
    return ActionResult(device.id, device.name, True, "on" if on else "off")


def set_wireguard(device: DeviceInfo, enabled: bool, tunnel: str | None = None) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    if not _wireguard_installed(device.id):
        return ActionResult(device.id, device.name, False, "WireGuard app not installed")

    current = get_wireguard(device)
    if current.ok and ((enabled and current.detail == "on") or ((not enabled) and current.detail == "off")):
        return ActionResult(device.id, device.name, True, current.detail)

    tunnel_candidates: list[str] = []
    if tunnel and tunnel.strip():
        tunnel_candidates.append(tunnel.strip())
    for name in ("VPN-Edge", "vpn-edge", "wg0"):
        if name not in tunnel_candidates:
            tunnel_candidates.append(name)

    for name in tunnel_candidates:
        _wireguard_broadcast(device.id, enabled, name)
        time.sleep(1.0)
        status = get_wireguard(device)
        if status.ok and ((enabled and status.detail == "on") or ((not enabled) and status.detail == "off")):
            return ActionResult(device.id, device.name, True, status.detail)

    # Reliable path: toggle the in-app switch (no CONTROL_TUNNELS permission required).
    from .app_info import android_resumed_component

    prev_pkg, prev_act = android_resumed_component(device.id)
    if prev_pkg == WIREGUARD_PKG:
        prev_pkg, prev_act = None, None

    result: ActionResult | None = None
    try:
        _run(["adb", "-s", device.id, "shell", "cmd", "statusbar", "collapse"], timeout=6)
        _run(
            [
                "adb",
                "-s",
                device.id,
                "shell",
                "am",
                "start",
                "-W",
                "-n",
                "com.wireguard.android/.activity.MainActivity",
            ],
            timeout=15,
        )
        time.sleep(0.8)
        xml = _uiautomator_xml(device.id)
        prefer = tunnel_candidates[0] if tunnel_candidates else None
        found = _wireguard_find_switch(xml, prefer)
        if not found:
            time.sleep(0.6)
            xml = _uiautomator_xml(device.id)
            found = _wireguard_find_switch(xml, prefer)
        if not found:
            result = ActionResult(
                device.id,
                device.name,
                False,
                "WireGuard UI switch not found — open WireGuard once and import a tunnel",
            )
        else:
            checked, cx, cy, found_name = found
            if checked != enabled:
                _run(
                    ["adb", "-s", device.id, "shell", "input", "tap", str(cx), str(cy)],
                    timeout=8,
                )
                for _ in range(10):
                    time.sleep(0.5)
                    status = get_wireguard(device)
                    if status.ok and (
                        (enabled and status.detail == "on")
                        or ((not enabled) and status.detail == "off")
                    ):
                        label = found_name or prefer or "tunnel"
                        result = ActionResult(
                            device.id, device.name, True, f"{status.detail} ({label})"
                        )
                        break
                if result is None:
                    result = ActionResult(
                        device.id,
                        device.name,
                        False,
                        f"WireGuard toggle tapped but still {'off' if enabled else 'on'}",
                    )
            else:
                status = get_wireguard(device)
                if status.ok:
                    result = ActionResult(device.id, device.name, True, status.detail)
                else:
                    result = ActionResult(
                        device.id, device.name, True, "on" if enabled else "off"
                    )
    finally:
        _resume_android_app(device.id, prev_pkg, prev_act)

    return result or ActionResult(device.id, device.name, False, "WireGuard toggle failed")


def _wm_user_rotation(device_id: str) -> int | None:
    """Parse `wm user-rotation` → current locked/free rotation (0–3), if known."""
    _, out = _run(["adb", "-s", device_id, "shell", "wm", "user-rotation"], timeout=6)
    # Examples: "lock 1" / "free 0"
    m = re.search(r"\b([0-3])\b", (out or "").strip())
    if not m:
        return None
    return int(m.group(1))


def rotate_device_display(device: DeviceInfo) -> ActionResult:
    """Rotate the device display by +90° and lock that orientation.

    On modern Android / MIUI, `settings put system user_rotation` alone often
    does nothing — use `wm user-rotation lock`. Do **not** set
    `ignore-orientation-request`: forcing portrait-locked apps (e.g. Edge) into
    landscape recreates the Activity and can wipe in-memory login state.
    """
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    cur = _wm_user_rotation(device.id)
    if cur is None:
        _, setting = _run(
            ["adb", "-s", device.id, "shell", "settings", "get", "system", "user_rotation"],
            timeout=6,
        )
        try:
            cur = int((setting or "0").strip())
        except ValueError:
            cur = 0
    nxt = (cur + 1) % 4

    _run(
        ["adb", "-s", device.id, "shell", "settings", "put", "system", "accelerometer_rotation", "0"],
        timeout=6,
    )
    # Ensure we are not forcing apps to ignore their orientation lock.
    _run(
        [
            "adb",
            "-s",
            device.id,
            "shell",
            "wm",
            "set-ignore-orientation-request",
            "false",
        ],
        timeout=8,
    )
    code, out = _run(
        ["adb", "-s", device.id, "shell", "wm", "user-rotation", "lock", str(nxt)],
        timeout=8,
    )
    # Keep legacy setting in sync for OEMs that still honor it.
    _run(
        ["adb", "-s", device.id, "shell", "settings", "put", "system", "user_rotation", str(nxt)],
        timeout=6,
    )
    if code != 0:
        return ActionResult(device.id, device.name, False, out or "Rotate failed")

    time.sleep(0.5)
    locked = _wm_user_rotation(device.id)
    if locked is not None and locked != nxt:
        return ActionResult(
            device.id,
            device.name,
            False,
            f"Rotation command sent but wm still reports {locked * 90}°",
        )
    _, dump = _run(
        ["adb", "-s", device.id, "shell", "dumpsys", "window", "displays"],
        timeout=10,
    )
    if nxt and not re.search(rf"mCurrentRotation=ROTATION_{nxt * 90}\b", dump or ""):
        # Portrait-locked foreground apps may keep the display from rotating;
        # wm lock is still set for when the app allows it / after leaving the app.
        pass
    return ActionResult(device.id, device.name, True, f"{nxt * 90}°")


def run_wifi(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [set_wifi(d, enabled) for d in _resolve_targets(device_ids)]


def run_wifi_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [get_wifi(d) for d in _resolve_targets(device_ids)]


def run_battery_saver(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [set_battery_saver(d, enabled) for d in _resolve_targets(device_ids)]


def run_battery_saver_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [get_battery_saver(d) for d in _resolve_targets(device_ids)]


def run_display_power(on: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [set_display_power(d, on) for d in _resolve_targets(device_ids)]


def run_display_power_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [get_display_power(d) for d in _resolve_targets(device_ids)]


def run_vpn(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [set_vpn(d, enabled) for d in _resolve_targets(device_ids)]


def run_vpn_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [get_vpn(d) for d in _resolve_targets(device_ids)]


def run_wireguard(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    return [set_wireguard(d, enabled) for d in _resolve_targets(device_ids)]


def run_wireguard_status(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [get_wireguard(d) for d in _resolve_targets(device_ids)]


def run_rotate(device_ids: list[str] | None = None) -> list[ActionResult]:
    return [rotate_device_display(d) for d in _resolve_targets(device_ids)]


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


def _copy_png_to_clipboard(path: Path) -> bool:
    """Put a PNG on the desktop clipboard (Wayland wl-copy, else X11 xclip)."""
    try:
        data = path.read_bytes()
    except OSError:
        return False
    if not data.startswith(b"\x89PNG") or len(data) < 1000:
        return False

    # wl-copy keeps a background process to own the selection — do not wait for exit.
    for cmd in (
        ["wl-copy", "--type", "image/png"],
        ["wl-copy", "-t", "image/png"],
    ):
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            assert proc.stdin is not None
            proc.stdin.write(data)
            proc.stdin.close()
            time.sleep(0.05)
            if proc.poll() is not None and proc.returncode != 0:
                continue
            return True
        except (FileNotFoundError, OSError):
            continue

    # xclip usually exits after stuffing the clipboard.
    try:
        result = subprocess.run(
            ["xclip", "-selection", "clipboard", "-t", "image/png"],
            input=data,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=8,
            check=False,
        )
        return result.returncode == 0
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return False


def screenshot_device(device: DeviceInfo) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    local = screenshots_dir() / f"QA-{_safe_slug(device.name)}-{stamp}.png"

    def _ok_result() -> ActionResult:
        clip = _copy_png_to_clipboard(local)
        detail = str(local)
        if clip:
            detail = f"{local} · clipboard"
        return ActionResult(device.id, device.name, True, detail)

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
            return _ok_result()
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
    return _ok_result()


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


async def wifi_async(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_wifi, enabled, device_ids)


async def wifi_status_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_wifi_status, device_ids)


async def battery_saver_async(
    enabled: bool,
    device_ids: list[str] | None = None,
) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_battery_saver, enabled, device_ids)


async def battery_saver_status_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_battery_saver_status, device_ids)


async def display_power_async(
    on: bool, device_ids: list[str] | None = None
) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_display_power, on, device_ids)


async def display_power_status_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_display_power_status, device_ids)


async def vpn_async(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_vpn, enabled, device_ids)


async def vpn_status_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_vpn_status, device_ids)


async def wireguard_async(enabled: bool, device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_wireguard, enabled, device_ids)


async def wireguard_status_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_wireguard_status, device_ids)


async def rotate_async(device_ids: list[str] | None = None) -> list[ActionResult]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, run_rotate, device_ids)


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
    "co.edgesecure.app.staging": "Edge, Staging",
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
