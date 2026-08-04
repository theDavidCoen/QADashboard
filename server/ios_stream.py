"""iOS screen relay via pymobiledevice3 (auto-mount + DVT screenshot).

On iOS 17+, DVT requires a RemoteXPC tunnel. Privileged `tunneld` needs sudo;
we use the in-process `--userspace` tunnel (no root) and keep it open for the
stream lifetime so frames stay ~0.6s instead of re-establishing each shot.
"""

from __future__ import annotations

import asyncio
import io
import logging
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image

from .config import load_config

logger = logging.getLogger(__name__)

MSG_CONFIG = 1
MSG_JPEG = 3


def _to_jpeg(data: bytes, *, quality: int = 70, max_width: int = 1080) -> tuple[bytes, int, int]:
    """Normalize PNG/JPEG screenshot bytes to JPEG; optionally downscale."""
    im = Image.open(io.BytesIO(data))
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    elif im.mode == "L":
        im = im.convert("RGB")
    w, h = im.size
    if max_width > 0 and w > max_width:
        nh = max(1, round(h * max_width / w))
        im = im.resize((max_width, nh), Image.Resampling.BILINEAR)
        w, h = im.size
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue(), w, h


class IosStream:
    def __init__(self, udid: str) -> None:
        self.udid = udid
        self._cfg = load_config().get("ios", {})
        self._closed = False
        self._mounted = False
        self._screen_size: tuple[int, int] | None = None
        self._pmd3 = self._resolve_pmd3()
        self._rsd: Any = None
        self._dvt_cm: Any = None
        self._shot_cm: Any = None
        self._screenshot: Any = None
        self._last_error: str | None = None

    @property
    def fps(self) -> float:
        return float(self._cfg.get("screenshot_fps", 8))

    @property
    def jpeg_quality(self) -> int:
        return int(self._cfg.get("jpeg_quality", 70))

    @property
    def max_width(self) -> int:
        return int(self._cfg.get("max_width", 1080))

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
        await self._open_dvt_session()

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
        combined = (result.stdout + result.stderr).lower()
        self._mounted = result.returncode == 0 or "mounted" in combined
        if not self._mounted:
            self._last_error = (result.stderr or result.stdout or "Developer image mount failed").strip()
            logger.warning("iOS DDI mount failed for %s: %s", self.udid, self._last_error)

    async def _open_dvt_session(self) -> None:
        """Open a persistent userspace RSD + DVT screenshot channel (iOS 17+)."""
        await self._close_dvt_session()
        try:
            from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
            from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
            from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot
        except ImportError as exc:
            self._last_error = f"pymobiledevice3 DVT API unavailable: {exc}"
            logger.warning(self._last_error)
            return

        try:
            self._rsd = await establish_userspace_rsd(serial=self.udid)
            self._dvt_cm = DvtProvider(self._rsd)
            dvt = await self._dvt_cm.__aenter__()
            self._shot_cm = Screenshot(dvt)
            self._screenshot = await self._shot_cm.__aenter__()
            self._last_error = None
            logger.info("iOS DVT userspace session ready for %s", self.udid)
        except Exception as exc:
            self._last_error = f"iOS DVT tunnel failed: {exc}"
            logger.exception("Failed to open iOS DVT session for %s", self.udid)
            await self._close_dvt_session()

    async def _close_dvt_session(self) -> None:
        for cm in (self._shot_cm, self._dvt_cm):
            if cm is None:
                continue
            try:
                await cm.__aexit__(None, None, None)
            except Exception:
                logger.debug("DVT context close error", exc_info=True)
        self._shot_cm = None
        self._dvt_cm = None
        self._screenshot = None

        rsd = self._rsd
        self._rsd = None
        if rsd is None:
            return
        for name in ("aclose", "close"):
            fn = getattr(rsd, name, None)
            if not callable(fn):
                continue
            try:
                result = fn()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.debug("RSD close error", exc_info=True)
            break

    async def stream_packets(self):
        interval = 1.0 / max(self.fps, 1.0)
        sent_config = False
        next_at = time.monotonic()
        failures = 0

        while not self._closed:
            data = await self._capture_frame()
            if data:
                failures = 0
                jpeg, width, height = data
                if not sent_config or self._screen_size != (width, height):
                    self._screen_size = (width, height)
                    config = self.config_message()
                    if config:
                        yield config
                        sent_config = True
                yield bytes([MSG_JPEG]) + jpeg
            else:
                failures += 1
                if failures == 1 or failures % 8 == 0:
                    err = self._last_error or "Waiting for iOS screenshot…"
                    # UI reads JSON text frames with {error: ...}
                    yield {"error": err}
                if failures in (3, 10) and self._screenshot is None:
                    await self._open_dvt_session()

            next_at += interval
            delay = next_at - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            else:
                next_at = time.monotonic()

    async def _capture_frame(self) -> tuple[bytes, int, int] | None:
        if self._closed:
            return None

        if self._screenshot is not None:
            try:
                raw = await self._screenshot.get_screenshot()
                return _to_jpeg(raw, quality=self.jpeg_quality, max_width=self.max_width)
            except Exception as exc:
                self._last_error = f"Screenshot failed: {exc}"
                logger.warning("iOS screenshot error for %s: %s", self.udid, exc)
                await self._close_dvt_session()
                return None

        # Fallback: one-shot CLI with --userspace (slower; reconnects each time).
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._capture_cli)

    def _capture_cli(self) -> tuple[bytes, int, int] | None:
        import tempfile

        with tempfile.TemporaryDirectory(prefix="qa-ios-") as tmp:
            path = Path(tmp) / "screen.png"
            cmd = [
                self._pmd3,
                "developer",
                "dvt",
                "screenshot",
                "--userspace",
                "--udid",
                self.udid,
                str(path),
            ]
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.returncode != 0 or not path.exists() or path.stat().st_size == 0:
                    self._last_error = (result.stderr or result.stdout or "CLI screenshot failed").strip()
                    return None
                return _to_jpeg(path.read_bytes(), quality=self.jpeg_quality, max_width=self.max_width)
            except (subprocess.TimeoutExpired, OSError) as exc:
                self._last_error = str(exc)
                return None

    async def close(self) -> None:
        self._closed = True
        await self._close_dvt_session()
