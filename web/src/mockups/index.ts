import type { MockupProfile, MockupRegistry } from "./types";

import registry from "../../public/mockups/registry.json";

const catalog = registry as MockupRegistry;

export function getMockupProfile(id: string): MockupProfile {
  return catalog.mockups[id] ?? catalog.mockups["generic-android"];
}

export function listMockupProfiles(): MockupProfile[] {
  return Object.values(catalog.mockups);
}
