import { useEffect, useMemo, useRef, useState } from "react";
import { listLaunchableApps, type LaunchableApp } from "../api/actions";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

interface StartOtherAppModalProps {
  devices: DeviceInfo[];
  busy?: boolean;
  onConfirm: (deviceId: string, app: LaunchableApp) => void;
  onClose: () => void;
}

export function StartOtherAppModal({
  devices,
  busy = false,
  onConfirm,
  onClose,
}: StartOtherAppModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);

  const android = useMemo(
    () => devices.filter((device) => device.platform === "android"),
    [devices],
  );
  const [step, setStep] = useState<"device" | "app">("device");
  const [deviceId, setDeviceId] = useState(android[0]?.id ?? "");
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId && android[0]) setDeviceId(android[0].id);
  }, [android, deviceId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (app) =>
        app.label.toLowerCase().includes(q) || app.package.toLowerCase().includes(q),
    );
  }, [apps, query]);

  const selected = filtered.find((app) => app.package === selectedPackage) ?? null;

  const loadApps = async (id: string) => {
    setLoadingApps(true);
    setAppsError(null);
    setApps([]);
    setSelectedPackage(null);
    setQuery("");
    try {
      const payload = await listLaunchableApps(id);
      setApps(payload.apps);
      setStep("app");
    } catch (error) {
      setAppsError(error instanceof Error ? error.message : "Failed to load apps");
    } finally {
      setLoadingApps(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <div className="device-picker__panel">
        <header>
          <h3>Start other app</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {android.length === 0 ? (
          <p className="picker-empty">No Android devices added.</p>
        ) : step === "device" ? (
          <>
            <p className="picker-empty" style={{ marginBottom: "0.85rem" }}>
              Choose a device, then pick an installed launcher app.
            </p>
            <ul className="picker-list airplane-targets">
              {android.map((device) => (
                <li key={device.id}>
                  <label
                    className={`picker-item airplane-target ${deviceId === device.id ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="start-app-device"
                      checked={deviceId === device.id}
                      onChange={() => setDeviceId(device.id)}
                      disabled={busy || loadingApps}
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
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                disabled={!deviceId || loadingApps}
                onClick={() => loadApps(deviceId)}
              >
                {loadingApps ? "Loading apps…" : "Next"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-field__label" style={{ marginBottom: "0.45rem" }}>
              Apps on {android.find((d) => d.id === deviceId)?.name ?? "device"}
            </p>
            <input
              className="modal-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps…"
              disabled={busy}
              style={{ marginBottom: "0.75rem" }}
            />
            {appsError ? <p className="picker-empty">{appsError}</p> : null}
            <ul className="picker-list airplane-targets app-pick-list">
              {filtered.map((app) => (
                <li key={app.package}>
                  <label
                    className={`picker-item airplane-target ${selectedPackage === app.package ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="start-app-package"
                      checked={selectedPackage === app.package}
                      onChange={() => setSelectedPackage(app.package)}
                      disabled={busy}
                    />
                    <span className="picker-item__row">
                      <span className="picker-item__name">{app.label}</span>
                    </span>
                    <span className="picker-item__detail">{app.package}</span>
                  </label>
                </li>
              ))}
            </ul>
            {!filtered.length && !appsError ? (
              <p className="picker-empty">No apps match the search.</p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn--ghost"
                onClick={() => setStep("device")}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                disabled={busy || !selected}
                onClick={() => selected && onConfirm(deviceId, selected)}
              >
                {busy ? "Starting…" : "Start app"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
