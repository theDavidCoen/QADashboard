"""Foreground app / PWA label for Android (and iOS app probes)."""

from __future__ import annotations

import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import load_config

_AAPT_CANDIDATES = [
    Path.home() / "Android/Sdk/build-tools/36.1.0/aapt",
    Path.home() / "Android/Sdk/build-tools/37.0.0/aapt",
]

BROWSER_PACKAGES = {
    "com.android.chrome",
    "com.chrome.beta",
    "com.chrome.dev",
    "com.chrome.canary",
    "com.brave.browser",
    "org.mozilla.firefox",
    "com.microsoft.emmx",
}

# Cache expensive foreground probes across /api/devices polls
_app_cache: dict[str, tuple[float, "AppDisplay"]] = {}
_APP_TTL = 1.25
_version_cache: dict[tuple[str, str], tuple[float, str | None, str | None]] = {}
_VERSION_TTL = 60.0
_ios_listing_cache: dict[str, tuple[float, str]] = {}
_IOS_LISTING_TTL = 30.0


@dataclass(slots=True)
class AppDisplay:
    name: str | None = None
    version: str | None = None
    build: str | None = None
    url: str | None = None
    kind: str | None = None  # "native" | "pwa" | "browser"
    package: str | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "build": self.build,
            "url": self.url,
            "kind": self.kind,
            "package": self.package,
        }

    @property
    def label(self) -> str | None:
        if self.kind == "pwa" and self.name and self.url:
            return f"{self.name} · {self.url}"
        if self.name and self.version and self.build:
            return f"{self.name} {self.version}, build {self.build}"
        if self.name and self.build:
            return f"{self.name}, build {self.build}"
        if self.name and self.version:
            return f"{self.name} {self.version}"
        if self.name:
            return self.name
        return None


def _split_version_build(
    version_name: str | None, version_code: str | None
) -> tuple[str | None, str | None]:
    """Prefer versionName as marketing version and versionCode as build id."""
    version = version_name.strip() if version_name and version_name.strip() else None
    build = None
    if version_code and version_code.strip():
        code = version_code.strip()
        # Edge-style builds are long numeric codes; keep shorter codes too if no versionName.
        if len(code) >= 6 or not version:
            build = code
    if not build and version and version.isdigit() and len(version) >= 6:
        # legacy: only versionCode was available and stored as versionName-less build
        build = version
        version = None
    return version, build


def _staging_display_name(name: str, package: str) -> str:
    if "staging" not in package.lower():
        return name
    if re.search(r",\s*[Ss]taging\b", name):
        return name
    if re.search(r"\b[Ss]taging\b", name):
        return re.sub(r"\s+[Ss]taging\b", ", Staging", name, count=1)
    return f"{name}, Staging"


def _run(cmd: list[str], timeout: float = 3.0) -> str:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return result.stdout + (result.stderr if result.returncode != 0 else "")
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def _find_aapt() -> str | None:
    for path in _AAPT_CANDIDATES:
        if path.is_file():
            return str(path)
    which = _run(["which", "aapt"], timeout=1.0).strip().splitlines()
    return which[0] if which else None


def _foreground_context(serial: str) -> tuple[str | None, str | None, str | None]:
    """Return (package, activity, webapk_package) for the resumed activity."""
    # Grep on-device to avoid shipping multi-MB dumpsys over USB
    out = _run(
        [
            "adb",
            "-s",
            serial,
            "shell",
            "dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity|webapp://webapk|taskDescription' -m 40",
        ],
        timeout=2.0,
    )
    if not out.strip():
        out = _run(
            ["adb", "-s", serial, "shell", "dumpsys", "activity", "activities"],
            timeout=3.0,
        )

    match = re.search(
        r"topResumedActivity=ActivityRecord\{[^\}]*\s+u\d+\s+([^\s/]+)/([^\s\}]+)",
        out,
    )
    if not match:
        match = re.search(
            r"mResumedActivity: ActivityRecord\{[^\}]*\s+u\d+\s+([^\s/]+)/([^\s\}]+)",
            out,
        )
    if not match:
        return None, None, None

    package, activity = match.group(1), match.group(2)
    webapk = None

    webapk_match = re.search(r"webapp://webapk-(org\.chromium\.webapk\.[^\s\)]+)", out)
    if webapk_match:
        webapk = webapk_match.group(1)
    elif "WebApk" in activity or "webapps" in activity:
        task_match = re.search(
            r"Task\{[^\}]*A=\d+:(org\.chromium\.webapk\.[^\s\}]+)",
            out,
        )
        if task_match:
            webapk = task_match.group(1)

    return package, activity, webapk


def _package_versions(serial: str, package: str) -> tuple[str | None, str | None]:
    key = (serial, package)
    now = time.monotonic()
    cached = _version_cache.get(key)
    if cached and now - cached[0] < _VERSION_TTL:
        return cached[1], cached[2]

    out = _run(
        [
            "adb",
            "-s",
            serial,
            "shell",
            f"dumpsys package {package} | grep -E '^(    )?(versionName|versionCode)=' -m 4",
        ],
        timeout=2.0,
    )
    if "Unable to find package" in out or not out.strip():
        _version_cache[key] = (now, None, None)
        return None, None

    version_name = None
    version_code = None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("versionName=") and version_name is None:
            version_name = line.split("=", 1)[1].strip()
        elif line.startswith("versionCode=") and version_code is None:
            match = re.search(r"versionCode=(\d+)", line)
            if match:
                version_code = match.group(1)
    _version_cache[key] = (now, version_name, version_code)
    return version_name, version_code


def _webapk_host(serial: str, package: str) -> str | None:
    out = _run(
        [
            "adb",
            "-s",
            serial,
            "shell",
            f"dumpsys package {package} | grep -m 1 'Authority:'",
        ],
        timeout=2.0,
    )
    match = re.search(r'Authority:\s*"([^"]+)"', out)
    return match.group(1) if match else None


@lru_cache(maxsize=64)
def _cached_apk_label(serial: str, package: str, version_code: str) -> str | None:
    aapt = _find_aapt()
    if not aapt:
        return None
    path_out = _run(["adb", "-s", serial, "shell", "pm", "path", package], timeout=2.0)
    apk_remote = None
    for line in path_out.splitlines():
        if line.startswith("package:"):
            apk_remote = line.split(":", 1)[1].strip()
            break
    if not apk_remote:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="qa-apk-") as tmp:
            local = Path(tmp) / "app.apk"
            _run(["adb", "-s", serial, "pull", apk_remote, str(local)], timeout=20)
            if not local.is_file():
                return None
            badging = _run([aapt, "dump", "badging", str(local)], timeout=10)
            match = re.search(r"application-label:'([^']+)'", badging)
            return match.group(1) if match else None
    except OSError:
        return None


def _config_app_name(package: str) -> str | None:
    cfg = load_config().get("apps", {})
    for group in cfg.values():
        android = group.get("android", [])
        if package in android:
            return group.get("label") or group.get("name")
    return None


def _config_pwa_for_host(host: str) -> dict | None:
    for entry in load_config().get("pwas", []) or []:
        hosts = entry.get("hosts") or entry.get("match_hosts") or []
        if host in hosts or any(host.endswith(h) for h in hosts):
            return entry
    return None


def _known_package_name(package: str) -> str | None:
    known = {
        "co.edgesecure.app": "Edge",
        "co.edgesecure.app.staging": "Edge, Staging",
        "app.edge.develop": "Edge Develop",
        "com.android.chrome": "Chrome",
    }
    return known.get(package) or _config_app_name(package)


def _package_installed_fast(serial: str, package: str) -> bool:
    out = _run(["adb", "-s", serial, "shell", "pm", "path", package], timeout=1.5)
    return "package:" in out


def android_foreground_app(serial: str) -> AppDisplay:
    now = time.monotonic()
    cached = _app_cache.get(serial)
    if cached and now - cached[0] < _APP_TTL:
        return cached[1]

    display = _android_foreground_app_uncached(serial)
    _app_cache[serial] = (now, display)
    return display


def _android_foreground_app_uncached(serial: str) -> AppDisplay:
    package, activity, webapk = _foreground_context(serial)
    effective = webapk or package
    if not effective:
        return _android_configured_fallback(serial)

    if effective.startswith("org.chromium.webapk."):
        host = _webapk_host(serial, effective) or ""
        pwa = _config_pwa_for_host(host) if host else None
        version_name, version_code = _package_versions(serial, effective)
        label = (pwa.get("name") or pwa.get("label")) if pwa else None
        if not label:
            label = host.split(".")[0].title() if host else None
        if not label:
            label = _cached_apk_label(serial, effective, version_code or version_name or "0")
        if pwa and pwa.get("name"):
            label = str(pwa["name"])
        url = str(pwa["url"]) if pwa and pwa.get("url") else (f"https://{host}" if host else None)
        return AppDisplay(
            name=label or host or "PWA",
            url=url,
            kind="pwa",
            package=effective,
        )

    if effective in BROWSER_PACKAGES:
        dump = _run(
            [
                "adb",
                "-s",
                serial,
                "shell",
                "dumpsys activity activities | grep -oE 'https?://[^ ]+' -m 20",
            ],
            timeout=2.0,
        )
        url = None
        for candidate in dump.splitlines():
            candidate = candidate.strip().rstrip(".,);]")
            host = re.sub(r"^https?://", "", candidate).split("/")[0]
            if host and "google." not in host and "chrome" not in host and "mozilla." not in host:
                pwa = _config_pwa_for_host(host)
                if pwa:
                    return AppDisplay(
                        name=pwa.get("name") or pwa.get("label") or host,
                        url=pwa.get("url") or f"https://{host}",
                        kind="pwa",
                        package=effective,
                    )
                url = candidate
                break
        return AppDisplay(
            name=_known_package_name(effective) or "Browser",
            url=url,
            kind="browser" if url else "native",
            package=effective,
        )

    version_name, version_code = _package_versions(serial, effective)
    name = _known_package_name(effective)
    if not name:
        name = effective.split(".")[-1]
    name = _staging_display_name(name or effective.split(".")[-1], effective)
    version, build = _split_version_build(version_name, version_code)
    _ = activity
    return AppDisplay(
        name=name,
        version=version,
        build=build,
        kind="native",
        package=effective,
    )


def _android_configured_fallback(serial: str) -> AppDisplay:
    cfg = load_config().get("apps", {})
    for group_name, group in cfg.items():
        for package in group.get("android", []):
            if not _package_installed_fast(serial, package):
                continue
            version_name, version_code = _package_versions(serial, package)
            name = group.get("label") or group.get("name") or group_name.title()
            name = _staging_display_name(str(name), package)
            version, build = _split_version_build(version_name, version_code)
            return AppDisplay(
                name=name,
                version=version,
                build=build,
                kind="native",
                package=package,
            )
    return AppDisplay()


def ios_configured_app(udid: str) -> AppDisplay:
    cfg = load_config().get("apps", {})
    packages: list[str] = []
    labels: dict[str, str] = {}
    for group_name, group in cfg.items():
        for package in group.get("ios", []):
            packages.append(package)
            labels[package] = group.get("label") or group.get("name") or group_name.title()

    now = time.monotonic()
    cached = _ios_listing_cache.get(udid)
    if cached and now - cached[0] < _IOS_LISTING_TTL:
        listing = cached[1]
    else:
        listing = _run(["ideviceinstaller", "-u", udid, "-l"], timeout=2.5)
        _ios_listing_cache[udid] = (now, listing)

    if not listing:
        return AppDisplay()

    for package in packages:
        for line in listing.splitlines():
            if package not in line:
                continue
            parts = [p.strip().strip('"') for p in line.split(",")]
            version = parts[2] if len(parts) >= 3 else None
            name = labels.get(package, "App")
            name = _staging_display_name(str(name), package)
            return AppDisplay(
                name=name,
                version=version,
                build=None,
                kind="native",
                package=package,
            )
    return AppDisplay()
