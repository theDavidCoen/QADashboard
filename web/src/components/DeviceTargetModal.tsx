import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

type Target = "all" | string;

interface DeviceTargetModalProps {
  title: string;
  description?: string;
  confirmLabel: string;
  devices: DeviceInfo[];
  busy?: boolean;
  danger?: boolean;
  allowAll?: boolean;
  onConfirm: (deviceIds: string[] | undefined) => void;
  onClose: () => void;
}

export function DeviceTargetModal({
  title,
  description,
  confirmLabel,
  devices,
  busy = false,
  danger = false,
  allowAll = true,
  onConfirm,
  onClose,
}: DeviceTargetModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);
  const android = useMemo(
    () => devices.filter((device) => device.platform === "android"),
    [devices],
  );
  const [target, setTarget] = useState<Target>(allowAll ? "all" : android[0]?.id ?? "all");

  useEffect(() => {
    if (!allowAll && android.length && target === "all") {
      setTarget(android[0].id);
    }
  }, [allowAll, android, target]);

  const deviceIds = target === "all" ? undefined : [target];
  const canConfirm = android.length > 0 && (allowAll || target !== "all");

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <div className="device-picker__panel">
        <header>
          <h3>{title}</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {description ? (
          <p className="picker-empty" style={{ marginBottom: "0.85rem" }}>
            {description}
          </p>
        ) : null}

        {android.length === 0 ? (
          <p className="picker-empty">No Android devices connected.</p>
        ) : (
          <>
            <p className="modal-field__label" style={{ marginBottom: "0.55rem" }}>
              Target
            </p>
            <ul className="picker-list airplane-targets">
              {allowAll ? (
                <li>
                  <label
                    className={`picker-item airplane-target ${target === "all" ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="device-target"
                      checked={target === "all"}
                      onChange={() => setTarget("all")}
                      disabled={busy}
                    />
                    <span className="picker-item__row">
                      <span className="picker-item__name">All Android devices</span>
                      <span className="picker-item__detail">{android.length}</span>
                    </span>
                  </label>
                </li>
              ) : null}
              {android.map((device) => (
                <li key={device.id}>
                  <label
                    className={`picker-item airplane-target ${target === device.id ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="device-target"
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
                className={`modal-btn ${danger ? "" : "modal-btn--primary"}`}
                disabled={busy || !canConfirm}
                onClick={() => onConfirm(deviceIds)}
              >
                {busy ? "…" : confirmLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
