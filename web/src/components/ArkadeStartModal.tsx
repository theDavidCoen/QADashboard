import { useEffect, useRef, useState, type FormEvent } from "react";
import { listArkadeSessions, type OpenWebSession } from "../api/actions";
import { useDialogModal } from "../hooks/useDialogModal";

interface ArkadeStartModalProps {
  busy?: boolean;
  deviceIds?: string[];
  onConfirm: (url: string) => void;
  onClose: () => void;
}

type Mode = "existing" | "new";

export function ArkadeStartModal({
  busy = false,
  deviceIds,
  onConfirm,
  onClose,
}: ArkadeStartModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogModal(dialogRef, onClose);

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<OpenWebSession[]>([]);
  const [mode, setMode] = useState<Mode>("new");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [url, setUrl] = useState("https://arkade.money/");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setSessions([]);
      setMode("new");
      setSelectedUrl(null);
      try {
        const payload = await listArkadeSessions(deviceIds);
        if (cancelled) return;
        setSessions(payload.sessions);
        if (payload.sessions.length) {
          setMode("existing");
          setSelectedUrl(payload.sessions[0].url);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to scan open windows");
          setMode("new");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per device set
  }, [deviceIds?.join(",")]);

  useEffect(() => {
    if (mode !== "new" || loading) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [mode, loading]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || loading) return;
    if (mode === "existing" && selectedUrl) {
      onConfirm(selectedUrl);
      return;
    }
    const trimmed = url.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  const canSubmit =
    mode === "existing" ? Boolean(selectedUrl) : Boolean(url.trim());

  const showSessionList = !loading && sessions.length > 0;
  const showUrlField = !loading && (mode === "new" || sessions.length === 0);

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <form className="device-picker__panel" onSubmit={submit}>
        <header>
          <h3>Start Arkade</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </header>

        <p className="picker-empty" style={{ marginBottom: loading ? "0.65rem" : "0.85rem" }}>
          {loading
            ? "Scanning Chrome on connected devices for open Arkade windows…"
            : sessions.length
              ? "Pick an open window or enter a new URL."
              : "No open Arkade window found. Paste the test URL to open on every Android device."}
        </p>

        {loading ? (
          <div className="modal-loading-row" aria-live="polite">
            <span className="edge-account-spinner" aria-hidden="true" />
            <span>Looking for open Arkade tabs and PWAs…</span>
          </div>
        ) : null}

        {loadError ? <p className="settings-error">{loadError}</p> : null}

        {showSessionList ? (
          <>
            <p className="modal-field__label" style={{ marginBottom: "0.45rem" }}>
              Open windows
            </p>
            <ul className="picker-list airplane-targets app-pick-list">
              {sessions.map((session) => (
                <li key={session.url}>
                  <label
                    className={`picker-item airplane-target ${
                      mode === "existing" && selectedUrl === session.url ? "is-selected" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="arkade-session"
                      checked={mode === "existing" && selectedUrl === session.url}
                      onChange={() => {
                        setMode("existing");
                        setSelectedUrl(session.url);
                      }}
                      disabled={busy}
                    />
                    <span className="picker-item__row">
                      <span className="picker-item__name">{session.name}</span>
                      <span className="platform-badge platform-badge--android">
                        {session.source === "webapk" ? "PWA" : session.source}
                      </span>
                    </span>
                    <span className="picker-item__detail">{session.url.replace(/^https?:\/\//, "")}</span>
                  </label>
                </li>
              ))}
              <li className="picker-list__divider" aria-hidden="true" />
              <li>
                <label className={`picker-item airplane-target ${mode === "new" ? "is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="arkade-session"
                    checked={mode === "new"}
                    onChange={() => setMode("new")}
                    disabled={busy}
                  />
                  <span className="picker-item__row">
                    <span className="picker-item__name">New URL…</span>
                  </span>
                  <span className="picker-item__detail">Paste any Arkade test link</span>
                </label>
              </li>
            </ul>
          </>
        ) : null}

        {showUrlField ? (
          <label className="modal-field">
            <span className="modal-field__label">URL</span>
            <input
              ref={inputRef}
              className="modal-input"
              type="url"
              name="url"
              value={url}
              onChange={(event) => {
                setMode("new");
                setUrl(event.target.value);
              }}
              placeholder="https://arkade.money/…"
              required={mode === "new"}
              disabled={busy}
            />
          </label>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {loading ? null : (
            <button
              type="submit"
              className="modal-btn modal-btn--primary"
              disabled={busy || !canSubmit}
            >
              {busy ? "Opening…" : mode === "existing" ? "Open selected" : "Open on devices"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
