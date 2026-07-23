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
      try {
        const payload = await listArkadeSessions(deviceIds);
        if (cancelled) return;
        setSessions(payload.sessions);
        if (payload.sessions.length) {
          setMode("existing");
          setSelectedUrl(payload.sessions[0].url);
        } else {
          setMode("new");
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
  }, [deviceIds]);

  useEffect(() => {
    if (mode !== "new" || loading) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [mode, loading]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
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

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <form className="device-picker__panel" onSubmit={submit}>
        <header>
          <h3>Start Arkade</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="picker-empty" style={{ marginBottom: "0.85rem" }}>
          {loading
            ? "Looking for open Arkade windows in Chrome…"
            : sessions.length
              ? "Choose an already open Arkade window, or paste a new URL."
              : "Paste the test URL. Chrome will open it on every Android device added to the dashboard."}
        </p>

        {loadError ? <p className="picker-empty">{loadError}</p> : null}

        {!loading && sessions.length > 0 ? (
          <>
            <p className="modal-field__label" style={{ marginBottom: "0.45rem" }}>
              Open windows
            </p>
            <ul className="picker-list airplane-targets app-pick-list" style={{ marginBottom: "0.85rem" }}>
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
              <li>
                <label
                  className={`picker-item airplane-target ${mode === "new" ? "is-selected" : ""}`}
                >
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

        {(mode === "new" || (!loading && sessions.length === 0)) && (
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
              disabled={busy || loading}
            />
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="modal-btn modal-btn--primary"
            disabled={busy || loading || !canSubmit}
          >
            {busy ? "Opening…" : mode === "existing" ? "Open selected" : "Open on devices"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
