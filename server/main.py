"""QA Dashboard backend."""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .actions import (
    airplane_mode_async,
    airplane_status_async,
    battery_saver_async,
    battery_saver_status_async,
    custom_adb_async,
    display_power_async,
    display_power_status_async,
    force_stop_async,
    kill_background_async,
    kill_foreground_async,
    list_arkade_sessions_async,
    list_launchable_apps_async,
    normalize_http_url,
    open_url_async,
    reboot_async,
    rotate_async,
    screenshot_async,
    screenrecord_start_async,
    screenrecord_stop_async,
    start_app_async,
    start_package_async,
    vpn_async,
    vpn_status_async,
    wifi_async,
    wifi_status_async,
    wireguard_async,
    wireguard_status_async,
)
from .config import load_config
from .credentials_vault import change_master_password, set_vault_path, unlock_vault, vault_info
from .devices import list_devices
from .edge_accounts import (
    delete_edge_account_async,
    list_edge_accounts_async,
    save_edge_account_async,
    start_edge_account_async,
)
from .ios_control import IosControl, IosControlError
from .ios_stream import IosStream
from .scrcpy_control import from_client_message
from .scrcpy_stream import ScrcpyStream
from .settings_store import SIDEBAR_ACTION_DEFS, load_settings, save_settings

ROOT = Path(__file__).resolve().parents[1]
WEB_DIST = ROOT / "web" / "dist"

active_streams: dict[str, asyncio.Task] = {}


class DeviceIdsBody(BaseModel):
    device_ids: list[str] | None = Field(default=None, alias="deviceIds")

    model_config = {"populate_by_name": True}


class StartAppBody(DeviceIdsBody):
    app: Literal["edge", "edge_develop"]


class OpenUrlBody(DeviceIdsBody):
    url: str


class AirplaneBody(DeviceIdsBody):
    enabled: bool


class SingleDeviceBody(BaseModel):
    device_id: str = Field(alias="deviceId")

    model_config = {"populate_by_name": True}


class StartPackageBody(DeviceIdsBody):
    package: str
    activity: str | None = None
    device_id: str | None = Field(default=None, alias="deviceId")


class EdgeAccountSaveBody(BaseModel):
    username: str
    password: str | None = None
    pin: str | None = None


class StartEdgeAccountBody(DeviceIdsBody):
    username: str
    password: str | None = None
    pin: str | None = None
    save: bool = False
    app: Literal["edge", "edge_develop"] = "edge"


class SettingsPatchBody(BaseModel):
    capture_path: str | None = Field(default=None, alias="capturePath")
    vault_path: str | None = Field(default=None, alias="vaultPath")
    edge_features_enabled: bool | None = Field(default=None, alias="edgeFeaturesEnabled")
    arkade_features_enabled: bool | None = Field(default=None, alias="arkadeFeaturesEnabled")
    sound_effects_enabled: bool | None = Field(default=None, alias="soundEffectsEnabled")
    stream_quality: str | None = Field(default=None, alias="streamQuality")
    sidebar_actions: dict[str, bool] | None = Field(default=None, alias="sidebarActions")
    sidebar_group_order: list[str] | None = Field(default=None, alias="sidebarGroupOrder")
    custom_adb_actions: list[dict] | None = Field(default=None, alias="customAdbActions")
    master_password: str | None = Field(default=None, alias="masterPassword")

    model_config = {"populate_by_name": True}


class MasterPasswordBody(BaseModel):
    current_password: str | None = Field(default=None, alias="currentPassword")
    new_password: str | None = Field(default=None, alias="newPassword")

    model_config = {"populate_by_name": True}


class CustomAdbRunBody(DeviceIdsBody):
    action_id: str = Field(alias="actionId")

    model_config = {"populate_by_name": True}


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    for task in list(active_streams.values()):
        task.cancel()


app = FastAPI(title="QA Dashboard", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/devices")
async def devices() -> dict:
    items = await list_devices()
    return {"devices": [item.to_dict() for item in items]}


@app.post("/api/actions/start-app")
async def action_start_app(body: StartAppBody) -> dict:
    results = await start_app_async(body.app, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/open-url")
async def action_open_url(body: OpenUrlBody) -> dict:
    url = normalize_http_url(body.url)
    if not url:
        raise HTTPException(status_code=400, detail="Invalid URL")
    results = await open_url_async(url, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"url": url, "results": [item.to_dict() for item in results]}


@app.post("/api/actions/airplane-mode")
async def action_airplane_mode(body: AirplaneBody) -> dict:
    results = await airplane_mode_async(body.enabled, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"enabled": body.enabled, "results": [item.to_dict() for item in results]}


@app.get("/api/actions/airplane-mode")
async def action_airplane_status(device_id: str | None = None) -> dict:
    ids = [device_id] if device_id else None
    results = await airplane_status_async(ids)
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/wifi")
async def action_wifi(body: AirplaneBody) -> dict:
    results = await wifi_async(body.enabled, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"enabled": body.enabled, "results": [item.to_dict() for item in results]}


@app.get("/api/actions/wifi")
async def action_wifi_status(device_id: str | None = None) -> dict:
    ids = [device_id] if device_id else None
    results = await wifi_status_async(ids)
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/vpn")
async def action_vpn(body: AirplaneBody) -> dict:
    results = await vpn_async(body.enabled, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"enabled": body.enabled, "results": [item.to_dict() for item in results]}


@app.get("/api/actions/vpn")
async def action_vpn_status(device_id: str | None = None) -> dict:
    ids = [device_id] if device_id else None
    results = await vpn_status_async(ids)
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/vpn-wireguard")
async def action_wireguard(body: AirplaneBody) -> dict:
    results = await wireguard_async(body.enabled, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"enabled": body.enabled, "results": [item.to_dict() for item in results]}


@app.get("/api/actions/vpn-wireguard")
async def action_wireguard_status(device_id: str | None = None) -> dict:
    ids = [device_id] if device_id else None
    results = await wireguard_status_async(ids)
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/battery-saver")
async def action_battery_saver(body: AirplaneBody) -> dict:
    results = await battery_saver_async(body.enabled, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"enabled": body.enabled, "results": [item.to_dict() for item in results]}


@app.get("/api/actions/battery-saver")
async def action_battery_saver_status(device_id: str | None = None) -> dict:
    ids = [device_id] if device_id else None
    results = await battery_saver_status_async(ids)
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/display-power")
async def action_display_power(body: AirplaneBody) -> dict:
    results = await display_power_async(body.enabled, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"enabled": body.enabled, "results": [item.to_dict() for item in results]}


@app.get("/api/actions/display-power")
async def action_display_power_status(device_id: str | None = None) -> dict:
    ids = [device_id] if device_id else None
    results = await display_power_status_async(ids)
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/rotate")
async def action_rotate(body: DeviceIdsBody) -> dict:
    results = await rotate_async(body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/force-stop")
async def action_force_stop(body: DeviceIdsBody) -> dict:
    results = await force_stop_async(body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/reboot")
async def action_reboot(body: DeviceIdsBody) -> dict:
    results = await reboot_async(body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/screenshot")
async def action_screenshot(body: DeviceIdsBody) -> dict:
    results = await screenshot_async(body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/screenrecord/start")
async def action_screenrecord_start(body: SingleDeviceBody) -> dict:
    result = await screenrecord_start_async(body.device_id)
    if not result.ok:
        raise HTTPException(status_code=400, detail=result.detail or "Recording failed")
    return {"results": [result.to_dict()]}


@app.post("/api/actions/screenrecord/stop")
async def action_screenrecord_stop(body: SingleDeviceBody) -> dict:
    result = await screenrecord_stop_async(body.device_id)
    if not result.ok:
        raise HTTPException(status_code=400, detail=result.detail or "Stop failed")
    return {"results": [result.to_dict()]}


@app.get("/api/actions/arkade-sessions")
async def action_arkade_sessions(
    device_id: str | None = None,
    device_ids: str | None = None,
) -> dict:
    ids: list[str] | None = None
    if device_ids:
        ids = [part.strip() for part in device_ids.split(",") if part.strip()]
    elif device_id:
        ids = [device_id]
    sessions = await list_arkade_sessions_async(ids)
    return {"sessions": [item.to_dict() for item in sessions]}


@app.get("/api/actions/apps")
async def action_list_apps(device_id: str) -> dict:
    apps = await list_launchable_apps_async(device_id)
    return {"apps": [item.to_dict() for item in apps]}


@app.post("/api/actions/start-package")
async def action_start_package(body: StartPackageBody) -> dict:
    ids = body.device_ids
    if not ids and body.device_id:
        ids = [body.device_id]
    results = await start_package_async(body.package, body.activity, ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/kill-background")
async def action_kill_background(body: DeviceIdsBody) -> dict:
    results = await kill_background_async(body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.post("/api/actions/kill-foreground")
async def action_kill_foreground(body: DeviceIdsBody) -> dict:
    results = await kill_foreground_async(body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


@app.get("/api/actions/edge-accounts")
async def action_edge_accounts(
    device_id: str | None = None,
    device_ids: str | None = None,
) -> dict:
    ids: list[str] | None = None
    if device_ids:
        ids = [part.strip() for part in device_ids.split(",") if part.strip()]
    elif device_id:
        ids = [device_id]
    return await list_edge_accounts_async(ids)


@app.post("/api/actions/edge-accounts/save")
async def action_edge_accounts_save(body: EdgeAccountSaveBody) -> dict:
    try:
        account = await save_edge_account_async(body.username, body.password, body.pin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"account": account}


@app.delete("/api/actions/edge-accounts/{username}")
async def action_edge_accounts_delete(
    username: str,
    device_id: str | None = None,
    device_ids: str | None = None,
    forget_on_device: bool = True,
) -> dict:
    ids: list[str] | None = None
    if device_ids:
        ids = [part.strip() for part in device_ids.split(",") if part.strip()]
    elif device_id:
        ids = [device_id]
    result = await delete_edge_account_async(
        username,
        ids,
        forget_on_device=forget_on_device,
    )
    if not result.get("deleted"):
        raise HTTPException(status_code=404, detail="Account not in local vault")
    return result


@app.post("/api/actions/start-edge-account")
async def action_start_edge_account(body: StartEdgeAccountBody) -> dict:
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required")
    results = await start_edge_account_async(
        body.username,
        body.device_ids,
        password=body.password,
        pin=body.pin,
        save=body.save,
        app=body.app,
    )
    if not results:
        raise HTTPException(status_code=404, detail="No Android devices matched")
    return {"results": [item.to_dict() for item in results]}


def _settings_response(data: dict | None = None) -> dict:
    settings = data or load_settings()
    try:
        from .credentials_vault import list_saved_accounts

        accounts = [item.to_dict() for item in list_saved_accounts()]
    except PermissionError:
        accounts = []
    return {
        "capturePath": settings["capturePath"],
        "vaultPath": settings["vaultPath"],
        "edgeFeaturesEnabled": bool(settings.get("edgeFeaturesEnabled", True)),
        "arkadeFeaturesEnabled": bool(settings.get("arkadeFeaturesEnabled", True)),
        "soundEffectsEnabled": bool(settings.get("soundEffectsEnabled", True)),
        "streamQuality": settings.get("streamQuality", "high"),
        "sidebarActions": settings["sidebarActions"],
        "sidebarGroupOrder": settings["sidebarGroupOrder"],
        "sidebarActionDefs": SIDEBAR_ACTION_DEFS,
        "customAdbActions": settings["customAdbActions"],
        "vault": vault_info(),
        "vaultAccounts": accounts,
    }


@app.get("/api/settings")
async def get_settings() -> dict:
    return _settings_response()


@app.put("/api/settings")
async def put_settings(body: SettingsPatchBody) -> dict:
    patch: dict = {}
    if body.capture_path is not None:
        patch["capturePath"] = body.capture_path.strip()
    if body.edge_features_enabled is not None:
        patch["edgeFeaturesEnabled"] = body.edge_features_enabled
    if body.arkade_features_enabled is not None:
        patch["arkadeFeaturesEnabled"] = body.arkade_features_enabled
    if body.sound_effects_enabled is not None:
        patch["soundEffectsEnabled"] = body.sound_effects_enabled
    if body.stream_quality is not None:
        patch["streamQuality"] = body.stream_quality
    if body.sidebar_actions is not None:
        patch["sidebarActions"] = body.sidebar_actions
    if body.sidebar_group_order is not None:
        patch["sidebarGroupOrder"] = body.sidebar_group_order
    if body.custom_adb_actions is not None:
        patch["customAdbActions"] = body.custom_adb_actions
    if body.vault_path is not None:
        try:
            set_vault_path(body.vault_path.strip(), body.master_password)
        except (PermissionError, ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        patch["vaultPath"] = str(vault_info()["path"])
    settings = save_settings(patch) if patch else load_settings()
    return _settings_response(settings)


@app.post("/api/settings/master-password")
async def post_master_password(body: MasterPasswordBody) -> dict:
    try:
        info = change_master_password(body.current_password, body.new_password)
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"vault": info}


class UnlockVaultBody(BaseModel):
    password: str


@app.post("/api/settings/unlock-vault")
async def post_unlock_vault(body: UnlockVaultBody) -> dict:
    try:
        unlock_vault(body.password)
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"vault": vault_info()}


@app.post("/api/actions/custom-adb")
async def action_custom_adb(body: CustomAdbRunBody) -> dict:
    results = await custom_adb_async(body.action_id, body.device_ids)
    if not results:
        raise HTTPException(status_code=404, detail="Custom action not found or no devices")
    return {"results": [item.to_dict() for item in results]}


async def _relay_android(websocket: WebSocket, stream: ScrcpyStream) -> None:
    await stream.start()
    # Clipboard in the first moments is often a stale sync on connect — don't
    # push those to the PC / peers. Later changes (and Ctrl+C) do sync.
    setattr(stream, "_clipboard_started_at", time.monotonic())
    await websocket.send_bytes(await stream.config_message())
    loop = asyncio.get_running_loop()

    async def pump_video() -> None:
        async for packet in stream.stream_packets():
            await websocket.send_bytes(packet)

    async def pump_control_in() -> None:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if not text:
                continue
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue

            # Paste: resolve cross-device text, then scrcpy SET_CLIPBOARD+PASTE.
            # Avoid adb ``input text`` for long strings — it stalls the device UI/encoder
            # (looks like a frozen stream). adb is last-resort only.
            if data.get("type") == "paste_from_host":
                from .adb_paste import paste_text_via_adb
                from .host_clipboard import note_clipboard_push, resolve_paste_text
                from .scrcpy_control import inject_text_chunks, set_clipboard

                client_text = str(data.get("text") or "")
                payload_text, source = await loop.run_in_executor(
                    None,
                    lambda: resolve_paste_text(
                        client_text=client_text, target_serial=stream.serial
                    ),
                )
                if not payload_text:
                    try:
                        await websocket.send_json(
                            {"type": "paste_result", "ok": False, "error": "empty clipboard"}
                        )
                    except Exception:
                        pass
                    continue

                note_clipboard_push(stream.serial, payload_text)
                ok = await loop.run_in_executor(
                    None, stream.send_control, set_clipboard(payload_text, paste=True)
                )
                method = "scrcpy_paste"
                detail = "SET_CLIPBOARD+PASTE"
                if not ok:
                    adb_ok, adb_detail = await loop.run_in_executor(
                        None, paste_text_via_adb, stream.serial, payload_text
                    )
                    method = "adb"
                    ok = adb_ok
                    detail = adb_detail
                    if not adb_ok:
                        method = "scrcpy_inject"
                        chunks = inject_text_chunks(payload_text)
                        ok = True
                        for chunk in chunks:
                            if not await loop.run_in_executor(None, stream.send_control, chunk):
                                ok = False
                                break
                        detail = f"adb failed ({adb_detail}); used scrcpy inject"

                try:
                    await websocket.send_json(
                        {
                            "type": "paste_result",
                            "ok": ok,
                            "length": len(payload_text),
                            "preview": payload_text[:64],
                            "source": source,
                            "method": method,
                            "detail": detail,
                        }
                    )
                except Exception:
                    pass
                continue

            # Track explicit Ctrl+C/X so the matching clipboard reply updates host clip.
            if data.get("type") == "clipboard_get":
                setattr(stream, "_expect_clipboard", True)

            payload = from_client_message(data)
            if payload:
                # Touch/scroll/key are high-frequency — never queue them on the
                # default executor or trackpad wheel floods and "sticks".
                msg_type = data.get("type")
                if msg_type in ("touch", "scroll", "key", "text", "back", "display_power"):
                    stream.send_control(payload)
                else:
                    await loop.run_in_executor(None, stream.send_control, payload)

    async def pump_device_out() -> None:
        while True:
            msg = await loop.run_in_executor(None, stream.recv_device_message)
            if msg is None:
                break
            if msg.get("type") == "clipboard" and isinstance(msg.get("text"), str):
                from .host_clipboard import (
                    device_own_clipboard,
                    note_clipboard_push,
                    remember_device_clipboard,
                    was_clipboard_push_echo,
                    write_host_clipboard_text,
                )
                from .scrcpy_control import set_clipboard
                from .scrcpy_stream import iter_active_streams

                text = msg["text"]
                explicit = bool(getattr(stream, "_expect_clipboard", False))
                if explicit:
                    setattr(stream, "_expect_clipboard", False)

                # Echo of a clipboard we just pushed — don't rebroadcast (loop).
                if was_clipboard_push_echo(stream.serial, text):
                    remember_device_clipboard(stream.serial, text)
                    try:
                        await websocket.send_json(msg)
                    except Exception:
                        break
                    continue

                prev = device_own_clipboard(stream.serial)
                remember_device_clipboard(stream.serial, text)

                # Real copy → PC clipboard + peer devices. Skip only the brief
                # post-connect window (stale device clip), unless Ctrl/⌘+C/X.
                started = float(getattr(stream, "_clipboard_started_at", 0.0) or 0.0)
                within_grace = started > 0 and (time.monotonic() - started) < 2.0
                should_sync = bool(text) and (
                    explicit or (not within_grace and text != prev)
                )
                if should_sync:
                    # Fire-and-forget — don't stall the control reader on wl-copy.
                    loop.run_in_executor(None, write_host_clipboard_text, text)

                    def _push_to(other_stream: ScrcpyStream, payload: str) -> None:
                        note_clipboard_push(other_stream.serial, payload)
                        other_stream.send_control(set_clipboard(payload, paste=False))

                    for other in iter_active_streams():
                        if other.serial == stream.serial:
                            continue
                        loop.run_in_executor(None, _push_to, other, text)

                try:
                    await websocket.send_json(msg)
                except Exception:
                    break
                continue
            if msg.get("type") == "clipboard_ack":
                try:
                    await websocket.send_json(msg)
                except Exception:
                    break
                continue

    video_task = asyncio.create_task(pump_video())
    control_in_task = asyncio.create_task(pump_control_in())
    device_out_task = asyncio.create_task(pump_device_out())
    done, pending = await asyncio.wait(
        {video_task, control_in_task, device_out_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()


async def _relay_ios(websocket: WebSocket, stream: IosStream) -> None:
    control = IosControl(stream.udid)

    async def pump_video() -> None:
        async for packet in stream.stream_packets():
            if isinstance(packet, dict):
                await websocket.send_json(packet)
            else:
                await websocket.send_bytes(packet)

    async def pump_control() -> None:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if not text:
                continue
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue
            try:
                await control.handle(data)
            except IosControlError as exc:
                try:
                    await websocket.send_json({"error": str(exc), "control": True})
                except Exception:
                    pass

    video_task = asyncio.create_task(pump_video())
    control_task = asyncio.create_task(pump_control())
    done, pending = await asyncio.wait(
        {video_task, control_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()


@app.websocket("/ws/stream/{device_id}")
async def stream_device(websocket: WebSocket, device_id: str) -> None:
    await websocket.accept()
    all_devices = await list_devices()
    device = next((d for d in all_devices if d.id == device_id), None)
    if device is None:
        await websocket.close(code=4404)
        return

    stream: ScrcpyStream | IosStream | None = None
    try:
        if device.platform == "android":
            stream = ScrcpyStream(device_id)
            await _relay_android(websocket, stream)
        else:
            stream = IosStream(device_id)
            await stream.start()
            await _relay_ios(websocket, stream)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json({"error": str(exc)})
        except Exception:
            pass
    finally:
        if stream is not None:
            await stream.close()


def mount_frontend() -> None:
    if WEB_DIST.exists():
        assets_dir = WEB_DIST / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        mockups_dir = WEB_DIST / "mockups"
        if mockups_dir.exists():
            app.mount("/mockups", StaticFiles(directory=mockups_dir), name="mockups")

        sounds_dir = WEB_DIST / "sounds"
        if sounds_dir.exists():
            app.mount("/sounds", StaticFiles(directory=sounds_dir), name="sounds")

        def _index_response() -> FileResponse:
            return FileResponse(
                WEB_DIST / "index.html",
                headers={
                    "Cache-Control": "no-store, no-cache, must-revalidate",
                    "Pragma": "no-cache",
                },
            )

        @app.get("/")
        async def spa_root() -> FileResponse:
            return _index_response()

        @app.get("/{full_path:path}")
        async def spa(full_path: str) -> FileResponse:
            candidate = WEB_DIST / full_path
            if full_path and candidate.is_file():
                # Hashed Vite assets are fine to cache; HTML must not be.
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
                if full_path.endswith((".html",)):
                    headers = {
                        "Cache-Control": "no-store, no-cache, must-revalidate",
                        "Pragma": "no-cache",
                    }
                return FileResponse(candidate, headers=headers)
            return _index_response()


mount_frontend()


def main() -> None:
    import uvicorn

    cfg = load_config().get("server", {})
    host = cfg.get("host", "127.0.0.1")
    port = int(cfg.get("port", 9470))
    uvicorn.run("server.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
