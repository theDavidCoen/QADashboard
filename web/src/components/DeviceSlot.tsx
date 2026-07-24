import { useLayoutEffect, useRef, type DragEvent } from "react";
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
  /** Visual rotation of device + screen (degrees, typically 0/90/180/270). */
  rotationDeg?: number;
  /** When set, blocks interaction and shows a loading veil on the phone. */
  actionBusyLabel?: string | null;
  focused?: boolean;
  focusDimmed?: boolean;
  onFocusHover?: () => void;
  onFocusLock?: () => void;
  /** When set, Ctrl/⌘+click on the slot opens Focus fullscreen. */
  onFocusExpand?: () => void;
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

function resolveApp(device: SlotDevice): {
  name: string | null;
  version: string | null;
  build: string | null;
  url: string | null;
} {
  const app = device.app;
  let name = app?.name?.trim() || null;
  let version = app?.version?.trim() || null;
  let build = app?.build?.trim() || null;
  let url = app?.url?.trim() || null;

  if (name) return { name, version, build, url };

  const label = device.appLabel?.trim() ?? "";
  if (!label) return { name: null, version, build, url };

  const urlParts = label.split(/\s*[·|]\s+/);
  if (urlParts.length >= 2 && /https?:\/\//.test(urlParts[1])) {
    return { name: urlParts[0].trim(), version, build, url: urlParts[1].trim() };
  }

  // "Edge 4.50.0, build 26072201" / "Edge, Staging 4.50.0, build 26072201"
  const versionBuild = label.match(
    /^(.*?)\s+(\d+(?:\.\d+)+(?:-[A-Za-z0-9.]+)?),\s*build\s+(\S+)\s*$/i,
  );
  if (versionBuild) {
    return {
      name: versionBuild[1].trim() || null,
      version: versionBuild[2].trim() || version,
      build: versionBuild[3].trim() || build,
      url,
    };
  }

  const buildMatch = label.match(/^(.*?),\s*build\s+([^,]+)(?:,.*)?$/i);
  if (buildMatch) {
    return {
      name: buildMatch[1].trim() || null,
      version,
      build: buildMatch[2].trim() || build,
      url,
    };
  }
  const onlyBuild = label.match(/^build\s+(.+)$/i);
  if (onlyBuild) {
    return { name: null, version, build: onlyBuild[1].trim() || build, url };
  }
  return { name: label, version, build, url };
}

function formatAppLine(
  name: string | null,
  version: string | null,
  build: string | null,
  url: string | null,
): string {
  if (url) {
    const host = url.replace(/^https?:\/\//, "");
    return name ? `${name}, ${host}` : host;
  }
  if (name && version && build) return `${name} ${version}, build ${build}`;
  if (name && build) return `${name}, build ${build}`;
  if (name && version) return `${name} ${version}`;
  if (name) return name;
  if (build) return `build ${build}`;
  if (version) return version;
  return "unknown";
}

/** Shrink meta font so Device/App copy stays inside the fixed header (devices stay aligned). */
function useFitSlotMeta(textKey: string) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const maxPx = 15.2; // ~0.95rem
    const minPx = 9;
    const step = 0.5;

    const overflows = () => {
      if (el.scrollHeight > el.clientHeight + 0.5) return true;
      for (const line of el.querySelectorAll<HTMLElement>(".device-slot__line")) {
        if (line.scrollWidth > line.clientWidth + 0.5) return true;
      }
      return false;
    };

    const fit = () => {
      let size = maxPx;
      el.style.fontSize = `${size}px`;
      void el.offsetHeight;
      while (size > minPx && overflows()) {
        size -= step;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const ro = new ResizeObserver(() => {
      // Reset then refit so growing the slot can restore a larger font.
      el.style.fontSize = `${maxPx}px`;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [textKey]);

  return ref;
}

export function DeviceSlot({
  device,
  emptyLabel = "Connect device",
  onRemove,
  recording = false,
  recordingActive = false,
  flash = false,
  rebooting = false,
  rotationDeg = 0,
  actionBusyLabel = null,
  focused = false,
  focusDimmed = false,
  onFocusHover,
  onFocusLock,
  onFocusExpand,
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

  const { name: appName, version: appVersion, build: appBuild, url: appUrl } = resolveApp(device);
  const deviceLine = device.osVersion ? `${device.name} · ${device.osVersion}` : device.name;
  const appLine = rebooting ? "Rebooting…" : formatAppLine(appName, appVersion, appBuild, appUrl);
  const metaRef = useFitSlotMeta(`${deviceLine}\n${appLine}`);

  const landscapeLayout = rotationDeg % 180 !== 0;
  const slotClass = [
    "device-slot",
    "device-slot--active",
    recording ? "device-slot--recording" : "",
    focused ? "device-slot--focused" : "",
    focusDimmed ? "device-slot--focus-dimmed" : "",
    flash ? "device-slot--flash" : "",
    rebooting ? "device-slot--rebooting" : "",
    actionBusyLabel ? "device-slot--action-busy" : "",
    dragging ? "device-slot--dragging" : "",
    dropTarget ? "device-slot--drop-target" : "",
    landscapeLayout ? "device-slot--landscape" : "",
    rotationDeg === 180 ? "device-slot--rotated-180" : "",
    rotationDeg ? "device-slot--rotated" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={slotClass}
      onPointerEnter={onFocusHover}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        if (onFocusLock) {
          onFocusLock();
          return;
        }
        // Optional immersive view — normal clicks still reach DeviceStream.
        if (onFocusExpand && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.stopPropagation();
          onFocusExpand();
        }
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
        <div className="device-slot__meta" ref={metaRef}>
          <p className="device-slot__line" title={`${deviceLine}${device.model ? ` · ${device.model}` : ""}`}>
            <span className="device-slot__label">Device:</span> {deviceLine}
          </p>
          <p className="device-slot__line" title={rebooting ? undefined : appLine}>
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
        <div className="device-slot__rotate-host">
          <div
            className="device-slot__rotate"
            style={rotationDeg === 180 ? { transform: "rotate(180deg)" } : undefined}
          >
            <DeviceStream
              deviceId={device.id}
              platform={device.platform}
              mockupId={device.mockupId ?? "generic-android"}
              recordingActive={recordingActive}
              landscape={landscapeLayout}
            />
            {flash ? <div className="device-slot__flash" aria-hidden="true" /> : null}
            {rebooting ? (
              <div className="device-slot__reboot-veil" aria-live="polite">
                <span className="device-slot__reboot-label">Rebooting…</span>
              </div>
            ) : null}
            {actionBusyLabel && !rebooting ? (
              <div className="device-slot__action-veil" aria-live="polite" aria-busy="true">
                <div className="device-slot__action-busy">
                  <span className="device-slot__action-spinner" aria-hidden="true" />
                  <span className="device-slot__action-label">{actionBusyLabel}</span>
                </div>
              </div>
            ) : null}
            {recording ? (
              <div className="device-slot__rec-corner" aria-hidden="true">
                REC
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
