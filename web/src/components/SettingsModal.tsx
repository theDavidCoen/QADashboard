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
} from "../api/settings";
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
  sidebarActions: Record<string, boolean>;
  customActions: CustomAdbAction[];
};

const EDGE_ACTION_IDS = new Set(["start_edge", "start_edge_account", "start_edge_develop"]);
const ARKADE_ACTION_IDS = new Set(["start_arkade"]);

function snapshotOf(parts: SettingsSnapshot): string {
  return JSON.stringify({
    capturePath: parts.capturePath.trim(),
    vaultPath: parts.vaultPath.trim(),
    edgeFeaturesEnabled: parts.edgeFeaturesEnabled,
    arkadeFeaturesEnabled: parts.arkadeFeaturesEnabled,
    soundEffectsEnabled: parts.soundEffectsEnabled,
    sidebarActions: parts.sidebarActions,
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
  const [sidebarActions, setSidebarActions] = useState<Record<string, boolean>>({});
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

  const rememberBaseline = (
    nextCapture: string,
    nextVault: string,
    nextEdge: boolean,
    nextArkade: boolean,
    nextSound: boolean,
    nextFlags: Record<string, boolean>,
    nextCustoms: CustomAdbAction[],
  ) => {
    baselineRef.current = snapshotOf({
      capturePath: nextCapture,
      vaultPath: nextVault,
      edgeFeaturesEnabled: nextEdge,
      arkadeFeaturesEnabled: nextArkade,
      soundEffectsEnabled: nextSound,
      sidebarActions: nextFlags,
      customActions: nextCustoms,
    });
  };

  const applySettings = (payload: SettingsPayload, asBaseline = true) => {
    const soundOn = payload.soundEffectsEnabled !== false;
    setCapturePath(payload.capturePath);
    setVaultPath(payload.vaultPath);
    setEdgeFeaturesEnabled(payload.edgeFeaturesEnabled === true);
    setArkadeFeaturesEnabled(payload.arkadeFeaturesEnabled === true);
    setSoundEffectsEnabled(soundOn);
    setSidebarActions(payload.sidebarActions);
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
        payload.sidebarActions,
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
      sidebarActions,
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
    sidebarActions,
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
        sidebarActions,
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
              <p className="picker-empty">Workspace feedback and where captures are saved.</p>
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
              <h4>Sidebar actions</h4>
              <p className="picker-empty">Choose which buttons appear in the left sidebar.</p>
              {Object.keys(groups).length === 0 ? (
                <p className="picker-empty">Loading action list…</p>
              ) : (
                Object.entries(groups).map(([group, defs]) => (
                  <div key={group} className="settings-flags-group">
                    <p className="settings-group-label">{group}</p>
                    <ToggleList>
                      {defs.map((def) => (
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
