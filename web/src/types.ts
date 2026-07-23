export type Platform = "android" | "ios";

export interface AppInfo {
  name: string | null;
  build: string | null;
  url: string | null;
  kind: "native" | "pwa" | "browser" | null;
  package: string | null;
}

export interface DeviceInfo {
  id: string;
  platform: Platform;
  name: string;
  model: string;
  appLabel: string | null;
  mockupId: string;
  osVersion?: string | null;
  app?: AppInfo | null;
}

export interface SlotDevice extends DeviceInfo {
  slotId: string;
}
