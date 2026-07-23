/** Settings + vault API (local only). */

export interface SidebarActionDef {
  id: string;
  label: string;
  group: string;
}

export interface CustomAdbAction {
  id: string;
  label: string;
  args: string;
}

export interface VaultInfo {
  path: string;
  encryption: string;
  hasMasterPassword?: boolean;
  unlocked?: boolean;
  onlineSharing: boolean;
  plaintextOnDisk: boolean;
}

export interface SettingsPayload {
  capturePath: string;
  vaultPath: string;
  sidebarActions: Record<string, boolean>;
  sidebarActionDefs: SidebarActionDef[];
  customAdbActions: CustomAdbAction[];
  vault: VaultInfo;
  vaultAccounts?: Array<{
    username: string;
    updatedAt?: string;
    hasCredentials: boolean;
    hasPassword?: boolean;
    hasPin?: boolean;
  }>;
}

function formatApiDetail(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  return `Request failed (${status})`;
}

export async function fetchSettings(): Promise<SettingsPayload> {
  const response = await fetch("/api/settings");
  const payload = (await response.json().catch(() => ({}))) as SettingsPayload & {
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return payload;
}

export async function saveSettings(patch: {
  capturePath?: string;
  vaultPath?: string;
  sidebarActions?: Record<string, boolean>;
  customAdbActions?: CustomAdbAction[];
  masterPassword?: string;
}): Promise<SettingsPayload> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const payload = (await response.json().catch(() => ({}))) as SettingsPayload & {
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return payload;
}

export async function changeMasterPassword(opts: {
  currentPassword?: string;
  newPassword?: string;
}): Promise<VaultInfo> {
  const response = await fetch("/api/settings/master-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    vault?: VaultInfo;
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return payload.vault!;
}

export async function unlockVault(password: string): Promise<VaultInfo> {
  const response = await fetch("/api/settings/unlock-vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    vault?: VaultInfo;
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return payload.vault!;
}

export async function saveEdgeAccountCredentials(
  username: string,
  password?: string,
  pin?: string,
): Promise<void> {
  const response = await fetch("/api/actions/edge-accounts/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, pin }),
  });
  const payload = (await response.json().catch(() => ({}))) as { detail?: unknown };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
}

export async function deleteEdgeAccountVault(
  username: string,
  deviceIds?: string[],
): Promise<{
  deleted: boolean;
  username: string;
  deviceResults?: Array<{ ok: boolean; detail?: string; deviceId?: string }>;
}> {
  const query =
    deviceIds?.length
      ? `?device_ids=${encodeURIComponent(deviceIds.join(","))}`
      : "";
  const response = await fetch(
    `/api/actions/edge-accounts/${encodeURIComponent(username)}${query}`,
    { method: "DELETE" },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    deleted?: boolean;
    username?: string;
    deviceResults?: Array<{ ok: boolean; detail?: string; deviceId?: string }>;
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return {
    deleted: Boolean(payload.deleted),
    username: payload.username || username,
    deviceResults: payload.deviceResults,
  };
}

export async function listVaultAccounts(): Promise<{
  accounts: Array<{ username: string; updatedAt?: string; hasCredentials: boolean }>;
  vault?: VaultInfo;
}> {
  const response = await fetch("/api/actions/edge-accounts");
  const payload = (await response.json().catch(() => ({}))) as {
    accounts?: Array<{
      username: string;
      updatedAt?: string;
      hasCredentials: boolean;
      inVault?: boolean;
    }>;
    vault?: VaultInfo;
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return {
    accounts: (payload.accounts ?? []).filter((item) => item.inVault || item.hasCredentials),
    vault: payload.vault,
  };
}

export function runCustomAdb(actionId: string, deviceIds?: string[]) {
  return fetch("/api/actions/custom-adb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actionId,
      deviceIds: deviceIds?.length ? deviceIds : undefined,
    }),
  }).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as {
      results?: Array<{
        deviceId: string;
        name: string;
        ok: boolean;
        detail: string | null;
      }>;
      detail?: unknown;
    };
    if (!response.ok) {
      throw new Error(formatApiDetail(payload.detail, response.status));
    }
    return { results: payload.results ?? [] };
  });
}
