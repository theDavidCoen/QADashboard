export interface MockupScreen {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MockupProfile {
  label: string;
  frame: string;
  frameType: "image" | "svg";
  frameAspect: number;
  screen: MockupScreen;
  screenRadius: string;
  /** Optional alpha mask (white = show stream) sized to the screen box for pixel-perfect bezel fit. */
  screenMask?: string;
  match: string[];
}

export interface MockupRegistry {
  mockups: Record<string, MockupProfile>;
}
