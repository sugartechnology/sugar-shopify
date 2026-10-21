// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/colors.ts

import type { CabinColorId } from "./types";

export const DEFAULT_CABIN_COLOR: CabinColorId = "wood";

export interface CabinColorOption {
  id: CabinColorId;
  label: string;
  hex: number;
  css: string;
}

export const CABIN_COLORS: readonly CabinColorOption[] = [
  { id: "wood", label: "Ahşap", hex: 0xc4a574, css: "#c4a574" },
  { id: "ivory", label: "Kırık beyaz", hex: 0xece6dc, css: "#ece6dc" },
  { id: "blue", label: "Mavi", hex: 0x7d93a8, css: "#7d93a8" },
];

export function isCabinColorId(value: unknown): value is CabinColorId {
  return value === "wood" || value === "ivory" || value === "blue";
}

export function normalizeCabinColor(value?: CabinColorId): CabinColorId {
  return isCabinColorId(value) ? value : DEFAULT_CABIN_COLOR;
}

export function cabinColorHex(value?: CabinColorId): number {
  const id = normalizeCabinColor(value);
  for (const option of CABIN_COLORS) {
    if (option.id === id) return option.hex;
  }
  return CABIN_COLORS[0].hex;
}
