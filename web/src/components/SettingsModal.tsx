import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  changeMasterPassword,
  deleteEdgeAccountVault,
  fetchSettings,
  saveEdgeAccountCredentials,
  saveSettings,
  unlockVault,
  type CustomAdbAction,
  type SettingsPayload,
  type SidebarActionDef,
  type StreamQuality,
  STREAM_QUALITY_OPTIONS,
} from "../api/settings";
import {
  applyAppearance,
  CUSTOM_COLOR_SWATCHES,
  LIQUID_WALLPAPER,
  loadAppearance,
  saveAppearance,
  type AppearanceId,
  type AppearanceState,
  type BgKind,
  type LiquidBgKind,
} from "../appearance";
import { useDialogModal } from "../hooks/useDialogModal";

interface SettingsModalProps {
  onClose: () => void;
  onSaved?: (settings: SettingsPayload) => void;
  deviceIds?: string[];
  /** Current App values — avoid off→on flash before settings fetch completes. */
  edgeFeaturesEnabled?: boolean;
  arkadeFeaturesEnabled?: boolean;
  soundEffectsEnabled?: boolean;
}

type SettingsSnapshot = {
  capturePath: string;
  vaultPath: string;
  edgeFeaturesEnabled: boolean;
  arkadeFeaturesEnabled: boolean;
  soundEffectsEnabled: boolean;
  streamQuality: StreamQuality;
  sidebarActions: Record<string, boolean>;
  sidebarGroupOrder: string[];
  customActions: CustomAdbAction[];
};

const EDGE_ACTION_IDS = new Set(["start_edge", "start_edge_account", "start_edge_develop"]);
const ARKADE_ACTION_IDS = new Set(["start_arkade"]);
const CUSTOM_ADB_GROUP = "Custom ADB";

function normalizeStreamQuality(raw: unknown): StreamQuality {
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "high_30" || raw === "ultra") {
    return raw;
  }
  return "high";
}

function snapshotOf(parts: SettingsSnapshot): string {
  return JSON.stringify({
    capturePath: parts.capturePath.trim(),
    vaultPath: parts.vaultPath.trim(),
    edgeFeaturesEnabled: parts.edgeFeaturesEnabled,
    arkadeFeaturesEnabled: parts.arkadeFeaturesEnabled,
    soundEffectsEnabled: parts.soundEffectsEnabled,
    streamQuality: parts.streamQuality,
    sidebarActions: parts.sidebarActions,
    sidebarGroupOrder: parts.sidebarGroupOrder,
    customActions: parts.customActions.map((item) => ({
      id: item.id,
      label: item.label,
      args: item.args,
    })),
  });
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className={`settings-switch ${checked ? "is-on" : ""}`}>
      <span className="settings-switch__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="settings-switch__track"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch__thumb" aria-hidden="true" />
      </button>
    </label>
  );
}

function ToggleList({ children }: { children: ReactNode }) {
  return <div className="settings-toggle-list">{children}</div>;
}

export function SettingsModal({
  onClose,
  onSaved,
  deviceIds,
  edgeFeaturesEnabled: edgeInit = false,
  arkadeFeaturesEnabled: arkadeInit = false,
  soundEffectsEnabled: soundInit = true,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);

  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const baselineRef = useRef<string>("");

  const [capturePath, setCapturePath] = useState("~/Immagini/Schermate");
  const [vaultPath, setVaultPath] = useState("~/.config/qa-dashboard/edge-accounts.vault");
  const [edgeFeaturesEnabled, setEdgeFeaturesEnabled] = useState(edgeInit);
  const [arkadeFeaturesEnabled, setArkadeFeaturesEnabled] = useState(arkadeInit);
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(soundInit);
  const [appearance, setAppearance] = useState<AppearanceState>(() => loadAppearance());
  const [imageError, setImageError] = useState<string | null>(null);
  const [streamQuality, setStreamQuality] = useState<StreamQuality>("high");
  const [sidebarActions, setSidebarActions] = useState<Record<string, boolean>>({});
  const [sidebarGroupOrder, setSidebarGroupOrder] = useState<string[]>([]);
  const [sidebarDefs, setSidebarDefs] = useState<SidebarActionDef[]>([]);
  const [customActions, setCustomActions] = useState<CustomAdbAction[]>([]);
  const [hasMasterPassword, setHasMasterPassword] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(true);
  const [vaultEncryption, setVaultEncryption] = useState("");

  const [accounts, setAccounts] = useState<
    Array<{ username: string; hasPassword?: boolean; hasPin?: boolean }>
  >([]);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPin, setNewPin] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [currentMaster, setCurrentMaster] = useState("");
  const [newMaster, setNewMaster] = useState("");
  const [confirmMaster, setConfirmMaster] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");

  const updateAppearance = (patch: Partial<AppearanceState>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      saveAppearance(next);
      applyAppearance(next);
      return next;
    });
  };

  const onPickAppearance = (id: AppearanceId) => {
    updateAppearance({ id });
    setImageError(null);
  };

  const onPickBgKind = (bgKind: BgKind) => {
    updateAppearance({ id: "custom", bgKind });
  };

  const onPickBgColor = (bgColor: string) => {
    if (appearance.id === "liquid") {
      updateAppearance({ id: "liquid", liquidBgKind: "color", bgColor });
    } else {
      updateAppearance({ id: "custom", bgKind: "color", bgColor });
    }
  };

  const onPickLiquidBgKind = (liquidBgKind: LiquidBgKind) => {
    updateAppearance({ id: "liquid", liquidBgKind });
  };

  const onPickBgImage = (file: File | null, forLiquid: boolean) => {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Choose an image file (PNG, JPEG, WebP…).");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setImageError("Image is too large (max ~2.5 MB for local storage).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const bgImage = typeof reader.result === "string" ? reader.result : null;
      if (!bgImage) {
        setImageError("Could not read the image.");
        return;
      }
      if (forLiquid) {
        updateAppearance({ id: "liquid", liquidBgKind: "image", bgImage });
      } else {
        updateAppearance({ id: "custom", bgKind: "image", bgImage });
      }
    };
    reader.onerror = () => setImageError("Could not read the image.");
    reader.readAsDataURL(file);
  };

  const rememberBaseline = (
    nextCapture: string,
    nextVault: string,
    nextEdge: boolean,
    nextArkade: boolean,
    nextSound: boolean,
    nextQuality: StreamQuality,
    nextFlags: Record<string, boolean>,
    nextGroupOrder: string[],
    nextCustoms: CustomAdbAction[],
  ) => {
    baselineRef.current = snapshotOf({
      capturePath: nextCapture,
      vaultPath: nextVault,
      edgeFeaturesEnabled: nextEdge,
      arkadeFeaturesEnabled: nextArkade,
      soundEffectsEnabled: nextSound,
      streamQuality: nextQuality,
      sidebarActions: nextFlags,
      sidebarGroupOrder: nextGroupOrder,
      customActions: nextCustoms,
    });
  };

  const applySettings = (payload: SettingsPayload, asBaseline = true) => {
    const soundOn = payload.soundEffectsEnabled !== false;
    const quality = normalizeStreamQuality(payload.streamQuality);
    const groupOrder = payload.sidebarGroupOrder?.length
      ? payload.sidebarGroupOrder
      : ["Launch", "Stop", "Capture", "Device", CUSTOM_ADB_GROUP];
    setCapturePath(payload.capturePath);
    setVaultPath(payload.vaultPath);
    setEdgeFeaturesEnabled(payload.edgeFeaturesEnabled === true);
    setArkadeFeaturesEnabled(payload.arkadeFeaturesEnabled === true);
    setSoundEffectsEnabled(soundOn);
    setStreamQuality(quality);
    setSidebarActions(payload.sidebarActions);
    setSidebarGroupOrder(groupOrder);
    setSidebarDefs(payload.sidebarActionDefs);
    setCustomActions(payload.customAdbActions);
    setHasMasterPassword(Boolean(payload.vault?.hasMasterPassword));
    setVaultUnlocked(payload.vault?.unlocked !== false);
    setVaultEncryption(payload.vault?.encryption ?? "");
    if (payload.vaultAccounts) {
      setAccounts(
        payload.vaultAccounts.map((item) => ({
          username: item.username,
          hasPassword: item.hasPassword,
          hasPin: item.hasPin,
        })),
      );
    }
    if (asBaseline) {
      rememberBaseline(
        payload.capturePath,
        payload.vaultPath,
        payload.edgeFeaturesEnabled === true,
        payload.arkadeFeaturesEnabled === true,
        soundOn,
        quality,
        payload.sidebarActions,
        groupOrder,
        payload.customAdbActions,
      );
    }
  };

  const isDirty = useMemo(() => {
    if (!ready) return false;
    const current = snapshotOf({
      capturePath,
      vaultPath,
      edgeFeaturesEnabled,
      arkadeFeaturesEnabled,
      soundEffectsEnabled,
      streamQuality,
      sidebarActions,
      sidebarGroupOrder,
      customActions,
    });
    if (current !== baselineRef.current) return true;
    if (newMaster.trim() || currentMaster.trim() || confirmMaster.trim()) return true;
    return false;
  }, [
    ready,
    capturePath,
    vaultPath,
    edgeFeaturesEnabled,
    arkadeFeaturesEnabled,
    soundEffectsEnabled,
    streamQuality,
    sidebarActions,
    sidebarGroupOrder,
    customActions,
    newMaster,
    currentMaster,
    confirmMaster,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchSettings();
        if (cancelled) return;
        applySettings(payload, true);
        setReady(true);
        onSaved?.(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load settings");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistCore = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving || !isDirty) return;
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      if (newMaster.trim()) {
        if (newMaster !== confirmMaster) {
          throw new Error("New master password confirmation does not match");
        }
        if (hasMasterPassword && !currentMaster) {
          throw new Error("Current master password required");
        }
        await changeMasterPassword({
          currentPassword: hasMasterPassword ? currentMaster : undefined,
          newPassword: newMaster,
        });
        setCurrentMaster("");
        setNewMaster("");
        setConfirmMaster("");
      }

      const payload = await saveSettings({
        capturePath: capturePath.trim(),
        vaultPath: vaultPath.trim(),
        edgeFeaturesEnabled,
        arkadeFeaturesEnabled,
        soundEffectsEnabled,
        streamQuality,
        sidebarActions,
        sidebarGroupOrder,
        customAdbActions: customActions,
      });
      applySettings(payload, true);
      onSaved?.(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addAccount = async () => {
    const user = newUser.trim();
    const pinValue = newPin.trim();
    if (!user || saving) return;
    if (!newPass && !/^\d{4,8}$/.test(pinValue)) return;
    setSaving(true);
    setError(null);
    try {
      await saveEdgeAccountCredentials(
        user,
        newPass || undefined,
        /^\d{4,8}$/.test(pinValue) ? pinValue : undefined,
      );
      setAccounts((prev) => {
        const next = {
          username: user,
          hasPassword: Boolean(newPass),
          hasPin: /^\d{4,8}$/.test(pinValue),
        };
        const without = prev.filter((item) => item.username !== user);
        return [...without, next].sort((a, b) => a.username.localeCompare(b.username));
      });
      setNewUser("");
      setNewPass("");
      setNewPin("");
      setNote("Account saved encrypted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save account");
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (username: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await deleteEdgeAccountVault(username, deviceIds);
      setAccounts((prev) => prev.filter((item) => item.username !== username));
      const deviceOk = (result.deviceResults || []).filter((item) => item.ok);
      const deviceFail = (result.deviceResults || []).filter((item) => !item.ok);
      if (deviceFail.length && !deviceOk.length) {
        setNote(
          `Removed ${username} from vault; device forget failed: ${
            deviceFail[0]?.detail || "unknown error"
          }`,
        );
      } else if (deviceOk.length) {
        const detail = deviceOk[0]?.detail || "forgot on device";
        setNote(`Removed ${username} from vault and Edge (${detail})`);
      } else {
        setNote(`Removed ${username} from vault`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setSaving(false);
    }
  };

  const addCustomAction = () => {
    const label = customLabel.trim();
    const args = customArgs.trim();
    if (!label || !args) return;
    setCustomActions((prev) => [...prev, { id: crypto.randomUUID(), label, args }]);
    setCustomLabel("");
    setCustomArgs("");
  };

  const removeCustomAction = (id: string) => {
    setCustomActions((prev) => prev.filter((item) => item.id !== id));
  };

  const doUnlock = async () => {
    if (!unlockPassword || saving) return;
    setSaving(true);
    setError(null);
    try {
      const vault = await unlockVault(unlockPassword);
      setVaultUnlocked(vault.unlocked !== false);
      setUnlockPassword("");
      const payload = await fetchSettings();
      applySettings(payload);
      setNote("Vault unlocked for this session");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setSaving(false);
    }
  };

  const groups = sidebarDefs.reduce<Record<string, SidebarActionDef[]>>((acc, def) => {
    if (EDGE_ACTION_IDS.has(def.id) || ARKADE_ACTION_IDS.has(def.id)) return acc;
    (acc[def.group] ??= []).push(def);
    return acc;
  }, {});

  const orderedToggleGroups = useMemo(() => {
    const names = sidebarGroupOrder.filter((name) => name !== CUSTOM_ADB_GROUP && groups[name]);
    for (const name of Object.keys(groups)) {
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }, [sidebarGroupOrder, groups]);

  const moveGroup = (index: number, delta: number) => {
    setSidebarGroupOrder((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  const edgeActionDefs = sidebarDefs.filter((def) => EDGE_ACTION_IDS.has(def.id));
  const arkadeActionDefs = sidebarDefs.filter((def) => ARKADE_ACTION_IDS.has(def.id));

  return (
    <dialog ref={dialogRef} className="device-picker settings-modal" onClose={onClose}>
      <form
        className="device-picker__panel settings-modal__panel"
        onSubmit={(event) => void persistCore(event)}
      >
        <header className="settings-modal__header">
          <h3>Settings</h3>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="settings-modal__body">
          {error ? <p className="settings-error">{error}</p> : null}
          {note ? <p className="settings-note">{note}</p> : null}

          <div className="settings-sections">
            <section className="settings-section">
              <h4>General</h4>
              <p className="picker-empty">Workspace feedback, stream quality, and where captures are saved.</p>
              <label className="modal-field">
                <span className="modal-field__label">Capture path</span>
                <input
                  className="modal-input"
                  value={capturePath}
                  onChange={(event) => setCapturePath(event.target.value)}
                  spellCheck={false}
                  disabled={saving}
                />
              </label>
              <p className="settings-hint">
                Screenshots and screen recordings. Screenshots are also copied to the system clipboard
                when <code>wl-copy</code> or <code>xclip</code> is available.
              </p>
              <p className="modal-field__label" style={{ marginTop: "0.85rem" }}>
                Stream quality
              </p>
              <div className="settings-quality" role="radiogroup" aria-label="Stream quality">
                {STREAM_QUALITY_OPTIONS.map((option) => {
                  const selected = streamQuality === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`settings-quality__option${selected ? " is-selected" : ""}`}
                      disabled={saving || !ready}
                      onClick={() => setStreamQuality(option.id)}
                    >
                      <span className="settings-quality__name">{option.label}</span>
                      <span className="settings-quality__hint">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
              <p className="settings-hint">
                Applies to new Android mirrors. Re-add a device (or refresh its stream) to use the
                new quality.
              </p>
              <ToggleList>
                <ToggleSwitch
                  label="Sound effects"
                  checked={soundEffectsEnabled}
                  disabled={saving || !ready}
                  onChange={setSoundEffectsEnabled}
                />
              </ToggleList>
              <p className="settings-hint">Focus Mode, Rec, and screenshot sounds.</p>
            </section>

            <section className="settings-section">
              <h4>Appearance</h4>
              <p className="picker-empty">
                Workspace look. Default keeps the classic chrome; Liquid is translucent glass (uses
                the sidebar light / dark toggle); Custom sets only the background.
              </p>
              <div className="settings-appearance">
                <div className="settings-appearance__options" role="radiogroup" aria-label="Theme">
                  {(
                    [
                      {
                        id: "default" as const,
                        name: "Default",
                        hint: "Classic light / dark surfaces",
                      },
                      {
                        id: "liquid" as const,
                        name: "Liquid",
                        hint: "Glass chrome; pick wallpaper, color, or image",
                      },
                      {
                        id: "custom" as const,
                        name: "Custom",
                        hint: "Your color or image as background",
                      },
                    ] as const
                  ).map((option) => {
                    const selected = appearance.id === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`settings-appearance__option${selected ? " is-selected" : ""}`}
                        onClick={() => onPickAppearance(option.id)}
                      >
                        <span className="settings-appearance__name">{option.name}</span>
                        <span className="settings-appearance__hint">{option.hint}</span>
                      </button>
                    );
                  })}
                </div>

                {appearance.id === "liquid" ? (
                  <div className="settings-appearance__custom">
                    <p className="settings-hint" style={{ marginBottom: "0.45rem" }}>
                      Glass materials follow{" "}
                      <a
                        href="https://developer.apple.com/documentation/technologyoverviews/liquid-glass"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Liquid Glass
                      </a>
                      . Light / dark is controlled from the sidebar toggle.
                    </p>
                    <div
                      className="settings-appearance__kind"
                      role="group"
                      aria-label="Liquid background"
                    >
                      <button
                        type="button"
                        className={appearance.liquidBgKind === "wallpaper" ? "is-selected" : ""}
                        onClick={() => onPickLiquidBgKind("wallpaper")}
                      >
                        Wallpaper
                      </button>
                      <button
                        type="button"
                        className={appearance.liquidBgKind === "color" ? "is-selected" : ""}
                        onClick={() => onPickLiquidBgKind("color")}
                      >
                        Color
                      </button>
                      <button
                        type="button"
                        className={appearance.liquidBgKind === "image" ? "is-selected" : ""}
                        onClick={() => onPickLiquidBgKind("image")}
                      >
                        Image
                      </button>
                    </div>

                    {appearance.liquidBgKind === "wallpaper" ? (
                      <div
                        className="settings-appearance__preview"
                        style={{ backgroundImage: `url(${LIQUID_WALLPAPER})` }}
                        aria-label="Bundled Liquid wallpaper preview"
                      />
                    ) : null}

                    {appearance.liquidBgKind === "color" ? (
                      <>
                        <p className="modal-field__label">Color map</p>
                        <div className="settings-color-map" role="listbox" aria-label="Background colors">
                          {CUSTOM_COLOR_SWATCHES.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              role="option"
                              aria-selected={appearance.bgColor === hex}
                              aria-label={hex}
                              className={`settings-color-swatch${
                                appearance.bgColor === hex ? " is-selected" : ""
                              }`}
                              style={{ background: hex }}
                              onClick={() => onPickBgColor(hex)}
                            />
                          ))}
                        </div>
                        <div className="settings-color-row">
                          <input
                            type="color"
                            value={appearance.bgColor}
                            aria-label="Background color"
                            onChange={(event) => onPickBgColor(event.target.value)}
                          />
                          <code>{appearance.bgColor}</code>
                        </div>
                      </>
                    ) : null}

                    {appearance.liquidBgKind === "image" ? (
                      <>
                        <label className="modal-field">
                          <span className="modal-field__label">Background image</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) =>
                              onPickBgImage(event.target.files?.[0] ?? null, true)
                            }
                          />
                        </label>
                        {appearance.bgImage ? (
                          <div
                            className="settings-appearance__preview"
                            style={{ backgroundImage: `url(${appearance.bgImage})` }}
                            aria-label="Background preview"
                          />
                        ) : (
                          <p className="settings-hint">No image selected yet.</p>
                        )}
                        {imageError ? <p className="settings-error">{imageError}</p> : null}
                      </>
                    ) : null}
                  </div>
                ) : null}

                {appearance.id === "custom" ? (
                  <div className="settings-appearance__custom">
                    <div className="settings-appearance__kind" role="group" aria-label="Background type">
                      <button
                        type="button"
                        className={appearance.bgKind === "color" ? "is-selected" : ""}
                        onClick={() => onPickBgKind("color")}
                      >
                        Color
                      </button>
                      <button
                        type="button"
                        className={appearance.bgKind === "image" ? "is-selected" : ""}
                        onClick={() => onPickBgKind("image")}
                      >
                        Image
                      </button>
                    </div>

                    {appearance.bgKind === "color" ? (
                      <>
                        <p className="modal-field__label">Color map</p>
                        <div className="settings-color-map" role="listbox" aria-label="Background colors">
                          {CUSTOM_COLOR_SWATCHES.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              role="option"
                              aria-selected={appearance.bgColor === hex}
                              aria-label={hex}
                              className={`settings-color-swatch${
                                appearance.bgColor === hex ? " is-selected" : ""
                              }`}
                              style={{ background: hex }}
                              onClick={() => onPickBgColor(hex)}
                            />
                          ))}
                        </div>
                        <div className="settings-color-row">
                          <input
                            type="color"
                            value={appearance.bgColor}
                            aria-label="Custom color"
                            onChange={(event) => onPickBgColor(event.target.value)}
                          />
                          <code>{appearance.bgColor}</code>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="modal-field">
                          <span className="modal-field__label">Background image</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) =>
                              onPickBgImage(event.target.files?.[0] ?? null, false)
                            }
                          />
                        </label>
                        {appearance.bgImage ? (
                          <div
                            className="settings-appearance__preview"
                            style={{ backgroundImage: `url(${appearance.bgImage})` }}
                            aria-label="Background preview"
                          />
                        ) : (
                          <p className="settings-hint">No image selected yet.</p>
                        )}
                        {imageError ? <p className="settings-error">{imageError}</p> : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="settings-section">
              <h4>Sidebar actions</h4>
              <p className="picker-empty">Choose which buttons appear in the left sidebar.</p>

              <p className="settings-group-label">Group order</p>
              <p className="settings-hint" style={{ marginBottom: "0.55rem" }}>
                Move groups up or down to change their position in the sidebar.
              </p>
              {sidebarGroupOrder.length === 0 ? (
                <p className="picker-empty">Loading…</p>
              ) : (
                <ul className="settings-group-order">
                  {sidebarGroupOrder.map((group, index) => (
                    <li key={group} className="settings-group-order__row">
                      <span className="settings-group-order__name">{group}</span>
                      <span className="settings-group-order__actions">
                        <button
                          type="button"
                          className="modal-btn modal-btn--ghost settings-group-order__btn"
                          disabled={saving || index === 0}
                          onClick={() => moveGroup(index, -1)}
                          aria-label={`Move ${group} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="modal-btn modal-btn--ghost settings-group-order__btn"
                          disabled={saving || index === sidebarGroupOrder.length - 1}
                          onClick={() => moveGroup(index, 1)}
                          aria-label={`Move ${group} down`}
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {orderedToggleGroups.length === 0 ? (
                <p className="picker-empty">Loading action list…</p>
              ) : (
                orderedToggleGroups.map((group) => (
                  <div key={group} className="settings-flags-group">
                    <p className="settings-group-label">{group}</p>
                    <ToggleList>
                      {(groups[group] ?? []).map((def) => (
                        <ToggleSwitch
                          key={def.id}
                          label={def.label}
                          checked={sidebarActions[def.id] !== false}
                          disabled={saving}
                          onChange={(next) =>
                            setSidebarActions((prev) => ({
                              ...prev,
                              [def.id]: next,
                            }))
                          }
                        />
                      ))}
                    </ToggleList>
                  </div>
                ))
              )}

              <div className="settings-flags-group">
                <p className="settings-group-label">Custom ADB</p>
                <p className="picker-empty" style={{ marginBottom: "0.55rem" }}>
                  Args after device serial, e.g. <code>shell pm clear co.edgesecure.app</code>
                </p>
                <ul className="picker-list settings-row-list">
                  {customActions.length === 0 ? (
                    <li className="picker-empty settings-row-list__empty">No custom actions yet</li>
                  ) : (
                    customActions.map((action) => (
                      <li key={action.id} className="settings-row">
                        <div className="settings-row__main">
                          <span className="settings-row__title">{action.label}</span>
                          <span className="settings-row__meta">{action.args}</span>
                        </div>
                        <button
                          type="button"
                          className="edge-account-remove"
                          onClick={() => removeCustomAction(action.id)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="settings-inline settings-inline--stack">
                  <input
                    className="modal-input"
                    placeholder="Label"
                    value={customLabel}
                    onChange={(event) => setCustomLabel(event.target.value)}
                    disabled={saving}
                  />
                  <input
                    className="modal-input"
                    placeholder="shell …"
                    value={customArgs}
                    onChange={(event) => setCustomArgs(event.target.value)}
                    spellCheck={false}
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="modal-btn"
                    disabled={!customLabel.trim() || !customArgs.trim()}
                    onClick={addCustomAction}
                  >
                    Add action
                  </button>
                </div>
              </div>
            </section>

            <section className="settings-section settings-section--edge">
              <details className="settings-dropdown">
                <summary className="settings-dropdown__summary">
                  <span>Edge</span>
                  <span className="settings-dropdown__hint">
                    {edgeFeaturesEnabled ? "Enabled" : "Disabled"}
                  </span>
                </summary>
                <div className="settings-dropdown__body">
                  {!ready ? (
                    <p className="picker-empty">Loading…</p>
                  ) : (
                    <>
                      <p className="picker-empty">
                        Turn off for non-Edge QA so Start Edge / vault stay hidden.
                      </p>
                      <ToggleList>
                        <ToggleSwitch
                          label="Enable Edge actions & vault"
                          checked={edgeFeaturesEnabled}
                          disabled={saving}
                          onChange={setEdgeFeaturesEnabled}
                        />
                      </ToggleList>

                      {edgeFeaturesEnabled ? (
                        <>
                          <p className="settings-group-label">Sidebar Edge actions</p>
                          <ToggleList>
                            {edgeActionDefs.map((def) => (
                              <ToggleSwitch
                                key={def.id}
                                label={def.label}
                                checked={sidebarActions[def.id] !== false}
                                disabled={saving}
                                onChange={(next) =>
                                  setSidebarActions((prev) => ({
                                    ...prev,
                                    [def.id]: next,
                                  }))
                                }
                              />
                            ))}
                          </ToggleList>

                          <h5 className="settings-subheading">Encrypted accounts</h5>
                          <p className="picker-empty">
                            Usernames only — passwords/PINs never shown.
                            {vaultEncryption ? ` ${vaultEncryption}` : ""}
                          </p>
                          {hasMasterPassword && !vaultUnlocked ? (
                            <div className="settings-inline">
                              <input
                                className="modal-input"
                                type="password"
                                placeholder="Master password to unlock"
                                value={unlockPassword}
                                onChange={(event) => setUnlockPassword(event.target.value)}
                                disabled={saving}
                              />
                              <button
                                type="button"
                                className="modal-btn modal-btn--primary"
                                onClick={() => void doUnlock()}
                                disabled={saving || !unlockPassword}
                              >
                                Unlock
                              </button>
                            </div>
                          ) : null}
                          <ul className="picker-list settings-row-list">
                            {accounts.length === 0 ? (
                              <li className="picker-empty settings-row-list__empty">No saved accounts</li>
                            ) : (
                              accounts.map((account) => (
                                <li key={account.username} className="settings-row">
                                  <div className="settings-row__main">
                                    <span className="settings-row__title">{account.username}</span>
                                    <span className="settings-row__meta">
                                      {[
                                        account.hasPassword ? "password" : null,
                                        account.hasPin ? "PIN" : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") || "Saved locally"}{" "}
                                      · encrypted
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="edge-account-remove"
                                    disabled={saving}
                                    title="Remove from vault and forget on connected devices"
                                    onClick={() => void removeAccount(account.username)}
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                          <div className="settings-inline settings-inline--stack">
                            <input
                              className="modal-input"
                              placeholder="Username"
                              value={newUser}
                              onChange={(event) => setNewUser(event.target.value)}
                              autoComplete="off"
                              disabled={saving}
                            />
                            <input
                              className="modal-input"
                              type="password"
                              placeholder="Password (optional if PIN set)"
                              value={newPass}
                              onChange={(event) => setNewPass(event.target.value)}
                              autoComplete="off"
                              disabled={saving}
                            />
                            <input
                              className="modal-input"
                              type="password"
                              inputMode="numeric"
                              placeholder="PIN 4–8 digits (for local re-login)"
                              value={newPin}
                              onChange={(event) =>
                                setNewPin(event.target.value.replace(/\D/g, "").slice(0, 8))
                              }
                              autoComplete="off"
                              disabled={saving}
                            />
                            <button
                              type="button"
                              className="modal-btn modal-btn--primary"
                              disabled={
                                saving ||
                                !newUser.trim() ||
                                (!newPass && !/^\d{4,8}$/.test(newPin.trim()))
                              }
                              onClick={() => void addAccount()}
                            >
                              Add account
                            </button>
                          </div>

                          <h5 className="settings-subheading">Vault archive</h5>
                          <label className="modal-field">
                            <span className="modal-field__label">Vault path</span>
                            <input
                              className="modal-input"
                              value={vaultPath}
                              onChange={(event) => setVaultPath(event.target.value)}
                              spellCheck={false}
                              disabled={saving}
                            />
                          </label>
                          <p className="modal-field__label">Master password</p>
                          {hasMasterPassword ? (
                            <label className="modal-field">
                              <span className="modal-field__label">Current</span>
                              <input
                                className="modal-input"
                                type="password"
                                value={currentMaster}
                                onChange={(event) => setCurrentMaster(event.target.value)}
                                disabled={saving}
                              />
                            </label>
                          ) : null}
                          <label className="modal-field">
                            <span className="modal-field__label">
                              {hasMasterPassword ? "New (leave empty to clear)" : "Set master password"}
                            </span>
                            <input
                              className="modal-input"
                              type="password"
                              value={newMaster}
                              onChange={(event) => setNewMaster(event.target.value)}
                              disabled={saving}
                            />
                          </label>
                          <label className="modal-field">
                            <span className="modal-field__label">Confirm new</span>
                            <input
                              className="modal-input"
                              type="password"
                              value={confirmMaster}
                              onChange={(event) => setConfirmMaster(event.target.value)}
                              disabled={saving}
                            />
                          </label>
                          <p className="picker-empty">
                            Use Save settings to apply path and master password changes.
                          </p>
                        </>
                      ) : (
                        <p className="picker-empty" style={{ marginTop: "0.65rem" }}>
                          Edge Launch buttons and the credential vault are hidden in the dashboard.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </details>
            </section>

            <section className="settings-section settings-section--arkade">
              <details className="settings-dropdown">
                <summary className="settings-dropdown__summary">
                  <span>Arkade</span>
                  <span className="settings-dropdown__hint">
                    {arkadeFeaturesEnabled ? "Enabled" : "Disabled"}
                  </span>
                </summary>
                <div className="settings-dropdown__body">
                  {!ready ? (
                    <p className="picker-empty">Loading…</p>
                  ) : (
                    <>
                      <p className="picker-empty">
                        Turn off for non-Arkade QA so Start Arkade stays hidden.
                      </p>
                      <ToggleList>
                        <ToggleSwitch
                          label="Enable Arkade actions"
                          checked={arkadeFeaturesEnabled}
                          disabled={saving}
                          onChange={setArkadeFeaturesEnabled}
                        />
                        {arkadeFeaturesEnabled
                          ? arkadeActionDefs.map((def) => (
                              <ToggleSwitch
                                key={def.id}
                                label={def.label}
                                checked={sidebarActions[def.id] !== false}
                                disabled={saving}
                                onChange={(next) =>
                                  setSidebarActions((prev) => ({
                                    ...prev,
                                    [def.id]: next,
                                  }))
                                }
                              />
                            ))
                          : null}
                      </ToggleList>
                      {!arkadeFeaturesEnabled ? (
                        <p className="picker-empty" style={{ marginTop: "0.65rem" }}>
                          Start Arkade is hidden in the dashboard.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </details>
            </section>

            <section className="settings-section settings-section--shortcuts">
              <h4>Keyboard shortcuts</h4>
              <dl className="settings-shortcuts">
                <div>
                  <dt>Hold Space 1s</dt>
                  <dd>Screenshot</dd>
                </div>
                <div>
                  <dt>Shift+Space</dt>
                  <dd>Start / stop video recording</dd>
                </div>
                <div>
                  <dt>Esc</dt>
                  <dd>
                    Stop Rec · exit Focus fullscreen · exit Focus (when not over a stream) ·
                    device Back when hovering a stream
                  </dd>
                </div>
                <div>
                  <dt>Ctrl/⌘+C · V · X</dt>
                  <dd>Clipboard sync while a stream is armed (hover/click)</dd>
                </div>
                <div>
                  <dt>Ctrl/⌘+click</dt>
                  <dd>Focus Mode optional fullscreen</dd>
                </div>
                <div>
                  <dt>Hover stream</dt>
                  <dd>Arm keyboard (type to device)</dd>
                </div>
                <div>
                  <dt>Click / drag stream</dt>
                  <dd>Touch input</dd>
                </div>
                <div>
                  <dt>Enter · Backspace · Home</dt>
                  <dd>Device keys while armed</dd>
                </div>
                <div>
                  <dt>Meta (Win/⌘)</dt>
                  <dd>Android Recents / app switch (while armed)</dd>
                </div>
                <div>
                  <dt>Drag header handle</dt>
                  <dd>Reorder devices</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>

        <div className="settings-modal__footer modal-actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button
            type="submit"
            className="modal-btn modal-btn--primary"
            disabled={saving || !isDirty}
            title={isDirty ? undefined : "No changes to save"}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
