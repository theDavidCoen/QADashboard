"""Paste plain text onto an Android device via adb ``input text``.

scrcpy ``INJECT_TEXT`` is ignored by many WebView-based editors (e.g. MIUI Notes).
``adb shell input text`` reaches those fields. Spaces must be encoded as ``%s``.
"""

from __future__ import annotations

import logging
import subprocess
import time

logger = logging.getLogger("qa-dashboard.adb_paste")

# Conservative chunk size — some devices truncate long ``input text`` args.
_ADB_INPUT_CHUNK = 100


def _escape_adb_input_text(text: str) -> str:
    # Order matters: backslash first.
    escaped = text.replace("\\", "\\\\")
    escaped = escaped.replace("%", "\\%")
    escaped = escaped.replace(" ", "%s")
    # Keep the string safe when passed as a single adb argv element (no shell).
    return escaped


def paste_text_via_adb(serial: str, text: str) -> tuple[bool, str]:
    """Type ``text`` into the focused field on ``serial``. Returns (ok, detail)."""
    if not text:
        return False, "empty text"
    if not serial:
        return False, "missing serial"

    chunks = [text[i : i + _ADB_INPUT_CHUNK] for i in range(0, len(text), _ADB_INPUT_CHUNK)]
    for index, chunk in enumerate(chunks):
        escaped = _escape_adb_input_text(chunk)
        try:
            result = subprocess.run(
                ["adb", "-s", serial, "shell", "input", "text", escaped],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
            return False, f"adb error: {exc}"
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip() or f"exit {result.returncode}"
            logger.warning("adb input text failed on %s chunk %s: %s", serial, index, err)
            return False, err
        if index + 1 < len(chunks):
            time.sleep(0.03)
    return True, f"adb input {len(chunks)} chunk(s)"
