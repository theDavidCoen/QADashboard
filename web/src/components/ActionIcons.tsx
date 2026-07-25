import type { ReactElement, ReactNode } from "react";

/** Compact 24×24 stroke icons for sidebar actions (currentColor). */

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconPlay({ className }: IconProps) {
  return (
    <Svg className={className}>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconCode({ className }: IconProps) {
  return (
    <Svg className={className}>
      <polyline points="8 6 2 12 8 18" />
      <polyline points="16 6 22 12 16 18" />
    </Svg>
  );
}

export function IconWallet({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2" />
      <rect x="2" y="8" width="20" height="12" rx="2" />
      <circle cx="16.5" cy="14" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconGlobe({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </Svg>
  );
}

export function IconApps({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </Svg>
  );
}

export function IconLayersOff({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 3.5 8 12 13l8.5-5L12 3Z" />
      <path d="M3.5 12 12 17l8.5-5" />
      <path d="M3.5 16 12 21l8.5-5" opacity="0.45" />
    </Svg>
  );
}

export function IconStop({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconCamera({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.8A1 1 0 0 1 10.5 4h3a1 1 0 0 1 .8.4L15.5 6h2A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.25" />
    </Svg>
  );
}

export function IconVideo({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="6.5" width="13" height="11" rx="2" />
      <path d="M15.5 10.5 21 7.5v9l-5.5-3v-3Z" />
    </Svg>
  );
}

export function IconRefresh({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <polyline points="21 4 21 10 15 10" />
    </Svg>
  );
}

export function IconAirplane({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10.5 19.5 12 22l1.5-2.5 6.5 1.5-5-5.5V7.5L21 5l-6.5 1L12 2 9.5 6 3 5l6 2.5v5.5l-5 5.5 6.5-1.5Z" />
    </Svg>
  );
}

export function IconWifi({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 12.5c2.2-2.1 4.6-3.2 7-3.2s4.8 1.1 7 3.2" />
      <path d="M8.2 15.6c1.3-1.2 2.6-1.8 3.8-1.8s2.5.6 3.8 1.8" />
      <circle cx="12" cy="19" r="1.15" fill="currentColor" stroke="none" />
      <path d="M2 9c3.2-3 6.5-4.5 10-4.5S18.8 6 22 9" opacity="0.55" />
    </Svg>
  );
}

export function IconVpn({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 4.5 6.5v5.2c0 4.4 3.1 8.4 7.5 9.3 4.4-.9 7.5-4.9 7.5-9.3V6.5L12 3Z" />
      <path d="M9.5 12.2 11.2 14l3.5-4" />
    </Svg>
  );
}

export function IconWireguard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 4.5 6.5v5.2c0 4.4 3.1 8.4 7.5 9.3 4.4-.9 7.5-4.9 7.5-9.3V6.5L12 3Z" />
      <path d="M8.5 12h7" />
      <path d="M12 8.5v7" />
    </Svg>
  );
}

export function IconBattery({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="7.5" width="15.5" height="9" rx="1.8" />
      <path d="M18.5 10.5h1.8a.8.8 0 0 1 .8.8v1.4a.8.8 0 0 1-.8.8H18.5" />
      <path d="M7 12h6" />
    </Svg>
  );
}

export function IconRotate({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16.5 4.5A8 8 0 1 1 5.2 9.5" />
      <polyline points="16.5 4.5 16.5 9 12 9" />
      <rect x="8.5" y="11" width="5.5" height="8" rx="1.1" transform="rotate(-20 11.25 15)" />
    </Svg>
  );
}

export function IconUnplug({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 7V3" />
      <path d="M15 7V3" />
      <path d="M8 7h8v4a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V7Z" />
      <path d="M12 15v3" />
      <path d="M8 21h8" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function IconUser({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19.5c1.8-3.2 4-4.8 7-4.8s5.2 1.6 7 4.8" />
    </Svg>
  );
}

export function IconSettings({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.88 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  );
}

export function IconFocus({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3v3.5" />
      <path d="M12 17.5V21" />
      <path d="M3 12h3.5" />
      <path d="M17.5 12H21" />
    </Svg>
  );
}

export function IconScreenOff({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="6" y="3" width="12" height="18" rx="2.5" />
      <path d="M10 17.5h4" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}

export type ActionIconName =
  | "play"
  | "code"
  | "wallet"
  | "globe"
  | "apps"
  | "layers"
  | "stop"
  | "camera"
  | "video"
  | "refresh"
  | "airplane"
  | "wifi"
  | "vpn"
  | "wireguard"
  | "battery"
  | "screenOff"
  | "rotate"
  | "unplug"
  | "user"
  | "settings"
  | "focus";

const ICONS: Record<ActionIconName, (props: IconProps) => ReactElement> = {
  play: IconPlay,
  code: IconCode,
  wallet: IconWallet,
  globe: IconGlobe,
  apps: IconApps,
  layers: IconLayersOff,
  stop: IconStop,
  camera: IconCamera,
  video: IconVideo,
  refresh: IconRefresh,
  airplane: IconAirplane,
  wifi: IconWifi,
  vpn: IconVpn,
  wireguard: IconWireguard,
  battery: IconBattery,
  screenOff: IconScreenOff,
  rotate: IconRotate,
  unplug: IconUnplug,
  user: IconUser,
  settings: IconSettings,
  focus: IconFocus,
};

export function ActionIcon({ name, className = "sidebar-action__icon" }: { name: ActionIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} />;
}
