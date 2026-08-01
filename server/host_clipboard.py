"""Read/write the desktop session clipboard (Wayland/X11) + per-device memory."""

from __future__ import annotations

import logging
import subprocess
import threading
import time

logger = logging.getLogger("qa-dashboard.host-clipboard")

_lock = threading.Lock()
# serial -> (text, monotonic timestamp)
_device_clips: dict[str, tuple[str, float]] = {}


def read_host_clipboard_text() -> str:
    """Return plain text from the compositor clipboard, or empty string."""
    commands = (
        ["wl-paste", "-n", "--type", "text"],
        ["wl-paste", "-n"],
        ["xclip", "-selection", "clipboard", "-o"],
        ["xsel", "--clipboard", "--output"],
    )
    for cmd in commands:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=2,
                check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
        if result.returncode != 0 or not result.stdout:
            continue
        text = result.stdout.decode("utf-8", errors="replace")
        if text.endswith("\n") and text.count("\n") == 1:
            text = text[:-1]
        return text
    return ""


def write_host_clipboard_text(text: str) -> bool:
    """Push text into the compositor clipboard (wl-copy / xclip)."""
    if not text:
        return False
    payload = text.encode("utf-8")
    commands = (
        ["wl-copy", "--type", "text/plain"],
        ["wl-copy", "-t", "text/plain"],
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
    )
    for cmd in commands:
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            assert proc.stdin is not None
            proc.stdin.write(payload)
            proc.stdin.close()
            try:
                proc.wait(timeout=0.4)
            except subprocess.TimeoutExpired:
                pass
            return True
        except (FileNotFoundError, OSError):
            continue
    logger.warning("could not write host clipboard (wl-copy/xclip missing?)")
    return False


def remember_device_clipboard(serial: str, text: str) -> None:
    """Store clipboard text reported by a device (per-serial)."""
    if not serial or not text:
        return
    with _lock:
        _device_clips[serial] = (text, time.monotonic())


def most_recent_clipboard_except(exclude_serial: str, *, max_age_s: float = 600.0) -> str:
    """Latest clipboard from any device other than ``exclude_serial``."""
    now = time.monotonic()
    best_text = ""
    best_at = -1.0
    with _lock:
        for serial, (text, at) in _device_clips.items():
            if serial == exclude_serial:
                continue
            if max_age_s > 0 and (now - at) > max_age_s:
                continue
            if at > best_at:
                best_text, best_at = text, at
    return best_text


def device_own_clipboard(serial: str) -> str:
    with _lock:
        entry = _device_clips.get(serial)
        return entry[0] if entry else ""


def has_device_clipboard(serial: str) -> bool:
    with _lock:
        return serial in _device_clips


# Last text we pushed onto a device via SET_CLIPBOARD (echo suppression).
_last_pushed: dict[str, str] = {}


def note_clipboard_push(serial: str, text: str) -> None:
    with _lock:
        _last_pushed[serial] = text


def was_clipboard_push_echo(serial: str, text: str) -> bool:
    with _lock:
        return _last_pushed.get(serial) == text


def resolve_paste_text(*, client_text: str, target_serial: str) -> tuple[str, str]:
    """
    Choose text to paste onto ``target_serial``.

    Device→device (Samsung copy → Xiaomi paste) must NOT use the target device's
    own stale clipboard. Prefer the most recent clipboard from another connected
    device, then client paste-event text (if it isn't the target's own clip),
    then the compositor clipboard.
    """
    other = most_recent_clipboard_except(target_serial)
    own = device_own_clipboard(target_serial)
    client = client_text or ""

    if other:
        return other, "device"

    if client and client != own:
        return client, "client"

    host = read_host_clipboard_text()
    if host and host != own:
        return host, "host"

    if client:
        return client, "client"
    if host:
        return host, "host"
    return "", "empty"
