import type { DragEvent } from "react";
import { DeviceStream } from "./DeviceStream";
import type { SlotDevice } from "../types";

interface DeviceSlotProps {
  device: SlotDevice | null;
  emptyLabel?: string;
  onRemove?: () => void;
  recording?: boolean;
  /** When any device is recording, Esc stops Rec instead of sending BACK. */
  recordingActive?: boolean;
  flash?: boolean;
  rebooting?: boolean;
  focused?: boolean;
  focusDimmed?: boolean;
  onFocusHover?: () => void;
  onFocusLock?: () => void;
  /** Enable drag handle when more than one device is connected. */
  canReorder?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStartSlot?: (event: DragEvent) => void;
  onDragOverSlot?: (event: DragEvent) => void;
  onDragLeaveSlot?: () => void;
  onDropSlot?: (event: DragEvent) => void;
  onDragEndSlot?: () => void;
}

function resolveApp(device: SlotDevice): { name: string | null; build: string | null; url: string | null } {
  const app = device.app;
  let name = app?.name?.trim() || null;
  let build = app?.build?.trim() || null;
  let url = app?.url?.trim() || null;

  if (name) return { name, build, url };

  const label = device.appLabel?.trim() ?? "";
  if (!label) return { name: null, build, url };

  const urlParts = label.split(/\s*[·|]\s+/);
  if (urlParts.length >= 2 && /https?:\/\//.test(urlParts[1])) {
    return { name: urlParts[0].trim(), build, url: urlParts[1].trim() };
  }
  const buildMatch = label.match(/^(.*?),\s*build\s+([^,]+)(?:,.*)?$/i);
  if (buildMatch) {
    return {
      name: buildMatch[1].trim() || null,
      build: buildMatch[2].trim() || build,
      url,
    };
  }
  const onlyBuild = label.match(/^build\s+(.+)$/i);
  if (onlyBuild) {
    return { name: null, build: onlyBuild[1].trim() || build, url };
  }
  return { name: label, build, url };
}

function formatAppLine(
  name: string | null,
  build: string | null,
  url: string | null,
): string {
  if (url) {
    const host = url.replace(/^https?:\/\//, "");
    return name ? `${name}, ${host}` : host;
  }
  if (name && build) return `${name}, build ${build}`;
  if (name) return name;
  if (build) return `build ${build}`;
  return "unknown";
}

export function DeviceSlot({
  device,
  emptyLabel = "Connect device",
  onRemove,
  recording = false,
  recordingActive = false,
  flash = false,
  rebooting = false,
  focused = false,
  focusDimmed = false,
  onFocusHover,
  onFocusLock,
  canReorder = false,
  dragging = false,
  dropTarget = false,
  onDragStartSlot,
  onDragOverSlot,
  onDragLeaveSlot,
  onDropSlot,
  onDragEndSlot,
}: DeviceSlotProps) {
  if (!device) {
    return (
      <div className="device-slot device-slot--empty">
        <div className="device-slot__header device-slot__header--spacer" aria-hidden="true" />
        <div className="empty-body">
          <div className="empty-inner">
            <p>{emptyLabel}</p>
            <span className="empty-plus" aria-hidden="true">
              +
            </span>
          </div>
        </div>
      </div>
    );
  }

  const { name: appName, build: appBuild, url: appUrl } = resolveApp(device);
  const deviceLine = device.osVersion ? `${device.name} · ${device.osVersion}` : device.name;
  const appLine = rebooting ? "Rebooting…" : formatAppLine(appName, appBuild, appUrl);

  const slotClass = [
    "device-slot",
    "device-slot--active",
    recording ? "device-slot--recording" : "",
    focused ? "device-slot--focused" : "",
    focusDimmed ? "device-slot--focus-dimmed" : "",
    flash ? "device-slot--flash" : "",
    rebooting ? "device-slot--rebooting" : "",
    dragging ? "device-slot--dragging" : "",
    dropTarget ? "device-slot--drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={slotClass}
      onPointerEnter={onFocusHover}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        onFocusLock?.();
      }}
      onDragOver={canReorder ? onDragOverSlot : undefined}
      onDragLeave={canReorder ? onDragLeaveSlot : undefined}
      onDrop={canReorder ? onDropSlot : undefined}
    >
      <header className="device-slot__header">
        {canReorder ? (
          <button
            type="button"
            className="device-slot__drag-handle"
            draggable
            onDragStart={onDragStartSlot}
            onDragEnd={onDragEndSlot}
            title="Drag to reorder"
            aria-label="Drag to reorder device"
          >
            <span className="device-slot__drag-grip" aria-hidden="true" />
          </button>
        ) : null}
        <div className="device-slot__meta">
          <p className="device-slot__line" title={device.model}>
            <span className="device-slot__label">Device:</span> {deviceLine}
          </p>
          <p className="device-slot__line" title={rebooting ? undefined : (appUrl ?? undefined)}>
            <span className="device-slot__label">App:</span> {appLine}
          </p>
        </div>
        {onRemove ? (
          <button
            type="button"
            className="slot-disconnect"
            onClick={onRemove}
            title="Disconnect this device"
            aria-label="Disconnect this device"
            disabled={rebooting}
          >
            ×
          </button>
        ) : null}
      </header>
      <div className="device-slot__stage">
        <DeviceStream
          deviceId={device.id}
          platform={device.platform}
          mockupId={device.mockupId ?? "generic-android"}
          recordingActive={recordingActive}
        />
        {flash ? <div className="device-slot__flash" aria-hidden="true" /> : null}
        {rebooting ? (
          <div className="device-slot__reboot-veil" aria-live="polite">
            <span className="device-slot__reboot-label">Rebooting…</span>
          </div>
        ) : null}
        {recording ? (
          <div className="device-slot__rec-corner" aria-hidden="true">
            REC
          </div>
        ) : null}
      </div>
    </article>
  );
}
