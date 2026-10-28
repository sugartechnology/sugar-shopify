// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/colors.ts

import type { CabinColorId } from "./types";

export interface CabinColorOption {
  id: CabinColorId;
  label: string;
  hex: number;
  css: string;
}

/** Built-in palette for pages that bring none (the cabin configurator page). */
export const CABIN_COLORS: readonly CabinColorOption[] = [
  { id: "wood", label: "Ahşap", hex: 0xc4a574, css: "#c4a574" },
  { id: "ivory", label: "Kırık beyaz", hex: 0xece6dc, css: "#ece6dc" },
  { id: "blue", label: "Mavi", hex: 0x7d93a8, css: "#7d93a8" },
];

let palette: readonly CabinColorOption[] = CABIN_COLORS;

/**
 * Sets the colours of this page (Koshoy: the shop's colours, sent by its
 * backend), body and handle colours alike; the first one is the default body
 * colour. A colour id the palette does not know falls back to the default, so
 * designs saved with an older palette still draw and price.
 */
export function setCabinColors(options: readonly CabinColorOption[]): void {
  palette = options.length ? [...options] : CABIN_COLORS;
}

export function cabinColors(): readonly CabinColorOption[] {
  return palette;
}

export function defaultCabinColor(): CabinColorId {
  return palette[0].id;
}

export function isCabinColorId(value: unknown): value is CabinColorId {
  return typeof value === "string" && palette.some((option) => option.id === value);
}

export function normalizeCabinColor(value?: CabinColorId): CabinColorId {
  return isCabinColorId(value) ? value : defaultCabinColor();
}

export function cabinColorHex(value?: CabinColorId): number {
  const id = normalizeCabinColor(value);
  return palette.find((option) => option.id === id)?.hex ?? palette[0].hex;
}
