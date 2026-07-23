"""iOS input via WebDriverAgent (pymobiledevice3)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from pymobiledevice3.exceptions import AppNotInstalledError, ConnectionFailedError, WdaError
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.wda import WdaServiceClient

from .config import load_config

logger = logging.getLogger(__name__)


class IosControlError(RuntimeError):
    pass


class IosControl:
    def __init__(self, udid: str) -> None:
        self.udid = udid
        self._cfg = load_config().get("ios", {})
        self._client: WdaServiceClient | None = None
        self._session_id: str | None = None
        self._wda_size: tuple[int, int] = (375, 667)
        self._stream_size: tuple[int, int] = (750, 1334)
        self._ready = False
        self._error: str | None = None
        self._lock = asyncio.Lock()

    def _to_wda(self, x: int, y: int) -> tuple[int, int]:
        sw, sh = self._stream_size
        ww, wh = self._wda_size
        if sw <= 0 or sh <= 0:
            return x, y
        return round(x * ww / sw), round(y * wh / sh)

    async def ensure_ready(self) -> None:
        async with self._lock:
            if self._ready:
                return
            if self._error:
                raise IosControlError(self._error)
            try:
                lockdown = await asyncio.to_thread(create_using_usbmux, self.udid)
                client = WdaServiceClient(service_provider=lockdown)
                session_id = await client.start_session()
                size = await client.get_window_size(session_id)
                self._client = client
                self._session_id = session_id
                self._wda_size = (int(size.get("width", 375)), int(size.get("height", 667)))
                self._ready = True
            except AppNotInstalledError:
                self._error = (
                    "WebDriverAgent non installato sull'iPhone. "
                    "Installalo con Xcode (WebDriverAgentRunner) per abilitare mouse/tastiera."
                )
                raise IosControlError(self._error) from None
            except (ConnectionFailedError, WdaError, OSError) as exc:
                self._error = (
                    "Controllo iOS non disponibile — avvia WebDriverAgent sull'iPhone. "
                    f"Dettaglio: {exc}"
                )
                raise IosControlError(self._error) from exc

    async def handle(self, data: dict[str, Any]) -> None:
        if data.get("type") == "screen":
            width = int(data.get("width", 0))
            height = int(data.get("height", 0))
            if width > 0 and height > 0:
                self._stream_size = (width, height)
            return

        await self.ensure_ready()
        assert self._client is not None
        assert self._session_id is not None

        msg_type = data.get("type")
        if msg_type == "touch":
            x, y = self._to_wda(int(data.get("x", 0)), int(data.get("y", 0)))
            action = int(data.get("action", 0))
            end_x = data.get("endX")
            end_y = data.get("endY")
            if action == 2 and end_x is not None and end_y is not None:
                x2, y2 = self._to_wda(int(end_x), int(end_y))
                await self._client.swipe(x, y, x2, y2, duration=0.12, session_id=self._session_id)
            else:
                await self._client.swipe(x, y, x, y, duration=0.05, session_id=self._session_id)
            return

        if msg_type == "key":
            keycode = int(data.get("keycode", 0))
            if keycode in (3, 4):
                await self._client.press_button("home", session_id=self._session_id)
            return

        if msg_type == "text":
            text = str(data.get("text", ""))
            if text:
                await self._client.send_keys(text, session_id=self._session_id)
