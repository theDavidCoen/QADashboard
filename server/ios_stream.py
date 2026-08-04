"""iOS screen relay via pymobiledevice3 (auto-mount + DVT screenshot)."""

from __future__ import annotations

import asyncio
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from .config import load_config

MSG_CONFIG = 1
MSG_JPEG = 3


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    """Read width/height from JPEG SOF marker without Pillow."""
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            height = struct.unpack(">H", data[i + 5 : i + 7])[0]
            width = struct.unpack(">H", data[i + 7 : i + 9])[0]
            return width, height
        if marker in (0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0x01, 0xD8):
            i += 2
            continue
        seg_len = struct.unpack(">H", data[i + 2 : i + 4])[0]
        i += 2 + seg_len
    return None


class IosStream:
    def __init__(self, udid: str) -> None:
        self.udid = udid
        self._cfg = load_config().get("ios", {})
        self._closed = False
        self._mounted = False
        self._screen_size: tuple[int, int] | None = None
        self._pmd3 = self._resolve_pmd3()

    @property
    def fps(self) -> float:
        return float(self._cfg.get("screenshot_fps", 8))

    @property
    def screen_size(self) -> tuple[int, int] | None:
        return self._screen_size

    @staticmethod
    def _resolve_pmd3() -> str:
        venv_pmd3 = Path(__file__).resolve().parents[1] / ".venv" / "bin" / "pymobiledevice3"
        if venv_pmd3.exists():
            return str(venv_pmd3)
        found = shutil.which("pymobiledevice3")
        if found:
            return found
        return sys.executable

    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._ensure_developer_image)

    def config_message(self) -> bytes | None:
        if not self._screen_size:
            return None
        width, height = self._screen_size
        return bytes([MSG_CONFIG]) + width.to_bytes(4, "big") + height.to_bytes(4, "big")

    def _ensure_developer_image(self) -> None:
        if self._mounted:
            return
        cmd = [self._pmd3, "mounter", "auto-mount", "--udid", self.udid]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if result.returncode != 0 and "already mounted" not in (result.stdout + result.stderr).lower():
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        self._mounted = result.returncode == 0 or "mounted" in (result.stdout + result.stderr).lower()

    async def stream_packets(self):
        interval = 1.0 / max(self.fps, 1.0)
        sent_config = False
        next_at = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="qa-ios-") as tmp:
            shot_path = Path(tmp) / "screen.jpg"
            while not self._closed:
                loop = asyncio.get_running_loop()
                data = await loop.run_in_executor(None, self._capture, shot_path)
                if data:
                    if not sent_config:
                        size = _jpeg_size(data)
                        if size:
                            self._screen_size = size
                            config = self.config_message()
                            if config:
                                yield config
                                sent_config = True
                    yield bytes([MSG_JPEG]) + data
                # Pace from capture start, not capture+sleep — avoids compounding lag
                # when screenshot already took most of the interval.
                next_at += interval
                delay = next_at - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                else:
                    next_at = time.monotonic()

    def _capture(self, path: Path) -> bytes | None:
        if self._closed:
            return None

        pmd3_cmd = [
            self._pmd3,
            "developer",
            "dvt",
            "screenshot",
            "--udid",
            self.udid,
            str(path),
        ]
        try:
            subprocess.run(pmd3_cmd, capture_output=True, check=True, timeout=12)
            if path.exists() and path.stat().st_size > 0:
                return path.read_bytes()
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            pass

        try:
            subprocess.run(
                ["idevicescreenshot", "-u", self.udid, str(path)],
                capture_output=True,
                check=True,
                timeout=12,
            )
            if path.exists() and path.stat().st_size > 0:
                return path.read_bytes()
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            return None
        return None

    async def close(self) -> None:
        self._closed = True
