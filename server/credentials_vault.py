"""Local encrypted credential vault for QA Dashboard.

Credentials never leave this machine. Fernet at rest; optional master password
(PBKDF2) or machine key file. API callers only ever see usernames.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from .settings_store import DEFAULT_VAULT_PATH, load_settings, save_settings

VAULT_DIR = Path.home() / ".config" / "qa-dashboard"
KEY_PATH = VAULT_DIR / "credentials.key"
DEFAULT_VAULT = Path(DEFAULT_VAULT_PATH)
PBKDF2_ITERATIONS = 390_000

# In-process unlock after Settings master-password entry (never written to disk).
_unlocked_master: str | None = None


@dataclass(slots=True)
class SavedAccount:
    username: str
    updated_at: str
    has_password: bool = False
    has_pin: bool = False

    def to_dict(self) -> dict:
        return {
            "username": self.username,
            "updatedAt": self.updated_at,
            "hasPassword": self.has_password,
            "hasPin": self.has_pin,
            "hasCredentials": self.has_password or self.has_pin,
            "source": "vault",
        }


def _ensure_dir(path: Path | None = None) -> None:
    target = path.parent if path is not None else VAULT_DIR
    target.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(target if path is None else VAULT_DIR, 0o700)
    except OSError:
        pass


def vault_path() -> Path:
    settings = load_settings()
    raw = settings.get("vaultPath") or DEFAULT_VAULT_PATH
    return Path(str(raw)).expanduser()


def salt_path(vault: Path | None = None) -> Path:
    path = vault or vault_path()
    return path.with_suffix(path.suffix + ".salt") if path.suffix else Path(str(path) + ".salt")


def has_master_password(vault: Path | None = None) -> bool:
    return salt_path(vault).exists()


def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))


def _load_machine_fernet() -> Fernet:
    _ensure_dir()
    if KEY_PATH.exists():
        key = KEY_PATH.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        KEY_PATH.write_bytes(key + b"\n")
        os.chmod(KEY_PATH, 0o600)
    return Fernet(key)


def _load_fernet(master_password: str | None = None, vault: Path | None = None) -> Fernet:
    path = vault or vault_path()
    salt_file = salt_path(path)
    if salt_file.exists():
        if not master_password:
            raise PermissionError("Master password required to unlock vault")
        salt = salt_file.read_bytes()
        return Fernet(_derive_key(master_password, salt))
    return _load_machine_fernet()


def _read_payload(master_password: str | None = None, vault: Path | None = None) -> dict:
    path = vault or vault_path()
    if not path.exists():
        return {"version": 1, "accounts": {}}
    fernet = _load_fernet(master_password, path)
    try:
        raw = fernet.decrypt(path.read_bytes())
        data = json.loads(raw.decode("utf-8"))
    except (InvalidToken, json.JSONDecodeError, OSError) as exc:
        if salt_path(path).exists():
            raise PermissionError("Invalid master password or corrupt vault") from exc
        return {"version": 1, "accounts": {}}
    if not isinstance(data, dict):
        return {"version": 1, "accounts": {}}
    accounts = data.get("accounts")
    if not isinstance(accounts, dict):
        data["accounts"] = {}
    return data


def _write_payload(
    data: dict,
    master_password: str | None = None,
    vault: Path | None = None,
) -> None:
    path = vault or vault_path()
    _ensure_dir(path)
    fernet = _load_fernet(master_password, path)
    blob = fernet.encrypt(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    tmp = path.with_suffix(path.suffix + ".tmp") if path.suffix else Path(str(path) + ".tmp")
    tmp.write_bytes(blob)
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    os.chmod(path, 0o600)


def unlock_vault(password: str) -> bool:
    """Validate master password and keep it in memory for this server process."""
    global _unlocked_master
    path = vault_path()
    if not has_master_password(path):
        _unlocked_master = None
        return True
    _read_payload(password, path)
    _unlocked_master = password
    return True


def lock_vault() -> None:
    global _unlocked_master
    _unlocked_master = None


def _effective_master(explicit: str | None = None) -> str | None:
    if explicit is not None:
        return explicit
    if has_master_password():
        return _unlocked_master
    return None


def list_saved_accounts(master_password: str | None = None) -> list[SavedAccount]:
    data = _read_payload(_effective_master(master_password))
    items: list[SavedAccount] = []
    for username, meta in (data.get("accounts") or {}).items():
        if not isinstance(username, str) or not username.strip():
            continue
        updated = ""
        has_password = False
        has_pin = False
        if isinstance(meta, dict):
            updated = str(meta.get("updatedAt") or "")
            pwd = meta.get("password")
            pin = meta.get("pin")
            has_password = isinstance(pwd, str) and bool(pwd)
            has_pin = isinstance(pin, str) and bool(pin)
        items.append(
            SavedAccount(
                username=username.strip(),
                updated_at=updated,
                has_password=has_password,
                has_pin=has_pin,
            )
        )
    items.sort(key=lambda item: item.username.lower())
    return items


def _normalize_pin(pin: str | None) -> str | None:
    if pin is None:
        return None
    cleaned = pin.strip()
    if not cleaned:
        return ""
    if not cleaned.isdigit() or not (4 <= len(cleaned) <= 8):
        raise ValueError("PIN must be 4–8 digits")
    return cleaned


def save_account(
    username: str,
    password: str | None = None,
    pin: str | None = None,
    master_password: str | None = None,
) -> SavedAccount:
    """Save password and/or PIN. Omitting a field leaves the existing value unchanged."""
    user = username.strip()
    if not user:
        raise ValueError("Username required")
    pin_norm = _normalize_pin(pin)
    pwd = password.strip() if isinstance(password, str) else password
    if pwd is not None:
        pwd = pwd.strip()
    data = _read_payload(_effective_master(master_password))
    accounts = data.setdefault("accounts", {})
    existing = accounts.get(user) if isinstance(accounts.get(user), dict) else {}
    entry: dict = dict(existing) if isinstance(existing, dict) else {}

    if pwd:
        entry["password"] = pwd
    if pin_norm is not None:
        if pin_norm == "":
            entry.pop("pin", None)
        else:
            entry["pin"] = pin_norm

    has_password = isinstance(entry.get("password"), str) and bool(entry.get("password"))
    has_pin = isinstance(entry.get("pin"), str) and bool(entry.get("pin"))
    if not has_password and not has_pin:
        raise ValueError("Password or PIN required")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry["updatedAt"] = now
    accounts[user] = entry
    _write_payload(data, _effective_master(master_password))
    return SavedAccount(
        username=user,
        updated_at=now,
        has_password=has_password,
        has_pin=has_pin,
    )


def delete_account(username: str, master_password: str | None = None) -> bool:
    user = username.strip()
    data = _read_payload(_effective_master(master_password))
    accounts = data.get("accounts") or {}
    if user not in accounts:
        return False
    del accounts[user]
    _write_payload(data, _effective_master(master_password))
    return True


def get_password(username: str, master_password: str | None = None) -> str | None:
    """Decrypt password for in-process use only. Never expose via API responses."""
    user = username.strip()
    data = _read_payload(_effective_master(master_password))
    meta = (data.get("accounts") or {}).get(user)
    if not isinstance(meta, dict):
        return None
    password = meta.get("password")
    return password if isinstance(password, str) and password else None


def get_pin(username: str, master_password: str | None = None) -> str | None:
    """Decrypt PIN for in-process use only. Never expose via API responses."""
    user = username.strip()
    data = _read_payload(_effective_master(master_password))
    meta = (data.get("accounts") or {}).get(user)
    if not isinstance(meta, dict):
        return None
    pin = meta.get("pin")
    return pin if isinstance(pin, str) and pin else None


def set_vault_path(new_path: str, master_password: str | None = None) -> Path:
    """Point settings at a new vault file; migrate existing blob if present."""
    dest = Path(new_path).expanduser()
    if not dest.is_absolute():
        dest = (Path.home() / dest).resolve()
    else:
        dest = dest.resolve()
    src = vault_path()
    if src.resolve() != dest:
        _ensure_dir(dest)
        if src.exists() and not dest.exists():
            dest.write_bytes(src.read_bytes())
            os.chmod(dest, 0o600)
            src_salt = salt_path(src)
            if src_salt.exists():
                dest_salt = salt_path(dest)
                dest_salt.write_bytes(src_salt.read_bytes())
                os.chmod(dest_salt, 0o600)
        # Touch empty vault if neither exists
        if not dest.exists():
            _write_payload({"version": 1, "accounts": {}}, master_password, dest)
    save_settings({"vaultPath": str(dest)})
    return dest


def change_master_password(
    current_password: str | None,
    new_password: str | None,
) -> dict:
    """Set, change, or clear master password. Empty new_password clears it (machine key)."""
    global _unlocked_master
    path = vault_path()
    using_master = has_master_password(path)
    if using_master and not current_password:
        raise ValueError("Current master password required")

    data = _read_payload(current_password if using_master else None, path)

    salt_file = salt_path(path)
    if new_password:
        salt = os.urandom(16)
        _ensure_dir(path)
        salt_file.write_bytes(salt)
        os.chmod(salt_file, 0o600)
        fernet = Fernet(_derive_key(new_password, salt))
        blob = fernet.encrypt(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        tmp = path.with_suffix(path.suffix + ".tmp") if path.suffix else Path(str(path) + ".tmp")
        tmp.write_bytes(blob)
        os.chmod(tmp, 0o600)
        tmp.replace(path)
        os.chmod(path, 0o600)
        _unlocked_master = new_password
    else:
        if salt_file.exists():
            salt_file.unlink()
        _write_payload(data, None, path)
        _unlocked_master = None

    return vault_info()


def vault_info() -> dict:
    path = vault_path()
    locked = has_master_password(path) and _unlocked_master is None
    return {
        "path": str(path),
        "encryption": "Fernet (AES-128 + HMAC)"
        + (" · master password" if has_master_password(path) else " · machine key"),
        "hasMasterPassword": has_master_password(path),
        "unlocked": not locked,
        "onlineSharing": False,
        "plaintextOnDisk": False,
    }
