import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionResponse } from "../api/actions";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

type Target = "all" | string;

interface DeviceToggleModalProps {
  title: string;
  description?: string;
  devices: DeviceInfo[];
  busy?: boolean;
  fetchStatus: () => Promise<ActionResponse>;
  onLabel?: string;
  offLabel?: string;
  statusOnLabel?: string;
  statusOffLabel?: string;
  onConfirm: (enabled: boolean, deviceIds: string[] | undefined) => void;
  onClose: () => void;
}

export function DeviceToggleModal({
  title,
  description,
  devices,
  busy = false,
  fetchStatus,
  onLabel = "Enable",
  offLabel = "Disable",
  statusOnLabel = "ON",
  statusOffLabel = "OFF",
  onConfirm,
  onClose,
}: DeviceToggleModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);
  const android = useMemo(
    () => devices.filter((device) => device.platform === "android"),
    [devices],
  );
  const soleDevice = android.length === 1 ? android[0] : null;
  const [target, setTarget] = useState<Target>(soleDevice ? soleDevice.id : "all");
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    if (soleDevice) setTarget(soleDevice.id);
  }, [soleDevice]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingStatus(true);
      try {
        const payload = await fetchStatus();
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
  }, [fetchStatus]);

  const deviceIds = target === "all" ? undefined : [target];
  const soleStatus = soleDevice ? statusById[soleDevice.id] : undefined;
  const formatStatus = (status: string | undefined) => {
    if (loadingStatus) return "Checking status…";
    if (status === "on") return `Currently: ${statusOnLabel}`;
    if (status === "off") return `Currently: ${statusOffLabel}`;
    if (status === "error") return "Status unavailable";
    if (status && status !== "unknown") return status;
    return null;
  };
  const soleStatusLabel = formatStatus(soleStatus);

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
            {soleDevice ? (
              <p className="picker-empty" style={{ marginBottom: "0.85rem" }}>
                {soleDevice.name}
                {soleStatusLabel ? ` · ${soleStatusLabel}` : ""}
              </p>
            ) : (
              <>
                <p className="modal-field__label" style={{ marginBottom: "0.55rem" }}>
                  Target
                </p>
                <ul className="picker-list airplane-targets">
                  <li>
                    <label
                      className={`picker-item airplane-target ${target === "all" ? "is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`${title}-target`}
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
                            name={`${title}-target`}
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
                                ? statusOnLabel
                                : status === "off"
                                  ? statusOffLabel
                                  : status === "error"
                                    ? "Status unavailable"
                                    : device.model}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

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
                {busy ? "…" : offLabel}
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                disabled={busy}
                onClick={() => onConfirm(true, deviceIds)}
              >
                {busy ? "…" : onLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
