/** Client-side appearance themes (Default / Liquid / Custom). */

export type AppearanceId = "default" | "liquid" | "custom";
export type BgKind = "color" | "image";
/** Liquid-only: bundled wallpaper, or user color/image. */
export type LiquidBgKind = "wallpaper" | "color" | "image";

export type AppearanceState = {
  id: AppearanceId;
  /** Used by Custom (and Liquid when not on bundled wallpaper). */
  bgKind: BgKind;
  bgColor: string;
  /** data: URL from FileReader; null when none */
  bgImage: string | null;
  liquidBgKind: LiquidBgKind;
};

export const APPEARANCE_STORAGE_KEY = "qa_dashboard_appearance_v2";

export const CUSTOM_COLOR_SWATCHES = [
  "#0a0a0a",
  "#171717",
  "#1e293b",
  "#0f172a",
  "#1a237e",
  "#312e81",
  "#4c1d95",
  "#7b1fa2",
  "#0e7490",
  "#0f766e",
  "#14532d",
  "#422006",
  "#7f1d1d",
  "#f4f4f5",
  "#e2e8f0",
  "#fef3c7",
] as const;

export const DEFAULT_APPEARANCE: AppearanceState = {
  id: "default",
  bgKind: "color",
  bgColor: "#1a237e",
  bgImage: null,
  liquidBgKind: "wallpaper",
};

export const LIQUID_WALLPAPER = "/themes/liquid-wallpaper.png";

function migrateV1(raw: string): AppearanceState | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id =
      parsed.id === "liquid" || parsed.id === "custom" || parsed.id === "default"
        ? parsed.id
        : null;
    if (!id) return null;
    const bgKind = parsed.customKind === "image" || parsed.bgKind === "image" ? "image" : "color";
    const bgColor =
      typeof parsed.customColor === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.customColor)
        ? parsed.customColor
        : typeof parsed.bgColor === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.bgColor)
          ? parsed.bgColor
          : DEFAULT_APPEARANCE.bgColor;
    const img =
      typeof parsed.customImage === "string"
        ? parsed.customImage
        : typeof parsed.bgImage === "string"
          ? parsed.bgImage
          : null;
    const bgImage = img && img.startsWith("data:image/") ? img : null;
    const liquidBgKind: LiquidBgKind =
      parsed.liquidBgKind === "color" || parsed.liquidBgKind === "image"
        ? parsed.liquidBgKind
        : "wallpaper";
    return { id, bgKind, bgColor, bgImage, liquidBgKind };
  } catch {
    return null;
  }
}

export function loadAppearance(): AppearanceState {
  try {
    const raw =
      localStorage.getItem(APPEARANCE_STORAGE_KEY) ??
      localStorage.getItem("qa_dashboard_appearance_v1");
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const migrated = migrateV1(raw);
    return migrated ?? { ...DEFAULT_APPEARANCE };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(state: AppearanceState): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* WebKit private / quota */
  }
}

function applyBgImage(root: HTMLElement, url: string): void {
  root.style.setProperty("--appearance-bg-image", `url(${url})`);
  root.style.removeProperty("--appearance-bg-color");
}

function applyBgColor(root: HTMLElement, color: string): void {
  root.style.removeProperty("--appearance-bg-image");
  root.style.setProperty("--appearance-bg-color", color);
}

function clearBg(root: HTMLElement): void {
  root.style.removeProperty("--appearance-bg-image");
  root.style.removeProperty("--appearance-bg-color");
}

/** Apply appearance to <html> (data attributes + CSS variables). Light/dark stays on data-theme. */
export function applyAppearance(state: AppearanceState): void {
  const root = document.documentElement;
  root.setAttribute("data-appearance", state.id);

  if (state.id === "liquid") {
    if (state.liquidBgKind === "image" && state.bgImage) {
      applyBgImage(root, state.bgImage);
    } else if (state.liquidBgKind === "color") {
      applyBgColor(root, state.bgColor);
    } else {
      applyBgImage(root, LIQUID_WALLPAPER);
    }
    return;
  }

  if (state.id === "custom") {
    if (state.bgKind === "image" && state.bgImage) {
      applyBgImage(root, state.bgImage);
    } else {
      applyBgColor(root, state.bgColor);
    }
    return;
  }

  clearBg(root);
}
