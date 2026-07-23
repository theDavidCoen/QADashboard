import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDialogModal } from "../hooks/useDialogModal";

interface OpenUrlModalProps {
  title: string;
  description: string;
  confirmLabel?: string;
  placeholder?: string;
  busy?: boolean;
  onConfirm: (url: string) => void;
  onClose: () => void;
}

export function OpenUrlModal({
  title,
  description,
  confirmLabel = "Open on devices",
  placeholder = "https://…",
  busy = false,
  onConfirm,
  onClose,
}: OpenUrlModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("https://");
  useDialogModal(dialogRef, onClose);

  useEffect(() => {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <form className="device-picker__panel" onSubmit={submit}>
        <header>
          <h3>{title}</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="picker-empty" style={{ marginBottom: "0.85rem" }}>
          {description}
        </p>
        <label className="modal-field">
          <span className="modal-field__label">URL</span>
          <input
            ref={inputRef}
            className="modal-input"
            type="url"
            name="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={placeholder}
            required
            disabled={busy}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="modal-btn modal-btn--primary" disabled={busy || !url.trim()}>
            {busy ? "Opening…" : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
