import type { DeviceInfo } from "../types";

export interface ActionResult {
  deviceId: string;
  name: string;
  ok: boolean;
  detail: string | null;
}

export interface ActionResponse {
  results: ActionResult[];
  url?: string;
  enabled?: boolean;
}

async function postAction(path: string, body: Record<string, unknown>): Promise<ActionResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as ActionResponse & {
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return payload;
}

function formatApiDetail(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return `Request failed (${status})`;
}

export function androidDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return devices.filter((device) => device.platform === "android");
}

export function startApp(app: "edge" | "edge_develop", deviceIds?: string[]) {
  return postAction("/api/actions/start-app", {
    app,
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export function openUrl(url: string, deviceIds?: string[]) {
  return postAction("/api/actions/open-url", {
    url,
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export interface OpenWebSession {
  name: string;
  url: string;
  source: string;
  package: string | null;
  deviceId: string | null;
  deviceName: string | null;
}

export async function listArkadeSessions(deviceIds?: string[]): Promise<{ sessions: OpenWebSession[] }> {
  const query =
    deviceIds?.length
      ? `?device_ids=${encodeURIComponent(deviceIds.join(","))}`
      : "";
  const response = await fetch(`/api/actions/arkade-sessions${query}`);
  const payload = (await response.json().catch(() => ({}))) as {
    sessions?: OpenWebSession[];
    detail?: unknown;
  };
  if (!response.ok) {
    const detail = payload.detail;
    throw new Error(
      typeof detail === "string" ? detail : `Request failed (${response.status})`,
    );
  }
  return { sessions: payload.sessions ?? [] };
}

export function setAirplaneMode(enabled: boolean, deviceIds?: string[]) {
  return postAction("/api/actions/airplane-mode", {
    enabled,
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export function rebootDevices(deviceIds?: string[]) {
  return postAction("/api/actions/reboot", {
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export function takeScreenshot(deviceIds?: string[]) {
  return postAction("/api/actions/screenshot", {
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export function startScreenrecord(deviceId: string) {
  return postAction("/api/actions/screenrecord/start", { deviceId });
}

export function stopScreenrecord(deviceId: string) {
  return postAction("/api/actions/screenrecord/stop", { deviceId });
}

export interface LaunchableApp {
  package: string;
  activity: string;
  label: string;
}

export async function listLaunchableApps(deviceId: string): Promise<{ apps: LaunchableApp[] }> {
  const response = await fetch(`/api/actions/apps?device_id=${encodeURIComponent(deviceId)}`);
  const payload = (await response.json().catch(() => ({}))) as {
    apps?: LaunchableApp[];
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed (${response.status})`);
  }
  return { apps: payload.apps ?? [] };
}

export function startPackage(packageName: string, activity?: string, deviceIds?: string[]) {
  return postAction("/api/actions/start-package", {
    package: packageName,
    activity: activity || undefined,
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export function killBackground(deviceIds?: string[]) {
  return postAction("/api/actions/kill-background", {
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export function killForeground(deviceIds?: string[]) {
  return postAction("/api/actions/kill-foreground", {
    deviceIds: deviceIds?.length ? deviceIds : undefined,
  });
}

export async function getAirplaneStatus(deviceId?: string): Promise<ActionResponse> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  const response = await fetch(`/api/actions/airplane-mode${query}`);
  const payload = (await response.json().catch(() => ({}))) as ActionResponse & {
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed (${response.status})`);
  }
  return payload;
}

export interface EdgeAccount {
  username: string;
  onDevice: boolean;
  inVault: boolean;
  hasPassword: boolean;
  hasPin: boolean;
  hasCredentials: boolean;
  source: string;
}

export interface EdgeAccountsResponse {
  accounts: EdgeAccount[];
  vault?: {
    path: string;
    encryption: string;
    onlineSharing: boolean;
    plaintextOnDisk: boolean;
  };
}

export async function listEdgeAccounts(deviceIds?: string[]): Promise<EdgeAccountsResponse> {
  const query =
    deviceIds?.length
      ? `?device_ids=${encodeURIComponent(deviceIds.join(","))}`
      : "";
  const response = await fetch(`/api/actions/edge-accounts${query}`);
  const payload = (await response.json().catch(() => ({}))) as EdgeAccountsResponse & {
    detail?: unknown;
  };
  if (!response.ok) {
    throw new Error(formatApiDetail(payload.detail, response.status));
  }
  return {
    accounts: payload.accounts ?? [],
    vault: payload.vault,
  };
}

export function startEdgeAccount(opts: {
  username: string;
  password?: string;
  pin?: string;
  save?: boolean;
  app?: "edge" | "edge_develop";
  deviceIds?: string[];
}) {
  return postAction("/api/actions/start-edge-account", {
    username: opts.username,
    password: opts.password,
    pin: opts.pin,
    save: opts.save ?? false,
    app: opts.app ?? "edge",
    deviceIds: opts.deviceIds?.length ? opts.deviceIds : undefined,
  });
}

export async function deleteEdgeAccount(
  username: string,
  deviceIds?: string[],
): Promise<{
  deleted: boolean;
  username: string;
  deviceResults?: ActionResult[];
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
    deviceResults?: ActionResult[];
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

export function summarizeResults(results: ActionResult[]): string {
  const ok = results.filter((item) => item.ok).length;
  const fail = results.length - ok;
  if (fail === 0) {
    const path = results.find((item) => item.ok && item.detail?.startsWith("/"))?.detail;
    if (path && results.length === 1) return path;
    return `OK on ${ok} device${ok === 1 ? "" : "s"}`;
  }
  if (ok === 0) {
    const first = results.find((item) => !item.ok);
    return first?.detail || `Failed on ${fail} device${fail === 1 ? "" : "s"}`;
  }
  return `${ok} ok · ${fail} failed`;
}
