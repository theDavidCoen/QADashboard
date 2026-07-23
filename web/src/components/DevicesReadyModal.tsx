import { useRef } from "react";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

interface DevicesReadyModalProps {
  devices: DeviceInfo[];
  onClose: () => void;
}

export function DevicesReadyModal({ devices, onClose }: DevicesReadyModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <div className="device-picker__panel">
        <header>
          <h3>Devices ready</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {devices.length === 0 ? (
          <p className="picker-empty">
            No USB devices detected. Plug in a phone and enable USB debugging / trust this computer.
          </p>
        ) : (
          <ul className="picker-list picker-list--readonly">
            {devices.map((device) => (
              <li key={device.id} className="picker-item picker-item--static">
                <span className="picker-item__row">
                  <span className="picker-item__name">{device.name}</span>
                  <span className={`platform-badge platform-badge--${device.platform}`}>
                    {device.platform}
                  </span>
                </span>
                <span className="picker-item__detail">
                  {device.appLabel ?? device.model}
                  <span className="picker-item__id"> · {device.id}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
