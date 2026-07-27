"""Persistent QA Dashboard settings (~/.config/qa-dashboard/settings.json)."""

from __future__ import annotations

import json
import os
import uuid
from copy import deepcopy
from pathlib import Path

SETTINGS_DIR = Path.home() / ".config" / "qa-dashboard"
SETTINGS_PATH = SETTINGS_DIR / "settings.json"

DEFAULT_CAPTURE_PATH = str(Path.home() / "Immagini" / "Schermate")
DEFAULT_VAULT_PATH = str(SETTINGS_DIR / "edge-accounts.vault")

SIDEBAR_ACTION_DEFS: list[dict[str, str]] = [
    {"id": "start_edge", "label": "Start Edge", "group": "Launch"},
    {"id": "start_edge_account", "label": "Start Edge account", "group": "Launch"},
    {"id": "start_edge_develop", "label": "Start Edge Develop", "group": "Launch"},
    {"id": "start_arkade", "label": "Start Arkade", "group": "Launch"},
    {"id": "start_other_pwa", "label": "Start other PWA", "group": "Launch"},
    {"id": "start_other_app", "label": "Start other app", "group": "Launch"},
    {"id": "kill_background", "label": "Kill background apps", "group": "Stop"},
    {"id": "kill_app", "label": "Kill app", "group": "Stop"},
    {"id": "screenshot", "label": "Screenshot", "group": "Capture"},
    {"id": "video", "label": "Video recording", "group": "Capture"},
    {"id": "reboot", "label": "Reboot device", "group": "Device"},
    {"id": "airplane", "label": "Airplane Mode", "group": "Device"},
    {"id": "wifi", "label": "Wi‑Fi", "group": "Device"},
    {"id": "vpn", "label": "VPN", "group": "Device"},
    {"id": "vpn_wireguard", "label": "VPN WireGuard", "group": "Device"},
    {"id": "battery_saver", "label": "Battery saver", "group": "Device"},
    {"id": "screen_off", "label": "Screen OFF / ON", "group": "Device"},
    {"id": "rotate", "label": "Rotate device", "group": "Device"},
    {"id": "disconnect_all", "label": "Disconnect all devices", "group": "Device"},
]

CUSTOM_ADB_GROUP = "Custom ADB"

# Android mirror quality presets (scrcpy max_size / max_fps / video_bit_rate).
# max_size 0 = no limit (device native resolution).
STREAM_QUALITY_PRESETS: dict[str, dict[str, int]] = {
    "low": {"max_size": 480, "max_fps": 15, "bit_rate": 2_000_000},
    "medium": {"max_size": 720, "max_fps": 30, "bit_rate": 4_000_000},
    "high": {"max_size": 1080, "max_fps": 60, "bit_rate": 8_000_000},
    "high_30": {"max_size": 1080, "max_fps": 30, "bit_rate": 6_000_000},
    "ultra": {"max_size": 0, "max_fps": 60, "bit_rate": 16_000_000},
}
STREAM_QUALITY_DEFAULT = "high"
STREAM_QUALITY_IDS = frozenset(STREAM_QUALITY_PRESETS)


def normalize_stream_quality(raw: object) -> str:
    if isinstance(raw, str):
        key = raw.strip().lower()
        if key in STREAM_QUALITY_IDS:
            return key
    return STREAM_QUALITY_DEFAULT


def stream_quality_params(quality: object | None = None) -> dict[str, int]:
    key = normalize_stream_quality(quality if quality is not None else load_settings().get("streamQuality"))
    return dict(STREAM_QUALITY_PRESETS[key])


SIDEBAR_GROUP_ORDER_DEFAULT: list[str] = [
    "Launch",
    "Stop",
    "Capture",
    "Device",
    CUSTOM_ADB_GROUP,
]


def _known_sidebar_groups() -> list[str]:
    groups: list[str] = []
    for item in SIDEBAR_ACTION_DEFS:
        name = item["group"]
        if name not in groups:
            groups.append(name)
    if CUSTOM_ADB_GROUP not in groups:
        groups.append(CUSTOM_ADB_GROUP)
    return groups


def _default_sidebar_flags() -> dict[str, bool]:
    return {item["id"]: True for item in SIDEBAR_ACTION_DEFS}


def _normalize_group_order(raw: object) -> list[str]:
    known = _known_sidebar_groups()
    # Prefer default order for known groups, then any extras from defs.
    preferred = [g for g in SIDEBAR_GROUP_ORDER_DEFAULT if g in known]
    for g in known:
        if g not in preferred:
            preferred.append(g)
    ordered: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                name = item.strip()
                if name in preferred and name not in ordered:
                    ordered.append(name)
    for name in preferred:
        if name not in ordered:
            ordered.append(name)
    return ordered


def _ensure_dir() -> None:
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(SETTINGS_DIR, 0o700)
    except OSError:
        pass


def _defaults() -> dict:
    return {
        "capturePath": DEFAULT_CAPTURE_PATH,
        "vaultPath": DEFAULT_VAULT_PATH,
        "edgeFeaturesEnabled": True,
        "arkadeFeaturesEnabled": True,
        "soundEffectsEnabled": True,
        "streamQuality": STREAM_QUALITY_DEFAULT,
        "sidebarActions": _default_sidebar_flags(),
        "sidebarGroupOrder": list(SIDEBAR_GROUP_ORDER_DEFAULT),
        "customAdbActions": [],
    }


def _normalize(data: dict) -> dict:
    base = _defaults()
    capture = data.get("capturePath")
    if isinstance(capture, str) and capture.strip():
        base["capturePath"] = str(Path(capture.strip()).expanduser())
    vault = data.get("vaultPath")
    if isinstance(vault, str) and vault.strip():
        base["vaultPath"] = str(Path(vault.strip()).expanduser())

    if "edgeFeaturesEnabled" in data:
        base["edgeFeaturesEnabled"] = bool(data["edgeFeaturesEnabled"])
    if "arkadeFeaturesEnabled" in data:
        base["arkadeFeaturesEnabled"] = bool(data["arkadeFeaturesEnabled"])
    if "soundEffectsEnabled" in data:
        base["soundEffectsEnabled"] = bool(data["soundEffectsEnabled"])
    base["streamQuality"] = normalize_stream_quality(data.get("streamQuality"))

    flags = _default_sidebar_flags()
    raw_flags = data.get("sidebarActions")
    if isinstance(raw_flags, dict):
        for key, value in raw_flags.items():
            if key in flags and isinstance(value, bool):
                flags[key] = value
    base["sidebarActions"] = flags
    base["sidebarGroupOrder"] = _normalize_group_order(data.get("sidebarGroupOrder"))

    customs: list[dict] = []
    for item in data.get("customAdbActions") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        args = str(item.get("args") or item.get("command") or "").strip()
        if not label or not args:
            continue
        action_id = str(item.get("id") or uuid.uuid4())
        customs.append({"id": action_id, "label": label, "args": args})
    base["customAdbActions"] = customs
    return base


def load_settings() -> dict:
    _ensure_dir()
    if not SETTINGS_PATH.exists():
        return _defaults()
    try:
        raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _defaults()
    if not isinstance(raw, dict):
        return _defaults()
    return _normalize(raw)


def save_settings(patch: dict) -> dict:
    current = load_settings()
    merged = deepcopy(current)
    if "capturePath" in patch and isinstance(patch["capturePath"], str):
        merged["capturePath"] = patch["capturePath"]
    if "vaultPath" in patch and isinstance(patch["vaultPath"], str):
        merged["vaultPath"] = patch["vaultPath"]
    if "edgeFeaturesEnabled" in patch:
        merged["edgeFeaturesEnabled"] = bool(patch["edgeFeaturesEnabled"])
    if "arkadeFeaturesEnabled" in patch:
        merged["arkadeFeaturesEnabled"] = bool(patch["arkadeFeaturesEnabled"])
    if "soundEffectsEnabled" in patch:
        merged["soundEffectsEnabled"] = bool(patch["soundEffectsEnabled"])
    if "streamQuality" in patch:
        merged["streamQuality"] = normalize_stream_quality(patch["streamQuality"])
    if "sidebarActions" in patch and isinstance(patch["sidebarActions"], dict):
        merged["sidebarActions"] = {
            **merged.get("sidebarActions", {}),
            **{k: bool(v) for k, v in patch["sidebarActions"].items()},
        }
    if "sidebarGroupOrder" in patch:
        merged["sidebarGroupOrder"] = _normalize_group_order(patch["sidebarGroupOrder"])
    if "customAdbActions" in patch and isinstance(patch["customAdbActions"], list):
        merged["customAdbActions"] = patch["customAdbActions"]
    normalized = _normalize(merged)
    _ensure_dir()
    tmp = SETTINGS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(normalized, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(SETTINGS_PATH)
    os.chmod(SETTINGS_PATH, 0o600)
    return normalized


EDGE_SIDEBAR_ACTION_IDS = frozenset(
    {"start_edge", "start_edge_account", "start_edge_develop"},
)

ARKADE_SIDEBAR_ACTION_IDS = frozenset({"start_arkade"})


def expand_path(value: str) -> Path:
    return Path(value).expanduser().resolve()
