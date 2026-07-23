from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config.yaml"


@lru_cache(maxsize=1)
def load_config() -> dict:
    if not DEFAULT_CONFIG.exists():
        return {}
    with DEFAULT_CONFIG.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}
