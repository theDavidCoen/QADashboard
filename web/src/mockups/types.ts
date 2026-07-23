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
  match: string[];
}

export interface MockupRegistry {
  mockups: Record<string, MockupProfile>;
}
