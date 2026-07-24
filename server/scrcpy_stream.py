"""Scrcpy 4.x server bridge: relay H.264 packets over WebSocket."""

from __future__ import annotations

import asyncio
import random
import re
import socket
import struct
import subprocess
from pathlib import Path

from .config import load_config

MSG_CONFIG = 1
MSG_VIDEO = 2

PACKET_HEADER_SIZE = 12
SC_PACKET_FLAG_CONFIG = 1 << 62
SC_PACKET_FLAG_KEY_FRAME = 1 << 61
PORT_RANGE = range(27183, 27200)


def _detect_scrcpy_version() -> str | None:
    try:
        result = subprocess.run(
            ["scrcpy", "--version"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    match = re.search(r"scrcpy\s+(\d+\.\d+(?:\.\d+)?)", result.stdout or result.stderr or "")
    return match.group(1) if match else None


class ScrcpyStream:
    def __init__(self, serial: str) -> None:
        self.serial = serial
        self._cfg = load_config().get("scrcpy", {})
        self._server_proc: subprocess.Popen[str] | None = None
        self._listen_sock: socket.socket | None = None
        self._video_sock: socket.socket | None = None
        self._control_sock: socket.socket | None = None
        self._socket_name = f"scrcpy_{random.randint(1, 0x7FFFFFFF):08x}"
        self._scid = self._socket_name.removeprefix("scrcpy_")
        self._local_port = 0
        self._tunnel_forward = False
        self.width = 0
        self.height = 0
        self._closed = False
        self._control_lock = asyncio.Lock()
        self._server_log = ""

    @property
    def server_jar(self) -> str:
        return str(self._cfg.get("server_jar", "/usr/share/scrcpy/scrcpy-server"))

    @property
    def server_version(self) -> str:
        configured = self._cfg.get("server_version")
        if configured:
            return str(configured)
        return _detect_scrcpy_version() or "4.1"

    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._start_blocking)

    def _run_adb(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        cmd = ["adb", "-s", self.serial, *args]
        return subprocess.run(cmd, capture_output=True, text=True, check=check)

    def _start_blocking(self) -> None:
        jar = Path(self.server_jar)
        if not jar.exists():
            raise FileNotFoundError(f"scrcpy server jar not found: {jar}")

        push = self._run_adb("push", str(jar), "/data/local/tmp/scrcpy-server.jar", check=False)
        if push.returncode != 0:
            detail = (push.stderr or push.stdout or "").strip()
            raise RuntimeError(f"adb push scrcpy-server failed: {detail or push.returncode}")

        self._run_adb("shell", "pkill -f com.genymobile.scrcpy.Server || true", check=False)

        self._listen_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listen_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

        for port in PORT_RANGE:
            try:
                self._listen_sock.bind(("127.0.0.1", port))
                self._local_port = port
                break
            except OSError:
                continue
        else:
            raise RuntimeError("Could not bind a local port for scrcpy")

        self._listen_sock.listen(2)
        self._listen_sock.settimeout(12)

        reverse = self._run_adb(
            "reverse",
            f"localabstract:{self._socket_name}",
            f"tcp:{self._local_port}",
            check=False,
        )
        if reverse.returncode != 0:
            self._tunnel_forward = True
            self._run_adb(
                "forward",
                f"tcp:{self._local_port}",
                f"localabstract:{self._socket_name}",
            )
        else:
            self._tunnel_forward = False

        max_size = int(self._cfg.get("max_size", 1080))
        max_fps = int(self._cfg.get("max_fps", 60))
        bit_rate = int(self._cfg.get("bit_rate", 16_000_000))
        server_args = " ".join(
            part
            for part in [
                self.server_version,
                f"scid={self._scid}",
                "audio=false",
                "cleanup=false",
                f"max_size={max_size}",
                f"max_fps={max_fps}",
                f"video_bit_rate={bit_rate}",
                "log_level=info",
                "tunnel_forward=true" if self._tunnel_forward else "",
            ]
            if part
        )
        shell_cmd = (
            "CLASSPATH=/data/local/tmp/scrcpy-server.jar "
            f"app_process / com.genymobile.scrcpy.Server {server_args}"
        )
        self._server_proc = subprocess.Popen(
            ["adb", "-s", self.serial, "shell", shell_cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        try:
            if self._tunnel_forward:
                self._video_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._video_sock.settimeout(12)
                self._video_sock.connect(("127.0.0.1", self._local_port))
                self._recv_exact(self._video_sock, 1)
                self._video_sock.settimeout(None)

                self._control_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._control_sock.settimeout(12)
                self._control_sock.connect(("127.0.0.1", self._local_port))
                self._control_sock.settimeout(None)
                self._control_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

                self._listen_sock.close()
                self._listen_sock = None
            else:
                self._video_sock, _ = self._listen_sock.accept()
                self._video_sock.settimeout(None)
                self._control_sock, _ = self._listen_sock.accept()
                self._control_sock.settimeout(None)
                self._control_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                self._listen_sock.close()
                self._listen_sock = None

            self._read_bootstrap()
        except Exception as exc:
            self._server_log = self._drain_server_log()
            hint = self._server_log.strip() or str(exc)
            raise RuntimeError(f"scrcpy start failed (client {self.server_version}): {hint}") from exc

    def _drain_server_log(self) -> str:
        proc = self._server_proc
        if proc is None or proc.stdout is None:
            return self._server_log
        try:
            if proc.poll() is None:
                proc.kill()
            out, _ = proc.communicate(timeout=2)
            return out or ""
        except Exception:
            return self._server_log

    def _recv_exact(self, sock: socket.socket, size: int) -> bytes:
        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            chunk = sock.recv(remaining)
            if not chunk:
                raise ConnectionError("scrcpy socket closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _read_bootstrap(self) -> None:
        assert self._video_sock is not None
        sock = self._video_sock

        self._recv_exact(sock, 64)
        self._recv_exact(sock, 4)

        session = self._recv_exact(sock, PACKET_HEADER_SIZE)
        if session[0] & 0x80:
            self.width = struct.unpack(">I", session[4:8])[0]
            self.height = struct.unpack(">I", session[8:12])[0]

    async def config_message(self) -> bytes:
        payload = struct.pack(">II", self.width, self.height)
        return bytes([MSG_CONFIG]) + payload

    async def stream_packets(self):
        loop = asyncio.get_running_loop()
        while not self._closed:
            packet = await loop.run_in_executor(None, self._read_packet)
            if packet is None:
                break
            yield packet

    def _read_packet(self) -> bytes | None:
        if self._closed or self._video_sock is None:
            return None
        try:
            header = self._recv_exact(self._video_sock, PACKET_HEADER_SIZE)
        except (ConnectionError, OSError):
            return None

        if header[0] & 0x80:
            session = header
            prev = (self.width, self.height)
            self.width = struct.unpack(">I", session[4:8])[0]
            self.height = struct.unpack(">I", session[8:12])[0]
            # Orientation / size change: tell the browser so it can rebuild the decoder.
            if prev != (0, 0) and prev != (self.width, self.height) and self.width and self.height:
                return bytes([MSG_CONFIG]) + struct.pack(">II", self.width, self.height)
            return self._read_packet()

        pts_flags = struct.unpack(">Q", header[:8])[0]
        size = struct.unpack(">I", header[8:12])[0]
        if size == 0:
            return b""
        payload = self._recv_exact(self._video_sock, size)

        flags = 0
        if pts_flags & SC_PACKET_FLAG_CONFIG:
            flags |= 0x01
        if pts_flags & SC_PACKET_FLAG_KEY_FRAME:
            flags |= 0x02

        return bytes([MSG_VIDEO, flags]) + payload

    def send_control(self, payload: bytes) -> None:
        if self._closed or self._control_sock is None:
            return
        self._control_sock.sendall(payload)

    def recv_device_message(self) -> dict | None:
        """Blocking read of one scrcpy device→client control message."""
        from .scrcpy_control import (
            DEVICE_MSG_ACK_CLIPBOARD,
            DEVICE_MSG_CLIPBOARD,
            DEVICE_MSG_UHID_OUTPUT,
            parse_device_message,
        )

        sock = self._control_sock
        if self._closed or sock is None:
            return None
        try:
            header = self._recv_exact(sock, 1)
        except (ConnectionError, OSError, TimeoutError):
            return None
        msg_type = header[0]
        try:
            if msg_type == DEVICE_MSG_CLIPBOARD:
                length_buf = self._recv_exact(sock, 4)
                length = struct.unpack(">I", length_buf)[0]
                if length > 1024 * 1024:
                    raise ConnectionError("clipboard message too large")
                body = length_buf + self._recv_exact(sock, length)
                return parse_device_message(msg_type, body)
            if msg_type == DEVICE_MSG_ACK_CLIPBOARD:
                body = self._recv_exact(sock, 8)
                return parse_device_message(msg_type, body)
            if msg_type == DEVICE_MSG_UHID_OUTPUT:
                meta = self._recv_exact(sock, 4)
                size = struct.unpack(">H", meta[2:4])[0]
                if size:
                    self._recv_exact(sock, size)
                return {"type": "uhid_output"}
        except (ConnectionError, OSError, TimeoutError, struct.error):
            return None
        return {"type": "unknown", "code": msg_type}

    async def close(self) -> None:
        self._closed = True
        for sock in (self._video_sock, self._control_sock, self._listen_sock):
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
        self._video_sock = None
        self._control_sock = None
        self._listen_sock = None
        if self._server_proc is not None:
            self._server_proc.terminate()
            try:
                self._server_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._server_proc.kill()
            self._server_proc = None
        if self._local_port:
            subprocess.run(
                [
                    "adb",
                    "-s",
                    self.serial,
                    "reverse",
                    "--remove",
                    f"localabstract:{self._socket_name}",
                ],
                capture_output=True,
            )
            subprocess.run(
                [
                    "adb",
                    "-s",
                    self.serial,
                    "forward",
                    "--remove",
                    f"tcp:{self._local_port}",
                ],
                capture_output=True,
            )
