"""Resolve device mockup profile from model identifiers."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "web" / "public" / "mockups" / "registry.json"
CONFIG_PATH = ROOT / "config" / "mockups.yaml"


@lru_cache(maxsize=1)
def _load_mapping() -> tuple[dict[str, list[str]], dict[str, str]]:
    if not CONFIG_PATH.exists():
        return {}, {"android": "generic-android", "ios": "generic-ios"}
    data = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}
    mockups = {
        key: [str(v).lower() for v in values.get("match", [])]
        for key, values in data.get("mockups", {}).items()
    }
    defaults = data.get("defaults", {})
    return mockups, {
        "android": defaults.get("android", "generic-android"),
        "ios": defaults.get("ios", "generic-ios"),
    }


def resolve_mockup_id(platform: str, name: str, model: str) -> str:
    mockups, defaults = _load_mapping()
    haystack = " ".join([name, model]).lower()
    for mockup_id, needles in mockups.items():
        for needle in needles:
            if needle in haystack:
                return mockup_id
    return defaults.get(platform, "generic-android" if platform == "android" else "generic-ios")
