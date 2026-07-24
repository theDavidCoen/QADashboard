"""Serialize scrcpy control messages (protocol v4)."""

from __future__ import annotations

import struct

SC_POINTER_ID_MOUSE = (1 << 64) - 1

TYPE_INJECT_KEYCODE = 0
TYPE_INJECT_TEXT = 1
TYPE_INJECT_TOUCH_EVENT = 2
TYPE_INJECT_SCROLL_EVENT = 3
TYPE_BACK_OR_SCREEN_ON = 4
TYPE_GET_CLIPBOARD = 8
TYPE_SET_CLIPBOARD = 9

DEVICE_MSG_CLIPBOARD = 0
DEVICE_MSG_ACK_CLIPBOARD = 1
DEVICE_MSG_UHID_OUTPUT = 2

COPY_KEY_NONE = 0
COPY_KEY_COPY = 1
COPY_KEY_CUT = 2

CLIPBOARD_TEXT_MAX = 256 * 1024

# Android MotionEvent
ACTION_DOWN = 0
ACTION_UP = 1
ACTION_MOVE = 2

# Android KeyEvent
KEYCODE_BACK = 4
KEYCODE_HOME = 3
KEYCODE_APP_SWITCH = 187
KEYCODE_ENTER = 66
KEYCODE_DEL = 67

BUTTON_PRIMARY = 1 << 0

_clipboard_sequence = 1


def get_clipboard(copy_key: int = COPY_KEY_COPY) -> bytes:
    return bytes([TYPE_GET_CLIPBOARD, int(copy_key) & 0xFF])


def set_clipboard(text: str, *, paste: bool = False) -> bytes:
    global _clipboard_sequence
    payload = text.encode("utf-8")[:CLIPBOARD_TEXT_MAX]
    sequence = 0
    if paste:
        sequence = _clipboard_sequence
        _clipboard_sequence = (_clipboard_sequence + 1) & 0xFFFFFFFFFFFFFFFF
        if _clipboard_sequence == 0:
            _clipboard_sequence = 1
    buf = bytearray(1 + 8 + 1 + 4 + len(payload))
    buf[0] = TYPE_SET_CLIPBOARD
    struct.pack_into(">Q", buf, 1, sequence)
    buf[9] = 1 if paste else 0
    struct.pack_into(">I", buf, 10, len(payload))
    buf[14 : 14 + len(payload)] = payload
    return bytes(buf)


def parse_device_message(header_type: int, body: bytes) -> dict | None:
    """Parse a scrcpy device→client control message (body after the type byte)."""
    if header_type == DEVICE_MSG_CLIPBOARD:
        if len(body) < 4:
            return None
        length = struct.unpack(">I", body[:4])[0]
        text = body[4 : 4 + length].decode("utf-8", errors="replace")
        return {"type": "clipboard", "text": text}
    if header_type == DEVICE_MSG_ACK_CLIPBOARD:
        return {"type": "clipboard_ack"}
    return None


def inject_touch_event(
    action: int,
    x: int,
    y: int,
    screen_width: int,
    screen_height: int,
    *,
    pressure: float = 1.0,
    pointer_id: int = SC_POINTER_ID_MOUSE,
    buttons: int = BUTTON_PRIMARY,
) -> bytes:
    buf = bytearray(32)
    buf[0] = TYPE_INJECT_TOUCH_EVENT
    buf[1] = action
    struct.pack_into(">Q", buf, 2, pointer_id)
    struct.pack_into(">I", buf, 10, max(0, x))
    struct.pack_into(">I", buf, 14, max(0, y))
    struct.pack_into(">H", buf, 18, screen_width)
    struct.pack_into(">H", buf, 20, screen_height)
    struct.pack_into(">H", buf, 22, _float_to_u16(pressure if action != ACTION_UP else 0.0))
    struct.pack_into(">I", buf, 24, BUTTON_PRIMARY if action == ACTION_DOWN else 0)
    struct.pack_into(">I", buf, 28, buttons if action in (ACTION_DOWN, ACTION_MOVE) else 0)
    return bytes(buf)


def inject_keycode(action: int, keycode: int, repeat: int = 0, metastate: int = 0) -> bytes:
    buf = bytearray(14)
    buf[0] = TYPE_INJECT_KEYCODE
    buf[1] = action
    struct.pack_into(">I", buf, 2, keycode)
    struct.pack_into(">I", buf, 6, repeat)
    struct.pack_into(">I", buf, 10, metastate)
    return bytes(buf)


def inject_text(text: str) -> bytes:
    payload = text.encode("utf-8")[:300]
    buf = bytearray(1 + 4 + len(payload))
    buf[0] = TYPE_INJECT_TEXT
    struct.pack_into(">I", buf, 1, len(payload))
    buf[5 : 5 + len(payload)] = payload
    return bytes(buf)


def back_or_screen_on(action: int = 0) -> bytes:
    return bytes([TYPE_BACK_OR_SCREEN_ON, action])


def _float_to_u16(value: float) -> int:
    clamped = max(0.0, min(1.0, value))
    return int(clamped * 0xFFFF)


def from_client_message(data: dict) -> bytes | None:
    msg_type = data.get("type")
    if msg_type == "touch":
        return inject_touch_event(
            int(data["action"]),
            int(data["x"]),
            int(data["y"]),
            int(data["width"]),
            int(data["height"]),
            pressure=float(data.get("pressure", 1.0)),
            buttons=int(data.get("buttons", BUTTON_PRIMARY)),
        )
    if msg_type == "key":
        return inject_keycode(int(data["action"]), int(data["keycode"]))
    if msg_type == "text":
        text = str(data.get("text", ""))
        return inject_text(text) if text else None
    if msg_type == "back":
        return back_or_screen_on(0)
    if msg_type == "clipboard_set":
        text = str(data.get("text", ""))
        if not text:
            return None
        return set_clipboard(text, paste=bool(data.get("paste", False)))
    if msg_type == "clipboard_get":
        key = str(data.get("copyKey") or data.get("key") or "copy").lower()
        copy_key = COPY_KEY_CUT if key == "cut" else COPY_KEY_COPY if key == "copy" else COPY_KEY_NONE
        return get_clipboard(copy_key)
    return None
