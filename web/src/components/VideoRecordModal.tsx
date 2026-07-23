import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

interface VideoRecordModalProps {
  devices: DeviceInfo[];
  busy?: boolean;
  onStart: (deviceId: string) => void;
  onClose: () => void;
}

/** Pick a device and start recording — closes itself via parent after start. */
export function VideoRecordModal({
  devices,
  busy = false,
  onStart,
  onClose,
}: VideoRecordModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);
  const android = useMemo(
    () => devices.filter((device) => device.platform === "android"),
    [devices],
  );
  const [target, setTarget] = useState(android[0]?.id ?? "");

  useEffect(() => {
    if (!target && android[0]) setTarget(android[0].id);
  }, [android, target]);

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <div className="device-picker__panel">
        <header>
          <h3>Video recording</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="picker-empty" style={{ marginBottom: "0.85rem" }}>
          Pick a device to start recording. The modal will close; use Stop recording in the
          workspace header when finished.
        </p>

        {android.length === 0 ? (
          <p className="picker-empty">No Android devices connected.</p>
        ) : (
          <>
            <ul className="picker-list airplane-targets">
              {android.map((device) => (
                <li key={device.id}>
                  <label
                    className={`picker-item airplane-target ${target === device.id ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="video-target"
                      checked={target === device.id}
                      onChange={() => setTarget(device.id)}
                      disabled={busy}
                    />
                    <span className="picker-item__row">
                      <span className="picker-item__name">{device.name}</span>
                      <span className="platform-badge platform-badge--android">android</span>
                    </span>
                    <span className="picker-item__detail">{device.model}</span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn--ghost"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                disabled={busy || !target}
                onClick={() => onStart(target)}
              >
                {busy ? "Starting…" : "Start recording"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
