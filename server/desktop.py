"""Desktop shell: local FastAPI server + native webview window."""

from __future__ import annotations

import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_DIST = ROOT / "web" / "dist"
# Must match desktop file basename (it.davidcoen.qa-dashboard.desktop) for GNOME/Dash.
APP_ID = "it.davidcoen.qa-dashboard"
ICON_CANDIDATES = (
    Path.home() / ".local" / "share" / "icons" / "hicolor" / "256x256" / "apps" / "qa-dashboard.png",
    Path.home() / ".local" / "share" / "icons" / "hicolor" / "scalable" / "apps" / "qa-dashboard.svg",
    ROOT / "packaging" / "qa-dashboard.svg",
)


def _resolve_icon() -> str | None:
    for path in ICON_CANDIDATES:
        if path.is_file():
            return str(path)
    return None


def _configure_gtk_app_id() -> None:
    """pywebview creates Gtk.Application with id=None → generic dock icon on GNOME."""
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, Gtk

    if not getattr(Gtk.Application, "_qa_dashboard_app_id_patched", False):
        _original_new = Gtk.Application.new

        def _new_with_id(application_id=None, flags=0):  # noqa: ANN001
            return _original_new(APP_ID, flags)

        Gtk.Application.new = _new_with_id  # type: ignore[method-assign]
        Gtk.Application._qa_dashboard_app_id_patched = True  # type: ignore[attr-defined]

    # X11 fallback when Wayland app_id matching is unavailable.
    try:
        Gdk.set_program_class(APP_ID)
    except Exception:  # noqa: BLE001
        pass


def _server_cfg() -> tuple[str, int]:
    from .config import load_config

    cfg = load_config().get("server", {})
    host = str(cfg.get("host", "127.0.0.1"))
    port = int(cfg.get("port", 9470))
    return host, port


def _base_url(host: str, port: int) -> str:
    # Bind may be 0.0.0.0; always open the UI on loopback.
    open_host = "127.0.0.1" if host in {"0.0.0.0", "::", "[::]"} else host
    return f"http://{open_host}:{port}"


def _health_ok(base: str, timeout: float = 0.4) -> bool:
    try:
        with urllib.request.urlopen(f"{base}/api/health", timeout=timeout) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _port_in_use(host: str, port: int) -> bool:
    probe_host = "127.0.0.1" if host in {"0.0.0.0", "::", "[::]"} else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((probe_host, port)) == 0


def _run_uvicorn(host: str, port: int) -> None:
    import uvicorn

    uvicorn.run("server.main:app", host=host, port=port, reload=False, log_level="info")


def _wait_ready(base: str, seconds: float = 30.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if _health_ok(base):
            return True
        time.sleep(0.15)
    return False


def _notify(title: str, body: str) -> None:
    try:
        import subprocess

        subprocess.run(
            ["notify-send", "--app-name=QA Dashboard", title, body],
            check=False,
            capture_output=True,
        )
    except OSError:
        pass


def main() -> int:
    if not (WEB_DIST / "index.html").is_file():
        msg = "Frontend not built. Run: cd web && npm run build"
        print(msg, file=sys.stderr)
        _notify("QA Dashboard", msg)
        return 1

    try:
        import webview
    except ImportError:
        msg = "Missing pywebview. Run: .venv/bin/pip install -r requirements.txt"
        print(msg, file=sys.stderr)
        _notify("QA Dashboard", msg)
        return 1

    try:
        import gi  # noqa: F401  # required by pywebview GTK backend on Linux

        _configure_gtk_app_id()
    except ImportError:
        msg = (
            "Missing PyGObject (gi). On Arch/CachyOS: sudo pacman -S python-gobject webkit2gtk-4.1\n"
            "Then recreate the venv with: python3 -m venv --system-site-packages .venv"
        )
        print(msg, file=sys.stderr)
        _notify("QA Dashboard", "Missing python-gobject (see terminal / README).")
        return 1

    host, port = _server_cfg()
    base = _base_url(host, port)

    if _health_ok(base):
        print(f"Reusing already running server at {base}")
    elif _port_in_use(host, port):
        msg = f"Port {port} is busy but /api/health is not responding."
        print(msg, file=sys.stderr)
        _notify("QA Dashboard", msg)
        return 1
    else:
        thread = threading.Thread(
            target=_run_uvicorn,
            args=(host, port),
            name="qa-dashboard-uvicorn",
            daemon=True,
        )
        thread.start()
        if not _wait_ready(base):
            msg = f"Server did not become ready at {base}"
            print(msg, file=sys.stderr)
            _notify("QA Dashboard", msg)
            return 1

    window = webview.create_window(
        "QA Dashboard",
        base,
        width=1440,
        height=900,
        min_size=(960, 640),
        background_color="#0a0a0a",
    )
    # Keep a reference so the window is not GC'd before start().
    assert window is not None

    # private_mode=True (pywebview default) disables localStorage in WebKitGTK,
    # which blanks the UI (theme script + ThemeToggle throw on boot).
    storage = Path.home() / ".local" / "share" / "qa-dashboard" / "webview"
    storage.mkdir(parents=True, exist_ok=True)

    try:
        webview.start(
            gui="gtk",
            private_mode=False,
            storage_path=str(storage),
            icon=_resolve_icon(),
        )
    except KeyboardInterrupt:
        return 0
    except Exception as exc:  # noqa: BLE001 — surface backend errors to the user
        msg = f"Failed to open desktop window: {exc}"
        print(msg, file=sys.stderr)
        _notify("QA Dashboard", str(exc))
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
