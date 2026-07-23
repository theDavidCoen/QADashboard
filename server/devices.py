"""Device discovery via adb and libimobiledevice."""

from __future__ import annotations

import asyncio
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Literal

from .app_info import AppDisplay, android_foreground_app, ios_configured_app
from .mockups import resolve_mockup_id


Platform = Literal["android", "ios"]

# Static identity cache: (time, name, model, mockup_id, os_version)
_identity_cache: dict[str, tuple[float, str, str, str, str | None]] = {}
_IDENTITY_TTL = 300.0


@dataclass(slots=True)
class DeviceInfo:
    id: str
    platform: Platform
    name: str
    model: str
    app_label: str | None = None
    mockup_id: str = "generic-android"
    app: AppDisplay = field(default_factory=AppDisplay)
    os_version: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "platform": self.platform,
            "name": self.name,
            "model": self.model,
            "appLabel": self.app.label or self.app_label,
            "mockupId": self.mockup_id,
            "osVersion": self.os_version,
            "app": self.app.to_dict(),
        }


def _run(cmd: list[str], timeout: float = 3.0) -> str:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if result.returncode != 0:
            return result.stdout + result.stderr
        return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def _parse_adb_device_line(line: str) -> tuple[str, str] | None:
    parts = line.split()
    if len(parts) < 2 or parts[1] != "device":
        return None
    serial = parts[0]
    model = "Android"
    product = None
    for token in parts[2:]:
        if token.startswith("model:"):
            model = token.split(":", 1)[1].replace("_", " ")
        elif token.startswith("product:"):
            product = token.split(":", 1)[1].replace("_", " ")
    name = model if model != "Android" else (product or model)
    return serial, name


def _adb_prop(serial: str, key: str, timeout: float = 1.2) -> str:
    return _run(["adb", "-s", serial, "shell", "getprop", key], timeout=timeout).strip()


def _looks_like_model_code(value: str) -> bool:
    """True for OEM codes like 23078PND5G rather than marketing names."""
    text = value.strip()
    if len(text) < 4:
        return True
    if " " in text:
        return False
    letters = sum(ch.isalpha() for ch in text)
    digits = sum(ch.isdigit() for ch in text)
    return digits >= 3 and letters >= 2 and text.upper() == text.replace("_", "").replace("-", "")


def _android_identity(serial: str, name_hint: str) -> tuple[str, str, str, str | None]:
    now = time.monotonic()
    cached = _identity_cache.get(serial)
    if cached and now - cached[0] < _IDENTITY_TTL:
        return cached[1], cached[2], cached[3], cached[4]

    model = _adb_prop(serial, "ro.product.model") or name_hint or "Android"
    brand = _adb_prop(serial, "ro.product.brand")
    market = (
        _adb_prop(serial, "ro.product.marketname")
        or _adb_prop(serial, "ro.product.odm.marketname")
        or _adb_prop(serial, "ro.product.vendor.marketname")
        or _adb_prop(serial, "ro.vendor.product.marketname")
    )
    release = _adb_prop(serial, "ro.build.version.release")
    os_version = f"Android {release}" if release else None

    if market:
        name = market
    elif brand and model and _looks_like_model_code(model):
        name = f"{brand} {model}"
    elif not _looks_like_model_code(model):
        name = model
    elif name_hint and not _looks_like_model_code(name_hint):
        name = name_hint
    else:
        name = model

    # Title-case brand+code if still ugly; keep market names as-is
    if brand and name.lower().startswith(brand.lower() + " ") and _looks_like_model_code(name.split(" ", 1)[-1]):
        # Prefer mockup mapping friendly label when available
        pass

    mockup_id = resolve_mockup_id("android", name, model)
    # If mockup maps to xiaomi-13t-pro, use a friendly display name
    if mockup_id == "xiaomi-13t-pro" and _looks_like_model_code(name):
        name = "Xiaomi 13T Pro"
    elif mockup_id == "redmi-note-9-pro" and _looks_like_model_code(name):
        name = "Redmi Note 9 Pro"

    _identity_cache[serial] = (now, name, model, mockup_id, os_version)
    return name, model, mockup_id, os_version


def _build_android_device(serial: str, name_hint: str) -> DeviceInfo:
    name, model, mockup_id, os_version = _android_identity(serial, name_hint)
    app = android_foreground_app(serial)
    return DeviceInfo(
        id=serial,
        platform="android",
        name=name,
        model=model,
        app_label=app.label,
        app=app,
        mockup_id=mockup_id,
        os_version=os_version,
    )


def _list_android() -> list[DeviceInfo]:
    out = _run(["adb", "devices", "-l"], timeout=2.5)
    jobs: list[tuple[str, str]] = []
    for line in out.splitlines()[1:]:
        line = line.strip()
        if not line or line.startswith("*") or "offline" in line:
            continue
        parsed = _parse_adb_device_line(line)
        if parsed:
            jobs.append(parsed)

    if not jobs:
        return []
    if len(jobs) == 1:
        serial, hint = jobs[0]
        return [_build_android_device(serial, hint)]

    with ThreadPoolExecutor(max_workers=min(4, len(jobs)), thread_name_prefix="qa-adb") as pool:
        return list(pool.map(lambda item: _build_android_device(item[0], item[1]), jobs))


def _build_ios_device(udid: str) -> DeviceInfo:
    cached = _identity_cache.get(udid)
    now = time.monotonic()
    if cached and now - cached[0] < _IDENTITY_TTL:
        name, model, mockup_id, os_version = cached[1], cached[2], cached[3], cached[4]
    else:
        with ThreadPoolExecutor(max_workers=3, thread_name_prefix="qa-ios-info") as pool:
            name_fut = pool.submit(
                _run, ["ideviceinfo", "-u", udid, "-k", "DeviceName"], 2.0
            )
            model_fut = pool.submit(
                _run, ["ideviceinfo", "-u", udid, "-k", "ProductType"], 2.0
            )
            ver_fut = pool.submit(
                _run, ["ideviceinfo", "-u", udid, "-k", "ProductVersion"], 2.0
            )
            name = name_fut.result().strip() or "iPhone"
            model = model_fut.result().strip() or "iOS"
            release = ver_fut.result().strip()
            os_version = f"iOS {release}" if release else None
        mockup_id = resolve_mockup_id("ios", name, model)
        _identity_cache[udid] = (now, name, model, mockup_id, os_version)

    app = ios_configured_app(udid)
    return DeviceInfo(
        id=udid,
        platform="ios",
        name=name,
        model=model,
        app_label=app.label,
        app=app,
        mockup_id=mockup_id,
        os_version=os_version,
    )


def _list_ios() -> list[DeviceInfo]:
    out = _run(["idevice_id", "-ln"], timeout=2.5)
    if not out.strip() or out.strip().startswith("ERROR"):
        return []
    udids: list[str] = []
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith("ERROR"):
            continue
        # idevice_id may print "UDID (USB)" / "UDID (Network)"
        udid = line.split()[0].strip()
        if len(udid) >= 8 and "(" not in udid:
            udids.append(udid)
    if not udids:
        return []
    if len(udids) == 1:
        return [_build_ios_device(udids[0])]

    with ThreadPoolExecutor(max_workers=min(4, len(udids)), thread_name_prefix="qa-ios") as pool:
        return list(pool.map(_build_ios_device, udids))


def list_devices_sync() -> list[DeviceInfo]:
    # Parallel Android + iOS discovery (separate pools inside each helper)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="qa-platform") as pool:
        android_fut = pool.submit(_list_android)
        ios_fut = pool.submit(_list_ios)
        devices = android_fut.result() + ios_fut.result()

    seen: set[str] = set()
    merged: list[DeviceInfo] = []
    for device in devices:
        if device.id in seen:
            continue
        seen.add(device.id)
        merged.append(device)
    return merged


async def list_devices() -> list[DeviceInfo]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, list_devices_sync)
