// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/grid.ts

/** Catalog grid unit (mm). */
export const CABIN_GRID_MM = 160;

export const CABIN_WIDTHS_MM = [320, 480, 640, 960] as const;

/** grid_y 1–10, 12, 14. 11 is missing from the catalog. */
export const CABIN_HEIGHTS_MM = [
  224, 384, 544, 704, 864, 1024, 1184, 1344, 1504, 1664, 1984, 2304,
] as const;

export const CABIN_DEPTHS_MM = [320, 480, 640] as const;

export const DEFAULT_CABIN_DEPTH_MM = 640;

export const CABIN_TOTAL_WIDTH_MAX_MM = 5000;

/**
 * Nearest allowed catalog size. Ties go to the smaller value.
 */
export function nearestAllowed(
  value: number,
  allowed: readonly number[],
): number {
  let best = allowed[0];
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < allowed.length; i++) {
    const candidate = allowed[i];
    const dist = Math.abs(value - candidate);
    if (dist < bestDist || (dist === bestDist && candidate < best)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

export function nearestWidth(valueMm: number): number {
  return nearestAllowed(valueMm, CABIN_WIDTHS_MM);
}

export function nextWidthAbove(currentMm: number): number | undefined {
  for (const width of CABIN_WIDTHS_MM) {
    if (width > currentMm) return width;
  }
  return undefined;
}

export function nearestHeight(valueMm: number): number {
  return nearestAllowed(valueMm, CABIN_HEIGHTS_MM);
}

export function nearestDepth(valueMm: number): number {
  return nearestAllowed(valueMm, CABIN_DEPTHS_MM);
}

export function mmToCm(mm: number): number {
  return mm / 10;
}

export function cmToMm(cm: number): number {
  return cm * 10;
}
