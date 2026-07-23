"""Start Edge with a saved or new account (local credentials + adb UI)."""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from typing import Literal

from .actions import ActionResult, _resolve_targets, _run, start_app_on_device
from .credentials_vault import (
    delete_account,
    get_password,
    get_pin,
    list_saved_accounts,
    save_account,
    vault_info,
)
from .devices import DeviceInfo

AppKey = Literal["edge", "edge_develop"]

# UI chrome / wallet labels that must never be treated as Edge usernames.
_SKIP_TEXTS = {
    "exit pin",
    "help",
    "use fingerprint",
    "username",
    "password",
    "login",
    "create account",
    "forgot password",
    "already have an account? sign in",
    "sign in",
    "next",
    "ok",
    "cancel",
    "logout",
    "settings",
    "notifications",
    "markets",
    "wallets",
    "assets",
    "home",
    "buy",
    "sell",
    "exchange",
    "send",
    "deposit",
    "search wallets",
    "total balance",
    "fio names",
    "fio requests",
    "walletconnect",
    "scan qr",
    "edgespend",
    "share edge",
    "rewards",
    "dismiss",
}

_WALLET_TICKERS = {
    "btc",
    "bch",
    "bchx",
    "eth",
    "ltc",
    "dash",
    "zano",
    "xrp",
    "doge",
    "sol",
    "avax",
    "matic",
    "usdt",
    "usdc",
    "usd",
}


@dataclass(slots=True)
class EdgeAccountInfo:
    username: str
    on_device: bool
    in_vault: bool
    has_password: bool = False
    has_pin: bool = False

    def to_dict(self) -> dict:
        source = "both" if self.on_device and self.in_vault else ("device" if self.on_device else "vault")
        return {
            "username": self.username,
            "onDevice": self.on_device,
            "inVault": self.in_vault,
            "hasPassword": self.has_password,
            "hasPin": self.has_pin,
            "hasCredentials": self.has_password or self.has_pin,
            "source": source,
        }


def _ui_dump(serial: str) -> str:
    _run(["adb", "-s", serial, "shell", "uiautomator", "dump", "/sdcard/qa-dash-ui.xml"], timeout=12)
    code, out = _run(["adb", "-s", serial, "shell", "cat", "/sdcard/qa-dash-ui.xml"], timeout=8)
    return out if code == 0 else ""


def _bounds_center(bounds: str) -> tuple[int, int] | None:
    match = re.search(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not match:
        return None
    x1, y1, x2, y2 = map(int, match.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def _rid_matches(value: str, wanted: str) -> bool:
    return value == wanted or value.endswith("/" + wanted) or value.endswith(":" + wanted)


def _find_node(
    xml: str,
    *,
    resource_id: str | None = None,
    text: str | None = None,
    content_desc: str | None = None,
    clickable_only: bool = False,
) -> tuple[int, int] | None:
    for match in re.finditer(r"<node\b[^>]*>", xml):
        tag = match.group(0)
        if resource_id is not None:
            rid = re.search(r'resource-id="([^"]*)"', tag)
            if not rid or not _rid_matches(rid.group(1), resource_id):
                continue
        if text is not None:
            t = re.search(r'text="([^"]*)"', tag)
            if not t or t.group(1) != text:
                continue
        if content_desc is not None:
            d = re.search(r'content-desc="([^"]*)"', tag)
            if not d or d.group(1) != content_desc:
                continue
        if clickable_only:
            c = re.search(r'clickable="([^"]*)"', tag)
            if not c or c.group(1) != "true":
                continue
        b = re.search(r'bounds="([^"]+)"', tag)
        if not b:
            continue
        center = _bounds_center(b.group(1))
        if center:
            return center
    return None


def _tap(serial: str, x: int, y: int) -> None:
    _run(["adb", "-s", serial, "shell", "input", "tap", str(x), str(y)], timeout=5)


def _tap_id(serial: str, resource_id: str, xml: str | None = None) -> bool:
    dump = xml if xml is not None else _ui_dump(serial)
    point = _find_node(dump, resource_id=resource_id)
    if not point:
        return False
    _tap(serial, *point)
    return True


def _tap_text(serial: str, text: str, xml: str | None = None) -> bool:
    dump = xml if xml is not None else _ui_dump(serial)
    point = _find_node(dump, text=text)
    if not point:
        return False
    _tap(serial, *point)
    return True


def _tap_desc(serial: str, desc: str, xml: str | None = None, *, clickable_only: bool = True) -> bool:
    dump = xml if xml is not None else _ui_dump(serial)
    point = _find_node(dump, content_desc=desc, clickable_only=clickable_only)
    if not point:
        point = _find_node(dump, content_desc=desc, clickable_only=False)
    if not point:
        return False
    _tap(serial, *point)
    return True


def _clear_field(serial: str, length: int = 64) -> None:
    # Move to end, then delete.
    _run(["adb", "-s", serial, "shell", "input", "keyevent", "KEYCODE_MOVE_END"], timeout=3)
    for _ in range(length):
        _run(["adb", "-s", serial, "shell", "input", "keyevent", "KEYCODE_DEL"], timeout=2)


def _adb_type(serial: str, text: str) -> bool:
    """Type text via adb (`input text`). Spaces become %s."""
    if not text:
        return True
    escaped = text.replace(" ", "%s")
    # `adb shell input text` is fragile with shell metacharacters — pass as one argv.
    code, out = _run(["adb", "-s", serial, "shell", "input", "text", escaped], timeout=8)
    return code == 0 and "Error" not in (out or "")


def _wait_login_ui(serial: str, timeout: float = 20.0) -> str:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        last = _ui_dump(serial)
        if "login-scene" in last or "usernameFormField" in last or "Exit PIN" in last or "passwordFormField" in last:
            return last
        time.sleep(0.6)
    return last


def _looks_like_username(value: str) -> bool:
    cleaned = value.strip()
    if not cleaned or len(cleaned) < 3 or len(cleaned) > 48:
        return False
    lower = cleaned.lower()
    if lower in _SKIP_TEXTS or lower in _WALLET_TICKERS:
        return False
    if cleaned.startswith("&#") or cleaned.startswith("\\u"):
        return False
    # Private-use font glyphs used as icon "text"
    if cleaned and ord(cleaned[0]) >= 0xE000:
        return False
    if " " in cleaned:
        return False
    if cleaned.isdigit():
        return False
    # Reject ALL-CAPS tickers (BTC, DASH, …)
    if cleaned.isupper() and len(cleaned) <= 6:
        return False
    if not re.match(r"^[A-Za-z][A-Za-z0-9._-]*$", cleaned):
        return False
    # Wallet nicknames like "MyBitcoin" are rare; Edge local users usually
    # contain a digit, underscore, or hyphen (edge-foo, davidtest482a).
    if re.search(r"[\d_-]", cleaned):
        return True
    return len(cleaned) >= 8 and cleaned.lower() == cleaned


def _unique_usernames(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not _looks_like_username(value):
            continue
        key = value.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(value.strip())
    return out


def _parse_nodes(xml: str) -> list[dict]:
    nodes: list[dict] = []
    for match in re.finditer(r"<node\b[^>]*>", xml):
        tag = match.group(0)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        rid = re.search(r'resource-id="([^"]*)"', tag)
        text = re.search(r'text="([^"]*)"', tag)
        desc = re.search(r'content-desc="([^"]*)"', tag)
        nodes.append(
            {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "cx": (x1 + x2) // 2,
                "cy": (y1 + y2) // 2,
                "rid": rid.group(1) if rid else "",
                "text": text.group(1) if text else "",
                "desc": desc.group(1) if desc else "",
            }
        )
    return nodes


def _is_login_ui(xml: str) -> bool:
    return any(
        marker in xml
        for marker in (
            "edge: login-scene",
            "login-scene",
            "usernameFormField",
            "passwordFormField",
            "Exit PIN",
            "usernameDropdownButton",
            "userDropdownIcon",
        )
    )


def _is_side_menu_open(xml: str) -> bool:
    return "downArrow" in xml or ("Logout" in xml and "sideMenuClose" in xml) or (
        "Logout" in xml and "Settings" in xml and "Notifications" in xml
    )


def _is_logged_in_home(xml: str) -> bool:
    if _is_login_ui(xml) or _is_side_menu_open(xml):
        return False
    # Wallets / Assets home (must NOT scrape tickers as accounts)
    return ("Wallets" in xml or "Assets" in xml) and (
        "Total Balance" in xml or "Home" in xml or "Exchange" in xml
    )


def _display_size(serial: str) -> tuple[int, int]:
    _, out = _run(["adb", "-s", serial, "shell", "wm", "size"], timeout=5)
    match = re.search(r"(\d+)\s*x\s*(\d+)", out)
    if match:
        return int(match.group(1)), int(match.group(2))
    return 1080, 2400


def _open_side_menu(serial: str, xml: str | None = None) -> str:
    """Open Edge SideMenu (account switcher). Header button is headerRight."""
    current = xml if xml is not None else _ui_dump(serial)
    if _is_side_menu_open(current):
        return current
    if _tap_id(serial, "sideMenuButton", current):
        time.sleep(0.9)
        return _ui_dump(serial)

    # testID often missing from a11y tree — tap headerRight hamburger area.
    width, height = _display_size(serial)
    for x_ratio, y_ratio in ((0.93, 0.048), (0.90, 0.055), (0.95, 0.045)):
        _tap(serial, int(width * x_ratio), int(height * y_ratio))
        time.sleep(0.85)
        current = _ui_dump(serial)
        if _is_side_menu_open(current):
            return current
        _run(["adb", "-s", serial, "shell", "input", "keyevent", "4"], timeout=3)
        time.sleep(0.3)
    return current


def _close_side_menu(serial: str) -> None:
    _run(["adb", "-s", serial, "shell", "input", "keyevent", "4"], timeout=3)
    time.sleep(0.35)


def _usernames_from_down_arrow(xml: str) -> list[str]:
    """Current account is exposed on downArrow content-desc (e.g. '…, davidtest482a, …')."""
    found: list[str] = []
    for node in _parse_nodes(xml):
        if not _rid_matches(node["rid"], "downArrow"):
            continue
        for part in re.split(r"\s*,\s*", node["desc"]):
            if _looks_like_username(part):
                found.append(part.strip())
        if _looks_like_username(node["text"]):
            found.append(node["text"].strip())
    return found


def _usernames_beside_sidemenu_close(xml: str) -> list[str]:
    """Other local users sit on the same row as sideMenuClose (forget) buttons."""
    nodes = _parse_nodes(xml)
    closes = [n for n in nodes if _rid_matches(n["rid"], "sideMenuClose")]
    if not closes:
        return []
    found: list[str] = []
    for node in nodes:
        text = node["text"].strip()
        if not _looks_like_username(text):
            continue
        for close in closes:
            if abs(node["cy"] - close["cy"]) <= 90 and node["x2"] <= close["x1"] + 20:
                found.append(text)
                break
    return found


def _usernames_from_delete_icons(xml: str) -> list[str]:
    """Login UI UserListItem testIDs: `{username}.deleteIcon`."""
    found: list[str] = []
    for rid in re.findall(r'resource-id="([^"]+\.deleteIcon)"', xml):
        name = rid.rsplit("/", 1)[-1]
        if name.endswith(".deleteIcon"):
            name = name[: -len(".deleteIcon")]
        if _looks_like_username(name):
            found.append(name)
    return found


def _discover_from_side_menu(serial: str, xml: str) -> list[str]:
    menu = _open_side_menu(serial, xml)
    users = _usernames_from_down_arrow(menu)

    # Expand local-user dropdown when multiple accounts exist.
    if _tap_id(serial, "downArrow", menu):
        time.sleep(0.7)
        menu = _ui_dump(serial)
        users.extend(_usernames_from_down_arrow(menu))
        users.extend(_usernames_beside_sidemenu_close(menu))

    _close_side_menu(serial)
    return _unique_usernames(users)


def _discover_from_login_ui(serial: str, xml: str) -> list[str]:
    users = _usernames_from_delete_icons(xml)
    users.extend(_usernames_from_down_arrow(xml))

    # PIN scene: open username chip dropdown.
    if "Exit PIN" in xml or "usernameDropdownButton" in xml:
        if _tap_id(serial, "usernameDropdownButton", xml):
            time.sleep(0.7)
            opened = _ui_dump(serial)
            users.extend(_usernames_from_delete_icons(opened))
            for text in re.findall(r'text="([^"]+)"', opened):
                if _looks_like_username(text):
                    users.append(text)
            # Collapse / leave list as-is (PIN still usable)

    # Password scene: open saved-users chevron.
    if "userDropdownIcon" in xml or "usernameFormField" in xml:
        current = _ui_dump(serial)
        if _tap_id(serial, "userDropdownIcon", current):
            time.sleep(0.7)
            opened = _ui_dump(serial)
            users.extend(_usernames_from_delete_icons(opened))
            for text in re.findall(r'text="([^"]+)"', opened):
                if _looks_like_username(text):
                    users.append(text)

    # Visible username chip on PIN without opening dropdown
    if "Exit PIN" in xml:
        for text in re.findall(r'text="([^"]+)"', xml):
            if _looks_like_username(text):
                users.append(text)

    return _unique_usernames(users)


def discover_device_usernames(serial: str) -> list[str]:
    """List Edge localUsers via SideMenu (logged-in) or PIN/password login UI.

    Never scrapes the wallets/Assets home — that previously mis-read BTC/BCH as accounts.
    """
    xml = _ui_dump(serial)
    if not xml:
        return []

    if _is_login_ui(xml):
        return _discover_from_login_ui(serial, xml)

    if _is_side_menu_open(xml) or _is_logged_in_home(xml):
        return _discover_from_side_menu(serial, xml)

    # Unknown screen — do not guess from random text nodes.
    return []


def list_edge_accounts(device_ids: list[str] | None = None) -> dict:
    try:
        saved = {item.username: item for item in list_saved_accounts()}
    except PermissionError:
        saved = {}
    device_users: set[str] = set()
    devices = _resolve_targets(device_ids, android_only=True)
    for device in devices:
        names = discover_device_usernames(device.id)
        if not names:
            start_app_on_device(device, "edge")
            time.sleep(1.8)
            names = discover_device_usernames(device.id)
        for name in names:
            device_users.add(name)

    usernames = sorted(set(saved) | device_users, key=str.lower)
    accounts = [
        EdgeAccountInfo(
            username=name,
            on_device=name in device_users,
            in_vault=name in saved,
            has_password=bool(saved[name].has_password) if name in saved else False,
            has_pin=bool(saved[name].has_pin) if name in saved else False,
        ).to_dict()
        for name in usernames
    ]
    return {
        "accounts": accounts,
        "vault": vault_info(),
    }


def _ensure_password_login_form(serial: str) -> str:
    xml = _ui_dump(serial)
    if _is_logged_in_home(xml) or _is_side_menu_open(xml):
        menu = _open_side_menu(serial, xml)
        if _tap_text(serial, "Logout", menu):
            time.sleep(1.5)
        xml = _wait_login_ui(serial)

    xml = _wait_login_ui(serial) if not _is_login_ui(xml) else xml
    if "Exit PIN" in xml:
        _tap_text(serial, "Exit PIN", xml)
        time.sleep(1.0)
        xml = _wait_login_ui(serial)
    # Some builds show "Already have an account? Sign in"
    if "Already have an account" in xml or "Sign in" in xml:
        if _tap_text(serial, "Already have an account? Sign in", xml) or _tap_text(serial, "Sign in", xml):
            time.sleep(1.0)
            xml = _wait_login_ui(serial)
    return xml


def _fill_login(serial: str, username: str, password: str) -> None:
    xml = _ensure_password_login_form(serial)
    if not _tap_id(serial, "usernameFormField.textInput", xml) and not _tap_id(serial, "usernameFormField", xml):
        raise RuntimeError("Username field not found on Edge login screen")
    time.sleep(0.2)
    _clear_field(serial)
    if not _adb_type(serial, username):
        raise RuntimeError("Failed to type username")
    time.sleep(0.2)

    xml = _ui_dump(serial)
    if not _tap_id(serial, "passwordFormField.textInput", xml) and not _tap_id(serial, "passwordFormField", xml):
        raise RuntimeError("Password field not found on Edge login screen")
    time.sleep(0.2)
    _clear_field(serial)
    if not _adb_type(serial, password):
        raise RuntimeError("Failed to type password")
    time.sleep(0.2)

    xml = _ui_dump(serial)
    if not _tap_text(serial, "Login", xml):
        # Enter key as fallback
        _run(["adb", "-s", serial, "shell", "input", "keyevent", "66"], timeout=3)


def _wait_pin_ui(serial: str, timeout: float = 12.0) -> str:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        last = _ui_dump(serial)
        if "Exit PIN" in last:
            return last
        time.sleep(0.45)
    return last


def _enter_pin(serial: str, pin: str) -> None:
    """Tap Edge PIN keypad digits (content-desc on clickable keys)."""
    digits = [ch for ch in pin.strip() if ch.isdigit()]
    if len(digits) < 4:
        raise RuntimeError("PIN must be at least 4 digits")
    for digit in digits:
        xml = _ui_dump(serial)
        if not _tap_desc(serial, digit, xml, clickable_only=True):
            # Fallback: clickable node whose text is the digit
            point = _find_node(xml, text=digit, clickable_only=True) or _find_node(xml, text=digit)
            if not point:
                raise RuntimeError(f"PIN keypad digit {digit} not found")
            _tap(serial, *point)
        time.sleep(0.18)


def _switch_via_side_menu(serial: str, username: str) -> str | None:
    """If already logged in, switch account from SideMenu dropdown (logout + nextLoginId)."""
    xml = _ui_dump(serial)
    if not (_is_logged_in_home(xml) or _is_side_menu_open(xml)):
        return None
    menu = _open_side_menu(serial, xml)
    current = _usernames_from_down_arrow(menu)
    if any(u.lower() == username.lower() for u in current) and "sideMenuClose" not in menu:
        # Already on this user and no other rows — nothing to switch.
        _close_side_menu(serial)
        return f"Already on {username}"

    if _tap_id(serial, "downArrow", menu):
        time.sleep(0.7)
        menu = _ui_dump(serial)

    if _tap_text(serial, username, menu):
        time.sleep(1.2)
        return f"Switching to {username}"

    _close_side_menu(serial)
    return None


def _select_local_user(serial: str, username: str) -> str:
    """Bring Edge to the given local user (SideMenu switch or PIN/password list)."""
    switched = _switch_via_side_menu(serial, username)
    if switched:
        return switched

    xml = _wait_login_ui(serial)
    if "Exit PIN" in xml:
        chip_users = [
            t for t in re.findall(r'text="([^"]+)"', xml) if _looks_like_username(t)
        ]
        current_chip = chip_users[0] if chip_users else ""
        dropdown_open = any(
            rid.endswith(".deleteIcon") for rid in re.findall(r'resource-id="([^"]+)"', xml)
        ) or len(chip_users) > 1

        if (
            current_chip.lower() == username.lower()
            and not dropdown_open
            and username.lower() in {u.lower() for u in chip_users}
        ):
            return f"Edge ready for {username} (PIN)"

        if dropdown_open and _tap_text(serial, username, xml):
            time.sleep(1.0)
            return f"Selected {username} on PIN screen"

        if _tap_id(serial, "usernameDropdownButton", xml) or (
            current_chip and _tap_text(serial, current_chip, xml)
        ):
            time.sleep(0.7)
            opened = _ui_dump(serial)
            if _tap_text(serial, username, opened):
                time.sleep(1.0)
                return f"Selected {username} on PIN screen"

        if _tap_text(serial, username, xml):
            time.sleep(1.0)
            return f"Selected {username} on PIN screen"

    xml = _ui_dump(serial)
    if _tap_id(serial, "usernameDropdownButton", xml) or _tap_id(serial, "userDropdownIcon", xml):
        time.sleep(0.8)
        xml = _ui_dump(serial)
        if _tap_text(serial, username, xml):
            time.sleep(1.0)
            return f"Selected {username} on device"

    if username in xml and _tap_text(serial, username, xml):
        return f"Selected {username} on device"

    return f"Opened Edge — select {username} manually if needed"


def start_edge_account_on_device(
    device: DeviceInfo,
    username: str,
    password: str | None,
    pin: str | None = None,
    *,
    app: AppKey = "edge",
) -> ActionResult:
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")

    user = username.strip()
    if not user:
        return ActionResult(device.id, device.name, False, "Username required")

    launch = start_app_on_device(device, app)
    if not launch.ok:
        return launch
    time.sleep(1.5)

    try:
        xml = _ui_dump(device.id)
        prefer_local = bool(pin) or "Exit PIN" in xml or _is_logged_in_home(xml) or _is_side_menu_open(xml)

        if prefer_local:
            detail = _select_local_user(device.id, user)
            xml = _ui_dump(device.id)
            if pin:
                if "Exit PIN" not in xml:
                    xml = _wait_pin_ui(device.id)
                if "Exit PIN" not in xml:
                    # Password form after switch? Prefer PIN path — try Exit PIN reverse N/A
                    if password and ("passwordFormField" in xml or "usernameFormField" in xml):
                        _fill_login(device.id, user, password)
                        return ActionResult(
                            device.id,
                            device.name,
                            True,
                            f"Submitted password login for {user} (PIN screen unavailable)",
                        )
                    return ActionResult(
                        device.id,
                        device.name,
                        False,
                        f"{detail}; PIN screen not shown",
                    )
                _enter_pin(device.id, pin)
                return ActionResult(device.id, device.name, True, f"Selected {user} and entered PIN")
            if "Exit PIN" in xml:
                return ActionResult(
                    device.id,
                    device.name,
                    False,
                    f"{detail}; save a PIN in the vault to auto-login",
                )
            if password:
                _fill_login(device.id, user, password)
                return ActionResult(device.id, device.name, True, f"Submitted login for {user}")
            return ActionResult(device.id, device.name, True, detail)

        if password:
            _fill_login(device.id, user, password)
            return ActionResult(device.id, device.name, True, f"Submitted login for {user}")

        if pin:
            detail = _select_local_user(device.id, user)
            xml = _wait_pin_ui(device.id)
            if "Exit PIN" not in xml:
                return ActionResult(device.id, device.name, False, f"{detail}; PIN screen not shown")
            _enter_pin(device.id, pin)
            return ActionResult(device.id, device.name, True, f"Selected {user} and entered PIN")

        detail = _select_local_user(device.id, user)
        return ActionResult(
            device.id,
            device.name,
            False,
            f"{detail}; no PIN or password in vault",
        )
    except Exception as exc:  # noqa: BLE001 — surface to UI
        return ActionResult(device.id, device.name, False, str(exc))


def run_start_edge_account(
    username: str,
    device_ids: list[str] | None = None,
    *,
    password: str | None = None,
    pin: str | None = None,
    save: bool = False,
    app: AppKey = "edge",
) -> list[ActionResult]:
    user = username.strip()
    secret = password
    secret_pin = pin
    try:
        if secret is None:
            secret = get_password(user)
        if secret_pin is None:
            secret_pin = get_pin(user)
    except PermissionError as exc:
        return [
            ActionResult(d.id, d.name, False, str(exc) or "Unlock vault in Settings")
            for d in _resolve_targets(device_ids, android_only=True)
        ] or [
            ActionResult("", "", False, "Unlock vault in Settings"),
        ]
    if save and (password or pin):
        save_account(user, password=password, pin=pin)

    targets = _resolve_targets(device_ids, android_only=True)
    return [
        start_edge_account_on_device(device, user, secret, secret_pin, app=app)
        for device in targets
    ]


async def list_edge_accounts_async(device_ids: list[str] | None = None) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, list_edge_accounts, device_ids)


async def start_edge_account_async(
    username: str,
    device_ids: list[str] | None = None,
    *,
    password: str | None = None,
    pin: str | None = None,
    save: bool = False,
    app: AppKey = "edge",
) -> list[ActionResult]:
    loop = asyncio.get_running_loop()

    def _run_one() -> list[ActionResult]:
        return run_start_edge_account(
            username,
            device_ids,
            password=password,
            pin=pin,
            save=save,
            app=app,
        )

    return await loop.run_in_executor(None, _run_one)


async def save_edge_account_async(
    username: str,
    password: str | None = None,
    pin: str | None = None,
) -> dict:
    loop = asyncio.get_running_loop()

    def _run_one() -> dict:
        account = save_account(username, password=password, pin=pin)
        return account.to_dict()

    return await loop.run_in_executor(None, _run_one)


def _confirm_forget_modal(serial: str, timeout: float = 6.0) -> bool:
    """Confirm Edge 'Forget Account' modal (tap Forget, not Cancel)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        xml = _ui_dump(serial)
        if "Forget Account" in xml or ("Forget" in xml and "Cancel" in xml):
            if _tap_text(serial, "Forget", xml):
                time.sleep(1.0)
                return True
        time.sleep(0.35)
    return False


def _tap_sidemenu_forget_for_user(serial: str, username: str, xml: str) -> bool:
    """Tap sideMenuClose (X) on the row matching username in the SideMenu dropdown."""
    target = username.strip().lower()
    nodes = _parse_nodes(xml)
    closes = [n for n in nodes if _rid_matches(n["rid"], "sideMenuClose")]
    users = [n for n in nodes if n["text"].strip().lower() == target]
    for user in users:
        for close in closes:
            if abs(user["cy"] - close["cy"]) <= 90 and user["x2"] <= close["x1"] + 40:
                _tap(serial, close["cx"], close["cy"])
                return True
    return False


def _forget_via_login_ui(serial: str, username: str) -> str | None:
    """Forget a local user from PIN / password login dropdown ({user}.deleteIcon)."""
    user = username.strip()
    xml = _ui_dump(serial)
    if not _is_login_ui(xml):
        xml = _wait_login_ui(serial, timeout=12.0)
    if not _is_login_ui(xml):
        return None

    # Open the local-users list if delete icons are not visible yet.
    if f"{user}.deleteIcon" not in xml and not any(
        rid.endswith(".deleteIcon") for rid in re.findall(r'resource-id="([^"]+)"', xml)
    ):
        if "Exit PIN" in xml or "usernameDropdownButton" in xml:
            _tap_id(serial, "usernameDropdownButton", xml) or _tap_text(serial, user, xml)
            time.sleep(0.7)
            xml = _ui_dump(serial)
        if "userDropdownIcon" in xml or "usernameFormField" in xml:
            if _tap_id(serial, "userDropdownIcon", xml):
                time.sleep(0.7)
                xml = _ui_dump(serial)

    delete_id = f"{user}.deleteIcon"
    if not _tap_id(serial, delete_id, xml):
        # Case-insensitive fallback on resource-id suffix.
        tapped = False
        for rid in re.findall(r'resource-id="([^"]+\.deleteIcon)"', xml):
            short = rid.rsplit("/", 1)[-1]
            name = short[: -len(".deleteIcon")]
            if name.lower() == user.lower() and _tap_id(serial, short, xml):
                tapped = True
                break
        if not tapped:
            return None

    if not _confirm_forget_modal(serial):
        return "Opened forget dialog but could not confirm"
    return f"Forgot {user} from Edge login list"


def _forget_via_side_menu(serial: str, username: str, xml: str) -> str | None:
    """Forget an inactive local user from SideMenu account dropdown."""
    user = username.strip()
    menu = _open_side_menu(serial, xml)
    current = _usernames_from_down_arrow(menu)
    is_current = any(name.lower() == user.lower() for name in current)

    if _tap_id(serial, "downArrow", menu):
        time.sleep(0.7)
        menu = _ui_dump(serial)

    if _tap_sidemenu_forget_for_user(serial, user, menu):
        if _confirm_forget_modal(serial):
            _close_side_menu(serial)
            return f"Forgot {user} from Edge SideMenu"
        return "Opened forget dialog but could not confirm"

    if is_current:
        # Active user is not listed in the dropdown — logout, then forget from login UI.
        if _tap_text(serial, "Logout", menu) or _tap_text(serial, "Logout", _ui_dump(serial)):
            time.sleep(1.5)
            detail = _forget_via_login_ui(serial, user)
            return detail or f"Logged out; {user} not found on login list to forget"
        return f"{user} is current account but Logout control not found"

    _close_side_menu(serial)
    return None


def forget_edge_account_on_device(device: DeviceInfo, username: str) -> ActionResult:
    """Remove a local Edge user from the device (Forget Account), Android only."""
    if device.platform != "android":
        return ActionResult(device.id, device.name, False, "Android only")
    user = username.strip()
    if not user:
        return ActionResult(device.id, device.name, False, "Username required")

    launch = start_app_on_device(device, "edge")
    if not launch.ok:
        return launch
    time.sleep(1.4)

    try:
        xml = _ui_dump(device.id)
        if _is_login_ui(xml):
            detail = _forget_via_login_ui(device.id, user)
        elif _is_side_menu_open(xml) or _is_logged_in_home(xml):
            detail = _forget_via_side_menu(device.id, user, xml)
            if detail is None:
                # Maybe already on login after a partial flow
                detail = _forget_via_login_ui(device.id, user)
        else:
            # Unknown screen — try login path after bringing Edge forward again
            detail = _forget_via_login_ui(device.id, user)

        if detail and "could not confirm" in detail:
            return ActionResult(device.id, device.name, False, detail)
        if detail:
            return ActionResult(device.id, device.name, True, detail)
        return ActionResult(
            device.id,
            device.name,
            True,
            f"{user} not on device login list (vault-only remove)",
        )
    except Exception as exc:  # noqa: BLE001
        return ActionResult(device.id, device.name, False, str(exc))


def run_forget_edge_account(
    username: str,
    device_ids: list[str] | None = None,
) -> list[ActionResult]:
    targets = _resolve_targets(device_ids, android_only=True)
    return [forget_edge_account_on_device(device, username) for device in targets]


def delete_edge_account(
    username: str,
    device_ids: list[str] | None = None,
    *,
    forget_on_device: bool = True,
) -> dict:
    """Delete from encrypted vault and optionally Forget on connected Android devices."""
    deleted_vault = delete_account(username)
    device_results: list[ActionResult] = []
    if forget_on_device:
        device_results = run_forget_edge_account(username, device_ids)
    return {
        "deleted": deleted_vault,
        "username": username.strip(),
        "deviceResults": [item.to_dict() for item in device_results],
    }


async def delete_edge_account_async(
    username: str,
    device_ids: list[str] | None = None,
    *,
    forget_on_device: bool = True,
) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        lambda: delete_edge_account(
            username,
            device_ids,
            forget_on_device=forget_on_device,
        ),
    )
