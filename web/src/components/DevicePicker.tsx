import { useRef } from "react";
import { useDialogModal } from "../hooks/useDialogModal";
import type { DeviceInfo } from "../types";

interface DevicePickerProps {
  devices: DeviceInfo[];
  usedIds: Set<string>;
  onPick: (device: DeviceInfo) => void;
  onClose: () => void;
}

export function DevicePicker({ devices, usedIds, onPick, onClose }: DevicePickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);

  const available = devices.filter((device) => !usedIds.has(device.id));

  return (
    <dialog ref={dialogRef} className="device-picker" onClose={onClose}>
      <form method="dialog" className="device-picker__panel">
        <header>
          <h3>Add device</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {available.length === 0 ? (
          <p className="picker-empty">No connected devices available. Plug in a phone via USB and enable USB debugging / trust this computer.</p>
        ) : (
          <ul className="picker-list">
            {available.map((device) => (
              <li key={device.id}>
                <button type="button" className="picker-item" onClick={() => onPick(device)}>
                  <span className="picker-item__row">
                    <span className="picker-item__name">{device.name}</span>
                    <span className={`platform-badge platform-badge--${device.platform}`}>
                      {device.platform}
                    </span>
                  </span>
                  <span className="picker-item__detail">
                    {device.appLabel ?? device.model}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </dialog>
  );
}
