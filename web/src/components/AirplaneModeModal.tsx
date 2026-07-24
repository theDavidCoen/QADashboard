import { useEffect, useMemo, useRef, useState } from "react";
import { getAirplaneStatus } from "../api/actions";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

interface AirplaneModeModalProps {
  devices: DeviceInfo[];
  busy?: boolean;
  onConfirm: (enabled: boolean, deviceIds: string[] | undefined) => void;
  onClose: () => void;
}

type Target = "all" | string;

export function AirplaneModeModal({
  devices,
  busy = false,
  onConfirm,
  onClose,
}: AirplaneModeModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);
  const android = useMemo(
    () => devices.filter((device) => device.platform === "android"),
    [devices],
  );
  const [target, setTarget] = useState<Target>("all");
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingStatus(true);
      try {
        const payload = await getAirplaneStatus();
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const item of payload.results) {
          next[item.deviceId] = item.ok ? (item.detail ?? "unknown") : "error";
        }
        setStatusById(next);
      } catch {
        if (!cancelled) setStatusById({});
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const deviceIds = target === "all" ? undefined : [target];

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <div className="device-picker__panel">
        <header>
          <h3>Airplane mode</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {android.length === 0 ? (
          <p className="picker-empty">No Android devices connected.</p>
        ) : (
          <>
            <p className="modal-field__label" style={{ marginBottom: "0.55rem" }}>
              Target
            </p>
            <ul className="picker-list airplane-targets">
              <li>
                <label className={`picker-item airplane-target ${target === "all" ? "is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="airplane-target"
                    checked={target === "all"}
                    onChange={() => setTarget("all")}
                    disabled={busy}
                  />
                  <span className="picker-item__row">
                    <span className="picker-item__name">All Devices</span>
                    <span className="picker-item__detail">{android.length}</span>
                  </span>
                </label>
              </li>
              {android.map((device) => {
                const status = statusById[device.id];
                return (
                  <li key={device.id}>
                    <label
                      className={`picker-item airplane-target ${target === device.id ? "is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="airplane-target"
                        checked={target === device.id}
                        onChange={() => setTarget(device.id)}
                        disabled={busy}
                      />
                      <span className="picker-item__row">
                        <span className="picker-item__name">{device.name}</span>
                        <span className="platform-badge platform-badge--android">android</span>
                      </span>
                      <span className="picker-item__detail">
                        {loadingStatus
                          ? "Checking…"
                          : status === "on"
                            ? "Airplane ON"
                            : status === "off"
                              ? "Airplane OFF"
                              : status === "error"
                                ? "Status unavailable"
                                : device.model}
                      </span>
                    </label>
                  </li>
                );
              })}
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
                className="modal-btn"
                disabled={busy}
                onClick={() => onConfirm(false, deviceIds)}
              >
                {busy ? "…" : "Disable"}
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                disabled={busy}
                onClick={() => onConfirm(true, deviceIds)}
              >
                {busy ? "…" : "Enable"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
