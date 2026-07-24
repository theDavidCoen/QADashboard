import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  killBackground,
  killForeground,
  openUrl,
  rebootDevices,
  setAirplaneMode,
  startApp,
  startEdgeAccount,
  startPackage,
  startScreenrecord,
  stopScreenrecord,
  summarizeResults,
  takeScreenshot,
  type ActionResult,
  type LaunchableApp,
} from "./api/actions";
import {
  fetchSettings,
  runCustomAdb,
  type CustomAdbAction,
  type SettingsPayload,
} from "./api/settings";
import { AirplaneModeModal } from "./components/AirplaneModeModal";
import { ActionIcon } from "./components/ActionIcons";
import { ArkadeStartModal } from "./components/ArkadeStartModal";
import { DevicePicker } from "./components/DevicePicker";
import { DeviceSlot } from "./components/DeviceSlot";
import { DeviceTargetModal } from "./components/DeviceTargetModal";
import { DevicesReadyModal } from "./components/DevicesReadyModal";
import { EdgeAccountModal } from "./components/EdgeAccountModal";
import { EmptyAddSlot } from "./components/EmptyAddSlot";
import { OpenUrlModal } from "./components/OpenUrlModal";
import { SettingsModal } from "./components/SettingsModal";
import { StartOtherAppModal } from "./components/StartOtherAppModal";
import { ThemeToggle } from "./components/ThemeToggle";
import { VideoRecordModal } from "./components/VideoRecordModal";
import { playFocusModeSound, playRecSound, playShutterSound, setSoundEffectsEnabled } from "./feedback";
import type { DeviceInfo, SlotDevice } from "./types";
import { APP_LICENSE_URL, APP_REPO_URL, APP_VERSION } from "./version";

function makeSlot(device: DeviceInfo): SlotDevice {
  return {
    ...device,
    mockupId: device.mockupId ?? (device.platform === "ios" ? "generic-ios" : "generic-android"),
    slotId: crypto.randomUUID(),
  };
}

type ModalKind =
  | "devices"
  | "arkade"
  | "edge-account"
  | "settings"
  | "pwa"
  | "other-app"
  | "kill-bg"
  | "kill-fg"
  | "airplane"
  | "reboot"
  | "screenshot"
  | "video"
  | null;

export default function App() {
  const [available, setAvailable] = useState<DeviceInfo[]>([]);
  const [slots, setSlots] = useState<Array<SlotDevice | null>>([null]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [recordingDeviceId, setRecordingDeviceId] = useState<string | null>(null);
  const [focusDeviceId, setFocusDeviceId] = useState<string | null>(null);
  const [focusLocked, setFocusLocked] = useState(false);
  const [flashDeviceIds, setFlashDeviceIds] = useState<string[]>([]);
  const [rebootingIds, setRebootingIds] = useState<string[]>([]);
  const rebootingIdsRef = useRef<string[]>([]);
  const rebootingSeenOffline = useRef<Set<string>>(new Set());
  const recordingDeviceIdRef = useRef<string | null>(null);
  const focusDeviceIdRef = useRef<string | null>(null);
  const actionBusyRef = useRef(false);
  const modalRef = useRef<ModalKind>(null);
  const runVideoStopRef = useRef<(deviceId: string) => Promise<void>>(async () => {});
  const [sidebarFlags, setSidebarFlags] = useState<Record<string, boolean>>({});
  const [edgeFeaturesEnabled, setEdgeFeaturesEnabled] = useState(false);
  const [arkadeFeaturesEnabled, setArkadeFeaturesEnabled] = useState(false);
  const [soundEffectsEnabled, setSoundEffectsEnabledState] = useState(true);
  const [featuresReady, setFeaturesReady] = useState(false);
  const [customAdbActions, setCustomAdbActions] = useState<CustomAdbAction[]>([]);
  const [capturePathHint, setCapturePathHint] = useState("~/Immagini/Schermate");

  const EDGE_ACTION_IDS = useMemo(
    () => new Set(["start_edge", "start_edge_account", "start_edge_develop"]),
    [],
  );
  const ARKADE_ACTION_IDS = useMemo(() => new Set(["start_arkade"]), []);

  const actionVisible = (id: string) => {
    if (!featuresReady && (EDGE_ACTION_IDS.has(id) || ARKADE_ACTION_IDS.has(id))) {
      return false;
    }
    if (EDGE_ACTION_IDS.has(id) && !edgeFeaturesEnabled) return false;
    if (ARKADE_ACTION_IDS.has(id) && !arkadeFeaturesEnabled) return false;
    return sidebarFlags[id] !== false;
  };

  const applySettings = (payload: SettingsPayload) => {
    setSidebarFlags(payload.sidebarActions ?? {});
    setEdgeFeaturesEnabled(payload.edgeFeaturesEnabled === true);
    setArkadeFeaturesEnabled(payload.arkadeFeaturesEnabled === true);
    const soundOn = payload.soundEffectsEnabled !== false;
    setSoundEffectsEnabledState(soundOn);
    setSoundEffectsEnabled(soundOn);
    setCustomAdbActions(payload.customAdbActions ?? []);
    if (payload.capturePath) setCapturePathHint(payload.capturePath);
    setFeaturesReady(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchSettings();
        if (!cancelled) applySettings(payload);
      } catch {
        /* defaults: all actions visible */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markRebooting = (ids: string[]) => {
    if (!ids.length) return;
    setRebootingIds((prev) => {
      const next = [...new Set([...prev, ...ids])];
      rebootingIdsRef.current = next;
      return next;
    });
    for (const id of ids) {
      window.setTimeout(() => {
        setRebootingIds((prev) => {
          const next = prev.filter((item) => item !== id);
          rebootingIdsRef.current = next;
          return next;
        });
        rebootingSeenOffline.current.delete(id);
      }, 120_000);
    }
  };

  const usedIds = useMemo(
    () => new Set(slots.filter(Boolean).map((slot) => (slot as SlotDevice).id)),
    [slots],
  );

  const addedDevices = useMemo(
    () => slots.filter((slot): slot is SlotDevice => slot !== null),
    [slots],
  );

  const addedAndroid = useMemo(
    () => addedDevices.filter((device) => device.platform === "android"),
    [addedDevices],
  );

  const addedAndroidIds = useMemo(() => addedAndroid.map((device) => device.id), [addedAndroid]);

  const actionsEnabled = addedAndroid.length > 0;

  const resolveActionTargets = (deviceIds: string[] | undefined): string[] | undefined => {
    if (!actionsEnabled) return [];
    if (deviceIds?.length) {
      const allowed = new Set(addedAndroidIds);
      return deviceIds.filter((id) => allowed.has(id));
    }
    return addedAndroidIds;
  };

  const refreshDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/devices");
      if (!response.ok) return;
      const payload = (await response.json()) as { devices: DeviceInfo[] };
      setAvailable(payload.devices);
      const liveIds = new Set(payload.devices.map((device) => device.id));

      setRebootingIds((current) => {
        if (!current.length) return current;
        const next: string[] = [];
        for (const id of current) {
          if (!liveIds.has(id)) {
            rebootingSeenOffline.current.add(id);
            next.push(id);
            continue;
          }
          if (rebootingSeenOffline.current.has(id)) {
            rebootingSeenOffline.current.delete(id);
            continue;
          }
          next.push(id);
        }
        rebootingIdsRef.current = next;
        return next;
      });

      setSlots((current) =>
        current.map((slot) => {
          if (!slot) return slot;
          const live = payload.devices.find((device) => device.id === slot.id);
          if (!live) return slot;
          const isRebooting = rebootingIdsRef.current.includes(slot.id);
          return {
            ...slot,
            name: live.name,
            model: live.model,
            appLabel: isRebooting ? "Rebooting…" : (live.appLabel ?? slot.appLabel),
            app: isRebooting
              ? { name: null, build: null, url: null, kind: null, package: null }
              : live.app?.name
                ? live.app
                : slot.app?.name
                  ? slot.app
                  : live.app,
            mockupId: live.mockupId || slot.mockupId,
            osVersion: live.osVersion ?? slot.osVersion,
          };
        }),
      );
    } catch {
      /* offline until backend starts */
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const timer = window.setInterval(refreshDevices, 1200);
    return () => window.clearInterval(timer);
  }, [refreshDevices]);

  useEffect(() => {
    if (!actionNote) return;
    const timer = window.setTimeout(() => setActionNote(null), 6000);
    return () => window.clearTimeout(timer);
  }, [actionNote]);

  const addDevice = (index: number, device: DeviceInfo) => {
    setSlots((current) => {
      const next = [...current];
      next[index] = makeSlot(device);
      return next;
    });
    setPickerIndex(null);
  };

  const appendSlot = () => {
    setSlots((current) => {
      const emptyIndex = current.findIndex((slot) => slot === null);
      if (emptyIndex >= 0) {
        window.setTimeout(() => setPickerIndex(emptyIndex), 0);
        return current;
      }
      window.setTimeout(() => setPickerIndex(current.length), 0);
      return [...current, null];
    });
  };

  const connectedCount = addedDevices.length;

  const removeSlot = (index: number) => {
    setSlots((current) => {
      const removed = current[index];
      if (removed && focusDeviceId === removed.id) {
        setFocusDeviceId(null);
        setFocusLocked(false);
      }
      const next = [...current];
      next.splice(index, 1);
      return next.length ? next : [null];
    });
  };

  const disconnectAll = () => {
    setSlots([null]);
    setPickerIndex(null);
    setModal(null);
    setRecordingDeviceId(null);
    setFocusDeviceId(null);
    setFocusLocked(false);
  };

  const exitFocusMode = useCallback(() => {
    setFocusDeviceId((current) => {
      if (!current) return current;
      playFocusModeSound(false);
      return null;
    });
    setFocusLocked(false);
  }, []);

  const enterFocusMode = () => {
    const first = addedDevices[0];
    if (!first) return;
    setFocusDeviceId(first.id);
    setFocusLocked(false);
    playFocusModeSound(true);
  };

  const onFocusHoverDevice = (deviceId: string) => {
    if (!focusDeviceId || focusLocked) return;
    setFocusDeviceId(deviceId);
  };

  const onFocusLockDevice = (deviceId: string) => {
    if (!focusDeviceId || focusLocked) return;
    setFocusDeviceId(deviceId);
    setFocusLocked(true);
  };

  recordingDeviceIdRef.current = recordingDeviceId;
  focusDeviceIdRef.current = focusDeviceId;
  actionBusyRef.current = actionBusy;
  modalRef.current = modal;

  const canReorder = connectedCount > 1;

  const reorderSlots = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setSlots((current) => {
      if (from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const onSlotDragStart = (index: number, event: DragEvent) => {
    setDragIndex(index);
    setDropIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  };

  const onSlotDragOver = (index: number, event: DragEvent) => {
    if (dragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropIndex !== index) setDropIndex(index);
  };

  const onSlotDragLeave = (index: number) => {
    if (dropIndex === index) setDropIndex(null);
  };

  const onSlotDrop = (index: number, event: DragEvent) => {
    event.preventDefault();
    const from = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
    if (Number.isFinite(from)) reorderSlots(from, index);
    setDragIndex(null);
    setDropIndex(null);
  };

  const onSlotDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const showResults = (label: string, results: ActionResult[]) => {
    setActionNote(`${label}: ${summarizeResults(results)}`);
  };

  const runStart = async (app: "edge" | "edge_develop", label: string) => {
    if (actionBusy || !actionsEnabled) return;
    setActionBusy(true);
    try {
      const payload = await startApp(app, addedAndroidIds);
      showResults(label, payload.results);
    } catch (error) {
      setActionNote(`${label}: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runArkade = async (url: string) => {
    if (actionBusy || !actionsEnabled) return;
    setActionBusy(true);
    try {
      const payload = await openUrl(url, addedAndroidIds);
      showResults("Arkade", payload.results);
      setModal(null);
    } catch (error) {
      setActionNote(`Arkade: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runEdgeAccount = async (opts: {
    username: string;
    password?: string;
    pin?: string;
    save: boolean;
  }) => {
    if (actionBusy || !actionsEnabled) return;
    setActionBusy(true);
    try {
      const payload = await startEdgeAccount({
        username: opts.username,
        password: opts.password,
        pin: opts.pin,
        save: opts.save,
        deviceIds: addedAndroidIds,
      });
      showResults("Edge account", payload.results);
      setModal(null);
    } catch (error) {
      setActionNote(`Edge account: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runOtherPwa = async (url: string) => {
    if (actionBusy || !actionsEnabled) return;
    setActionBusy(true);
    try {
      const payload = await openUrl(url, addedAndroidIds);
      showResults("PWA", payload.results);
      setModal(null);
    } catch (error) {
      setActionNote(`PWA: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runOtherApp = async (deviceIds: string[] | undefined, app: LaunchableApp) => {
    if (actionBusy || !actionsEnabled) return;
    setModal(null);
    setActionBusy(true);
    try {
      const payload = await startPackage(
        app.package,
        app.activity,
        resolveActionTargets(deviceIds),
      );
      showResults("Start app", payload.results);
    } catch (error) {
      setActionNote(`Start app: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runKillBackground = async (deviceIds: string[] | undefined) => {
    if (actionBusy || !actionsEnabled) return;
    setModal(null);
    setActionBusy(true);
    try {
      const payload = await killBackground(resolveActionTargets(deviceIds));
      showResults("Kill background", payload.results);
    } catch (error) {
      setActionNote(`Kill background: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runKillForeground = async (deviceIds: string[] | undefined) => {
    if (actionBusy || !actionsEnabled) return;
    setModal(null);
    setActionBusy(true);
    try {
      const payload = await killForeground(resolveActionTargets(deviceIds));
      showResults("Kill app", payload.results);
    } catch (error) {
      setActionNote(`Kill app: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runAirplane = async (enabled: boolean, deviceIds: string[] | undefined) => {
    if (actionBusy || !actionsEnabled) return;
    setModal(null);
    setActionBusy(true);
    try {
      const targets = resolveActionTargets(deviceIds);
      const payload = await setAirplaneMode(enabled, targets);
      showResults(enabled ? "Airplane ON" : "Airplane OFF", payload.results);
    } catch (error) {
      setActionNote(`Airplane: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runReboot = async (deviceIds: string[] | undefined) => {
    if (actionBusy || !actionsEnabled) return;
    setModal(null);
    setActionBusy(true);
    try {
      const targets = resolveActionTargets(deviceIds) ?? [];
      markRebooting(targets);
      const payload = await rebootDevices(targets);
      showResults("Reboot", payload.results);
    } catch (error) {
      setActionNote(`Reboot: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runScreenshot = async (deviceIds: string[] | undefined) => {
    if (actionBusy || !actionsEnabled) return;
    setModal(null);
    setActionBusy(true);
    try {
      const targets = resolveActionTargets(deviceIds) ?? [];
      const payload = await takeScreenshot(targets);
      const okIds = payload.results.filter((item) => item.ok).map((item) => item.deviceId);
      if (okIds.length) {
        playShutterSound();
        setFlashDeviceIds(okIds);
        window.setTimeout(() => setFlashDeviceIds([]), 450);
      }
      showResults("Screenshot", payload.results);
    } catch (error) {
      setActionNote(`Screenshot: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runVideoStart = async (deviceId: string) => {
    if (actionBusy || !actionsEnabled || !addedAndroidIds.includes(deviceId)) return;
    setModal(null);
    setActionBusy(true);
    try {
      await startScreenrecord(deviceId);
      setRecordingDeviceId(deviceId);
      setActionNote("Video: recording…");
      playRecSound(true);
    } catch (error) {
      setRecordingDeviceId(null);
      setActionNote(`Video: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  const runVideoStop = async (deviceId: string) => {
    if (actionBusy) return;
    // Drop Rec UI immediately; finalize save in the background.
    setRecordingDeviceId(null);
    recordingDeviceIdRef.current = null;
    playRecSound(false);
    setActionBusy(true);
    setActionNote("Video: saving…");
    try {
      const payload = await stopScreenrecord(deviceId);
      showResults("Video", payload.results);
    } catch (error) {
      setActionNote(`Video: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };
  runVideoStopRef.current = runVideoStop;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modalRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }

      const recordingId = recordingDeviceIdRef.current;
      if (recordingId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!actionBusyRef.current) {
          void runVideoStopRef.current(recordingId);
        }
        return;
      }

      // Focus Mode: Esc exits only when the pointer is not over a device stream
      // (when hovering a stream, DeviceStream still maps Esc → Android BACK).
      if (focusDeviceIdRef.current && !document.querySelector(".device-stream:hover")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exitFocusMode();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [exitFocusMode]);

  const runCustomAction = async (action: CustomAdbAction) => {
    if (actionBusy || !actionsEnabled) return;
    setActionBusy(true);
    try {
      const payload = await runCustomAdb(action.id, addedAndroidIds);
      showResults(action.label, (payload.results ?? []) as ActionResult[]);
    } catch (error) {
      setActionNote(`${action.label}: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="app">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <h1 className="site-title">QA Dashboard</h1>
            <ThemeToggle />
          </div>
          <p className="tagline">Manual testing · multi-device · scrcpy</p>
        </div>

        <div className="sidebar-status">
          <button
            type="button"
            className={`status-pill status-pill--button ${available.length ? "status-pill--live" : ""}`}
            onClick={() => setModal("devices")}
            title="Show connected devices"
          >
            <span className="status-dot" aria-hidden="true" />
            {available.length
              ? `${available.length} device${available.length === 1 ? "" : "s"} ready`
              : "No devices detected"}
          </button>
          <p className="header-note">USB · Android (adb) or iOS (libimobiledevice)</p>
        </div>

        <nav className="sidebar-actions" aria-label="Device actions">
          <div className="sidebar-actions__group">
            <p className="sidebar-actions__label">Launch</p>
            {actionVisible("start_edge") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => runStart("edge", "Start Edge")}
              >
                <ActionIcon name="play" />
                <span>Start Edge</span>
              </button>
            ) : null}
            {actionVisible("start_edge_account") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("edge-account")}
              >
                <ActionIcon name="user" />
                <span>Start Edge account</span>
              </button>
            ) : null}
            {actionVisible("start_edge_develop") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => runStart("edge_develop", "Start Edge Develop")}
              >
                <ActionIcon name="code" />
                <span>Start Edge Develop</span>
              </button>
            ) : null}
            {actionVisible("start_arkade") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("arkade")}
              >
                <ActionIcon name="wallet" />
                <span>Start Arkade</span>
              </button>
            ) : null}
            {actionVisible("start_other_pwa") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("pwa")}
              >
                <ActionIcon name="globe" />
                <span>Start other PWA</span>
              </button>
            ) : null}
            {actionVisible("start_other_app") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("other-app")}
              >
                <ActionIcon name="apps" />
                <span>Start other app</span>
              </button>
            ) : null}
          </div>

          <div className="sidebar-actions__group">
            <p className="sidebar-actions__label">Stop</p>
            {actionVisible("kill_background") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("kill-bg")}
              >
                <ActionIcon name="layers" />
                <span>Kill background apps</span>
              </button>
            ) : null}
            {actionVisible("kill_app") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("kill-fg")}
              >
                <ActionIcon name="stop" />
                <span>Kill app</span>
              </button>
            ) : null}
          </div>

          <div className="sidebar-actions__group">
            <p className="sidebar-actions__label">Capture</p>
            {actionVisible("screenshot") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("screenshot")}
              >
                <ActionIcon name="camera" />
                <span>Screenshot</span>
              </button>
            ) : null}
            {actionVisible("video") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("video")}
              >
                <ActionIcon name="video" />
                <span>Video recording</span>
              </button>
            ) : null}
          </div>

          <div className="sidebar-actions__group">
            <p className="sidebar-actions__label">Device</p>
            {actionVisible("reboot") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("reboot")}
              >
                <ActionIcon name="refresh" />
                <span>Reboot device</span>
              </button>
            ) : null}
            {actionVisible("airplane") ? (
              <button
                type="button"
                className="sidebar-action"
                disabled={actionBusy || !actionsEnabled}
                onClick={() => setModal("airplane")}
              >
                <ActionIcon name="airplane" />
                <span>Airplane Mode</span>
              </button>
            ) : null}
            {actionVisible("disconnect_all") ? (
              <button
                type="button"
                className="sidebar-action sidebar-action--danger"
                disabled={connectedCount === 0}
                onClick={disconnectAll}
              >
                <ActionIcon name="unplug" />
                <span>Disconnect all devices</span>
              </button>
            ) : null}
          </div>

          {customAdbActions.length > 0 ? (
            <div className="sidebar-actions__group">
              <p className="sidebar-actions__label">Custom ADB</p>
              {customAdbActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="sidebar-action"
                  disabled={actionBusy || !actionsEnabled}
                  title={action.args}
                  onClick={() => void runCustomAction(action)}
                >
                  <ActionIcon name="code" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          {actionNote ? <p className="sidebar-action-note">{actionNote}</p> : null}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-credit">
            <a
              className="sidebar-credit__link"
              href="https://davidcoen.it"
              target="_blank"
              rel="noreferrer"
            >
              davidcoen.it
            </a>
            <p className="sidebar-credit__meta">
              <span className="sidebar-credit__version">v{APP_VERSION}</span>
              <span className="sidebar-credit__sep" aria-hidden="true">
                ·
              </span>
              <a
                className="sidebar-credit__link sidebar-credit__link--meta"
                href={APP_REPO_URL}
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <span className="sidebar-credit__sep" aria-hidden="true">
                ·
              </span>
              <a
                className="sidebar-credit__link sidebar-credit__link--meta"
                href={APP_LICENSE_URL}
                target="_blank"
                rel="noreferrer"
              >
                MIT
              </a>
            </p>
          </div>
          <button
            type="button"
            className="sidebar-settings"
            onClick={() => setModal("settings")}
            title="Settings"
            aria-label="Settings"
          >
            <ActionIcon name="settings" className="sidebar-settings__icon" />
          </button>
        </div>
      </aside>

      <section
        className={[
          "workspace",
          focusDeviceId ? "workspace--focus-mode" : "",
          focusDeviceId && focusLocked ? "workspace--focus-locked" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Device workspace"
      >
        <div className="workspace-head">
          <h2 className="workspace-title">Devices</h2>
        </div>

        <div className="workspace-top-controls">
          {connectedCount > 0 ? (
            focusDeviceId ? (
              <button
                type="button"
                className="workspace-focus-badge"
                onClick={exitFocusMode}
                title="Exit Focus Mode"
                aria-label="Exit Focus Mode"
              >
                <span className="workspace-focus-badge__dot" aria-hidden="true" />
                Focus Mode Active
              </button>
            ) : (
              <button
                type="button"
                className="workspace-focus-toggle"
                onClick={enterFocusMode}
                title="Focus Mode"
                aria-label="Enter Focus Mode"
              >
                <ActionIcon name="focus" className="workspace-focus-toggle__icon" />
                <span>Focus</span>
              </button>
            )
          ) : null}

          {recordingDeviceId ? (
            <button
              type="button"
              className="workspace-stop-rec"
              disabled={actionBusy}
              onClick={() => runVideoStop(recordingDeviceId)}
              title="Stop recording"
              aria-label="Stop recording"
            >
              <ActionIcon name="stop" className="workspace-stop-rec__icon" />
              <span>Stop recording</span>
            </button>
          ) : addedAndroidIds.length > 0 ? (
            <button
              type="button"
              className="workspace-rec-toggle"
              disabled={actionBusy}
              onClick={() => setModal("video")}
              title="Start recording"
              aria-label="Start recording"
            >
              <span className="workspace-rec-toggle__dot" aria-hidden="true" />
              <span>Rec</span>
            </button>
          ) : null}
        </div>

        <div className="device-strip-outer">
          <div className="device-strip" aria-label="Connected devices">
            {slots.map((slot, index) =>
              slot ? (
                <DeviceSlot
                  key={slot.slotId}
                  device={slot}
                  onRemove={() => removeSlot(index)}
                  recording={recordingDeviceId === slot.id}
                  recordingActive={recordingDeviceId !== null}
                  flash={flashDeviceIds.includes(slot.id)}
                  rebooting={rebootingIds.includes(slot.id)}
                  focused={focusDeviceId === slot.id}
                  focusDimmed={focusDeviceId !== null && focusDeviceId !== slot.id}
                  onFocusHover={
                    focusDeviceId && !focusLocked
                      ? () => onFocusHoverDevice(slot.id)
                      : undefined
                  }
                  onFocusLock={
                    focusDeviceId && !focusLocked
                      ? () => onFocusLockDevice(slot.id)
                      : undefined
                  }
                  canReorder={canReorder}
                  dragging={dragIndex === index}
                  dropTarget={dragIndex !== null && dropIndex === index && dragIndex !== index}
                  onDragStartSlot={(event) => onSlotDragStart(index, event)}
                  onDragOverSlot={(event) => onSlotDragOver(index, event)}
                  onDragLeaveSlot={() => onSlotDragLeave(index)}
                  onDropSlot={(event) => onSlotDrop(index, event)}
                  onDragEndSlot={onSlotDragEnd}
                />
              ) : (
                <EmptyAddSlot key={`empty-${index}`} onClick={() => setPickerIndex(index)} />
              ),
            )}

            {connectedCount > 0 && !slots.some((slot) => slot === null) ? (
              <div className="add-device-wrap">
                <EmptyAddSlot ariaLabel="Add another device" onClick={appendSlot} />
              </div>
            ) : null}
          </div>
        </div>

        <p className="workspace-hint">
          Hover a screen to type · click to touch · drag handle to reorder · drag strip to scroll
        </p>
      </section>

      {pickerIndex !== null ? (
        <DevicePicker
          devices={available}
          usedIds={usedIds}
          onPick={(device) => addDevice(pickerIndex, device)}
          onClose={() => setPickerIndex(null)}
        />
      ) : null}

      {modal === "devices" ? (
        <DevicesReadyModal devices={available} onClose={() => setModal(null)} />
      ) : null}

      {modal === "arkade" && arkadeFeaturesEnabled ? (
        <ArkadeStartModal
          busy={actionBusy}
          deviceIds={addedAndroidIds}
          onConfirm={runArkade}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "edge-account" && edgeFeaturesEnabled ? (
        <EdgeAccountModal
          busy={actionBusy}
          deviceIds={addedAndroidIds}
          onConfirm={runEdgeAccount}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "settings" ? (
        <SettingsModal
          deviceIds={addedAndroidIds}
          edgeFeaturesEnabled={edgeFeaturesEnabled}
          arkadeFeaturesEnabled={arkadeFeaturesEnabled}
          soundEffectsEnabled={soundEffectsEnabled}
          onClose={() => setModal(null)}
          onSaved={(payload) => applySettings(payload)}
        />
      ) : null}

      {modal === "pwa" ? (
        <OpenUrlModal
          title="Start other PWA"
          description="Paste any PWA / web URL. Chrome will open it on every Android device added to the dashboard."
          confirmLabel="Open on devices"
          busy={actionBusy}
          onConfirm={runOtherPwa}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "other-app" ? (
        <StartOtherAppModal
          devices={addedAndroid}
          busy={actionBusy}
          onConfirm={runOtherApp}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "kill-bg" ? (
        <DeviceTargetModal
          title="Kill background apps"
          description="Force-stops background user apps and removes them from the multitasking/recents list."
          confirmLabel="Force-stop background"
          devices={addedAndroid}
          busy={actionBusy}
          onConfirm={runKillBackground}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "kill-fg" ? (
        <DeviceTargetModal
          title="Kill app"
          description="Force-stops the foreground app and removes it from the multitasking/recents list."
          confirmLabel="Force-stop app"
          devices={addedAndroid}
          busy={actionBusy}
          onConfirm={runKillForeground}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "airplane" ? (
        <AirplaneModeModal
          devices={addedAndroid}
          busy={actionBusy}
          onConfirm={runAirplane}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "reboot" ? (
        <DeviceTargetModal
          title="Reboot device"
          description="Reboots the selected Android device(s). They will disconnect until USB is ready again."
          confirmLabel="Reboot"
          devices={addedAndroid}
          busy={actionBusy}
          danger
          onConfirm={runReboot}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "screenshot" ? (
        <DeviceTargetModal
          title="Screenshot"
          description={`Saves a PNG under ${capturePathHint}.`}
          confirmLabel="Capture"
          devices={addedAndroid}
          busy={actionBusy}
          onConfirm={runScreenshot}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === "video" ? (
        <VideoRecordModal
          devices={addedAndroid}
          busy={actionBusy}
          onStart={runVideoStart}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}
