import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  deleteEdgeAccount,
  listEdgeAccounts,
  type EdgeAccount,
} from "../api/actions";
import { useDialogModal } from "../hooks/useDialogModal";

interface EdgeAccountModalProps {
  busy?: boolean;
  deviceIds?: string[];
  onConfirm: (opts: {
    username: string;
    password?: string;
    pin?: string;
    save: boolean;
  }) => void;
  onClose: () => void;
}

type Mode = "pick" | "new" | "need-pin";

export function EdgeAccountModal({
  busy = false,
  deviceIds,
  onConfirm,
  onClose,
}: EdgeAccountModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  useDialogModal(dialogRef, onClose);

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<EdgeAccount[]>([]);
  const [vaultNote, setVaultNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("pick");
  const [selected, setSelected] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [saveCreds, setSaveCreds] = useState(true);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await listEdgeAccounts(deviceIds);
      setAccounts(payload.accounts);
      const vault = payload.vault;
      setVaultNote(
        vault
          ? `Saved locally · ${vault.encryption} · never shared online`
          : "Credentials stay on this PC, encrypted, never shared online",
      );
      if (payload.accounts.length) {
        setMode((prev) => (prev === "new" ? "new" : "pick"));
        setSelected((prev) => prev ?? payload.accounts[0].username);
      } else {
        setMode("new");
        setSelected(null);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load accounts");
      setMode("new");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reload();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per device set
  }, [deviceIds?.join(",")]);

  useEffect(() => {
    if (busy || loading) return;
    if (mode === "new") {
      window.setTimeout(() => userRef.current?.focus(), 0);
    } else if (mode === "need-pin") {
      window.setTimeout(() => pinRef.current?.focus(), 0);
    }
  }, [mode, loading, busy]);

  const accountLabel = (account: EdgeAccount) => {
    if (busy && mode !== "new" && selected === account.username) {
      return "Starting on device…";
    }
    if (account.onDevice && account.hasPin) {
      return "On device · select + PIN from vault";
    }
    if (account.onDevice && account.hasPassword) {
      return "On device · will login with saved password (add PIN for faster re-login)";
    }
    if (account.onDevice) {
      return "On device · needs PIN in vault";
    }
    if (account.hasPin && account.hasPassword) {
      return "Saved PIN + password";
    }
    if (account.hasPin) {
      return "Saved PIN · auto-login";
    }
    if (account.hasPassword) {
      return "Saved password · auto-login";
    }
    return "Saved locally";
  };

  const startPicked = (account: EdgeAccount) => {
    if (busy || loading) return;
    setSelected(account.username);
    setPassword("");
    if (account.onDevice && !account.hasPin) {
      setMode("need-pin");
      setPin("");
      setSaveCreds(true);
      return;
    }
    setMode("pick");
    setPin("");
    onConfirm({
      username: account.username,
      password: undefined,
      pin: undefined,
      save: false,
    });
  };

  const removeSaved = async (usernameToDelete: string) => {
    if (busy) return;
    try {
      await deleteEdgeAccount(usernameToDelete, deviceIds);
      await reload();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const openAnotherAccount = () => {
    setMode("new");
    setSelected(null);
    setUsername("");
    setPassword("");
    setPin("");
  };

  const backFromForm = () => {
    if (accounts.length) {
      setMode("pick");
      setSelected(accounts[0]?.username ?? null);
      setUsername("");
      setPassword("");
      setPin("");
      return;
    }
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || loading) return;
    if (mode === "pick" && selected) {
      const account = accounts.find((item) => item.username === selected);
      if (account) {
        startPicked(account);
      }
      return;
    }
    if (mode === "need-pin" && selected) {
      const value = pin.trim();
      if (!/^\d{4,8}$/.test(value)) return;
      onConfirm({
        username: selected,
        pin: value,
        save: saveCreds,
      });
      return;
    }
    const user = username.trim();
    const pinValue = pin.trim();
    if (!user) return;
    if (!password && !/^\d{4,8}$/.test(pinValue)) return;
    onConfirm({
      username: user,
      password: password || undefined,
      pin: /^\d{4,8}$/.test(pinValue) ? pinValue : undefined,
      save: saveCreds,
    });
  };

  const canSubmit =
    mode === "pick"
      ? Boolean(selected)
      : mode === "need-pin"
        ? /^\d{4,8}$/.test(pin.trim())
        : Boolean(username.trim() && (password || /^\d{4,8}$/.test(pin.trim())));

  const showAccounts = !loading && mode === "pick" && accounts.length > 0;
  const showCredentialForm = !loading && mode === "new";
  const showNeedPin = !loading && mode === "need-pin";

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <form className="device-picker__panel" onSubmit={submit}>
        <header>
          <h3>Start Edge account</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </header>

        <p className="picker-empty" style={{ marginBottom: loading ? "0" : "0.65rem" }}>
          {loading
            ? "Scanning device login screen and local vault…"
            : busy && selected
              ? `Starting ${selected}…`
              : mode === "need-pin"
                ? `Enter the PIN for ${selected} (saved encrypted on this PC).`
                : mode === "new"
                  ? "Enter credentials for another account."
                  : "Pick a logged-in / saved account, or enter credentials for another."}
        </p>
        {!loading && vaultNote ? <p className="edge-vault-note">{vaultNote}</p> : null}

        {loadError ? <p className="picker-empty">{loadError}</p> : null}

        {showAccounts ? (
          <>
            <p className="modal-field__label" style={{ marginBottom: "0.45rem" }}>
              Accounts
            </p>
            <ul className="picker-list airplane-targets app-pick-list" style={{ marginBottom: "0.85rem" }}>
              {accounts.map((account) => {
                const isSelected = selected === account.username;
                return (
                  <li key={account.username} className="edge-account-row">
                    <button
                      type="button"
                      className={`picker-item airplane-target edge-account-pick ${
                        isSelected ? "is-selected" : ""
                      } ${busy && isSelected ? "is-loading" : ""}`}
                      disabled={busy && !isSelected}
                      onClick={() => startPicked(account)}
                    >
                      <span className="picker-item__row">
                        <span className="picker-item__name">{account.username}</span>
                        {busy && isSelected ? (
                          <span className="edge-account-spinner" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="picker-item__detail">{accountLabel(account)}</span>
                    </button>
                    {account.inVault ? (
                      <button
                        type="button"
                        className="edge-account-remove"
                        disabled={busy}
                        title="Remove from vault and forget on device"
                        onClick={() => void removeSaved(account.username)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="picker-item airplane-target edge-account-pick"
                  disabled={busy}
                  onClick={openAnotherAccount}
                >
                  <span className="picker-item__row">
                    <span className="picker-item__name">Another account…</span>
                  </span>
                  <span className="picker-item__detail">Enter username, password and/or PIN</span>
                </button>
              </li>
            </ul>
          </>
        ) : null}

        {showNeedPin ? (
          <>
            <label className="modal-field">
              <span className="modal-field__label">PIN (4–8 digits)</span>
              <input
                ref={pinRef}
                className="modal-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••"
                disabled={busy}
              />
            </label>
            <label className="edge-save-check">
              <input
                type="checkbox"
                checked={saveCreds}
                onChange={(event) => setSaveCreds(event.target.checked)}
                disabled={busy}
              />
              Save encrypted PIN on this PC
            </label>
          </>
        ) : null}

        {showCredentialForm ? (
          <>
            <label className="modal-field">
              <span className="modal-field__label">Username</span>
              <input
                ref={userRef}
                className="modal-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="edge-username"
                disabled={busy}
              />
            </label>
            <label className="modal-field">
              <span className="modal-field__label">Password (optional if PIN set)</span>
              <input
                className="modal-input"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="modal-field">
              <span className="modal-field__label">PIN (for local re-login)</span>
              <input
                className="modal-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="4–8 digits"
                disabled={busy}
              />
            </label>
            <label className="edge-save-check">
              <input
                type="checkbox"
                checked={saveCreds}
                onChange={(event) => setSaveCreds(event.target.checked)}
                disabled={busy}
              />
              Save encrypted on this PC (never plaintext, never online)
            </label>
          </>
        ) : null}

        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            onClick={() => {
              if (mode === "need-pin") {
                setMode("pick");
                setPin("");
                return;
              }
              if (mode === "new" && accounts.length > 0) {
                backFromForm();
                return;
              }
              onClose();
            }}
            disabled={busy}
          >
            {mode === "need-pin" || (mode === "new" && accounts.length > 0 && !loading)
              ? "Back"
              : "Cancel"}
          </button>
          {loading ? null : mode === "new" || mode === "need-pin" ? (
            <button
              type="submit"
              className="modal-btn modal-btn--primary"
              disabled={busy || !canSubmit}
            >
              {busy ? "Starting…" : mode === "need-pin" ? "Save PIN & start" : "Start"}
            </button>
          ) : accounts.length === 0 ? (
            <button
              type="submit"
              className="modal-btn modal-btn--primary"
              disabled={busy || !canSubmit}
            >
              {busy ? "Starting…" : "Start"}
            </button>
          ) : (
            <button type="button" className="modal-btn modal-btn--primary" disabled>
              {busy ? "Starting…" : "Click an account to start"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
