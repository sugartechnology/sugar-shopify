// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/fittings.ts

import { cabinCavity } from "./buildCabinPanels";
import type {
  CabinCavity,
  CabinFitKind,
  CabinFitting,
  CabinSize,
  CabinUnit,
  CabinVec3,
} from "./types";

export const SHELF_THICKNESS_MM = 16;
export const DRAWER_160_MM = 160;
export const DRAWER_320_MM = 320;
export const HANGER_DIAMETER_MM = 25;
export const HANGER_MIN_ZONE_MM = 400;
/** Rod centre under the shelf or top panel above it (PnP-3D: 2186 in a 2304 vestiyer). */
export const HANGER_DROP_MM = 102;
/** Free shelves sit on a 160 mm grid (PnP-3D: 248 / 408 / 568 with a plinth). */
export const SHELF_GRID_MM = 160;
export const DOOR_OVERLAY_W_MM = 3;
export const DOOR_OVERLAY_H_MM = 67;
/** Same 1.5 mm side/top pay as W−3 / MCP KAPAK (Y 65.5 … H−1.5). */
export const OVERLAY_INSET_MM = DOOR_OVERLAY_W_MM * 0.5;
export const DOOR_THICKNESS_MM = 18;
/**
 * Smallest door zone: the leaf plus its 1.5 mm gap at the bottom and top.
 * The leaf itself is 3 mm shorter, so a 317 mm KAPAK is allowed.
 */
export const DOOR_MIN_HEIGHT_MM = 320;
export const DRAWER_FRONT_MM = 18;
export const DRAWER_WALL_MM = 16;
export const DRAWER_160_WALL_MM = 90;
export const DRAWER_320_WALL_MM = 210;
export const CLOSING_SHELF_ID = "kapatan-raf";

/** Overlay front band start (67 − 1.5). Shared by KAPAK and CEKMECE_KAPAK. */
export function overlayFrontY0Mm(): number {
  return DOOR_OVERLAY_H_MM - OVERLAY_INSET_MM;
}

/**
 * Height of the front grid: fronts tile 160 mm bands from Y 64 up to H, each
 * band being a front plus its 3 mm gap (544 → 480, so three 160 drawers).
 */
export function frontGridHeightMm(size: CabinSize): number {
  return size.heightMm - (DOOR_OVERLAY_H_MM - DOOR_OVERLAY_W_MM);
}

export function drawerBandMm(kind: CabinFitKind): number {
  return kind === "drawer320" ? DRAWER_320_MM : DRAWER_160_MM;
}

export interface DrawerTubPanel {
  role: "bottom" | "left" | "right" | "back" | "front";
  min: CabinVec3;
  max: CabinVec3;
  center: CabinVec3;
  size: CabinVec3;
}

export interface PlacedFitting {
  id: string;
  kind: CabinFitKind;
  min: CabinVec3;
  max: CabinVec3;
  center: CabinVec3;
  size: CabinVec3;
}

export interface CabinDoorLeaf {
  id: string;
  min: CabinVec3;
  max: CabinVec3;
  center: CabinVec3;
  size: CabinVec3;
}

export interface CanAddFittingOptions {
  hasDoor?: boolean;
}

export function cloneFittings(fittings: readonly CabinFitting[]): CabinFitting[] {
  return fittings.map((item) => ({ ...item }));
}

export function fittingLabel(kind: CabinFitKind): string {
  if (kind === "drawer160") return "Çekmece 16 cm";
  if (kind === "drawer320") return "Çekmece 32 cm";
  if (kind === "shelf") return "Raf";
  return "Askı";
}

/**
 * Adds the closing shelf above the drawer bank, unless the user already put a
 * shelf there or the bank reaches the top panel (nothing above to close off).
 */
export function fittingsWithClosingShelf(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  const list = cloneFittings(fittings);
  const n = drawerPrefix(list).length;
  if (n === 0 || list[n]?.kind === "shelf") return list;
  if (drawerRunOccupyMm(size, list) >= frontGridHeightMm(size)) return list;
  list.splice(n, 0, { id: CLOSING_SHELF_ID, kind: "shelf" });
  return list;
}

interface StackedFitting {
  item: CabinFitting;
  /** Zone in the cavity, bottom and top Y (mm). */
  y0: number;
  y1: number;
}

/**
 * Bottom → top layout of the interior. Stops at the first fitting that does
 * not fit, so it and everything above it are left out.
 * - The drawer bank takes 160 / 320 mm bands of the front grid from the
 *   cavity bottom, as long as the bank stays inside the front grid.
 * - The shelf right above the bank (the user's or the closing shelf) sits in
 *   the top 16 mm of the last drawer band, centred on the seam between the
 *   drawer front and what is above it. Both fronts then cover
 *   16/2 − 1.5 = 6.5 mm of it.
 * - Other shelves and hangers share the rest of the cavity
 *   (`layoutFreeFittings`).
 */
function stackFittings(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): StackedFitting[] {
  const cavity = cabinCavity(size);
  const list = fittingsWithClosingShelf(size, fittings);
  const bankCount = drawerPrefix(list).length;
  const bankMm = drawerRunOccupyMm(size, list);
  const stacked: StackedFitting[] = [];
  let y = cavity.min.y;
  let i = 0;
  for (; i < bankCount; i++) {
    const band = drawerBandMm(list[i].kind);
    if (y + band > cavity.min.y + bankMm) return stacked;
    stacked.push({ item: list[i], y0: y, y1: y + band });
    y += band;
  }
  if (bankCount > 0 && list[i]?.kind === "shelf") {
    if (bankMm >= frontGridHeightMm(size)) return stacked;
    stacked.push({ item: list[i], y0: y - SHELF_THICKNESS_MM, y1: y });
    i++;
  }
  // The longest run of the remaining fittings that fits.
  const free = list.slice(i);
  for (let n = free.length; n > 0; n--) {
    const placed = layoutFreeFittings(cavity, y, free.slice(0, n));
    if (placed) return stacked.concat(placed);
  }
  return stacked;
}

/**
 * Grid lines for free shelves above `startY`: shelf bottoms on cavity bottom
 * + 16 + 160·k, at least one grid step above `startY` and below the top panel.
 */
function shelfLinesMm(cavity: CabinCavity, startY: number): number[] {
  const lines: number[] = [];
  const lastY = cavity.max.y - SHELF_GRID_MM - SHELF_THICKNESS_MM;
  for (let y = cavity.min.y + SHELF_THICKNESS_MM; y <= lastY; y += SHELF_GRID_MM) {
    if (y - startY >= SHELF_GRID_MM) lines.push(y);
  }
  return lines;
}

/**
 * Shelves and hangers above `startY` (the drawer bank, or the cavity bottom).
 * The shelves split the space into gaps, counted in grid steps; a hanger hangs
 * in the gap it is listed in, its rod 102 mm under the shelf or top panel
 * above. Without hangers the gaps get the same number of steps; with hangers
 * the other gaps get one step and the hanger gaps share the rest. Spare steps
 * go to the lowest gaps. Undefined when the fittings do not fit.
 */
function layoutFreeFittings(
  cavity: CabinCavity,
  startY: number,
  items: readonly CabinFitting[],
): StackedFitting[] | undefined {
  const lines = shelfLinesMm(cavity, startY);
  const gapOfItem: number[] = [];
  const hangerGaps: number[] = [];
  let gap = 0;
  for (const item of items) {
    if (item.kind === "shelf") gap++;
    else if (item.kind !== "hanger" || hangerGaps.includes(gap)) return undefined;
    else hangerGaps.push(gap);
    gapOfItem.push(gap);
  }
  const gapCount = gap + 1;
  // Steps from startY to the top panel: one more than the grid lines.
  let spare = lines.length + 1 - gapCount;
  if (spare < 0) return undefined;
  const steps: number[] = new Array(gapCount).fill(1);
  const wideGaps = hangerGaps.length > 0 ? hangerGaps : steps.map((_, g) => g);
  for (let k = 0; spare > 0; k = (k + 1) % wideGaps.length, spare--) {
    steps[wideGaps[k]]++;
  }
  // Bottom of each shelf, and each gap's [bottom, top].
  const shelfY: number[] = [];
  let line = -1;
  for (let g = 0; g < gapCount - 1; g++) {
    line += steps[g];
    shelfY.push(lines[line]);
  }
  const gapBottom = (g: number) => (g === 0 ? startY : shelfY[g - 1] + SHELF_THICKNESS_MM);
  const gapTop = (g: number) => (g === gapCount - 1 ? cavity.max.y : shelfY[g]);
  for (const g of hangerGaps) {
    if (gapTop(g) - gapBottom(g) < HANGER_MIN_ZONE_MM) return undefined;
  }
  return items.map((item, index) => {
    if (item.kind === "shelf") {
      const y0 = shelfY[gapOfItem[index] - 1];
      return { item, y0, y1: y0 + SHELF_THICKNESS_MM };
    }
    const g = gapOfItem[index];
    return { item, y0: gapBottom(g), y1: gapTop(g) };
  });
}

export function usedFittingHeightMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  const cavity = cabinCavity(size);
  let top = cavity.min.y;
  for (const { y1 } of stackFittings(size, fittings)) top = Math.max(top, y1);
  return top - cavity.min.y;
}

export function remainingCavityMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  return Math.max(0, cabinCavity(size).size.y - usedFittingHeightMm(size, fittings));
}

export function isDrawerKind(kind: CabinFitKind): boolean {
  return kind === "drawer160" || kind === "drawer320";
}

export function drawerPrefix(
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  const prefix: CabinFitting[] = [];
  for (const item of fittings) {
    if (!isDrawerKind(item.kind)) break;
    prefix.push(item);
  }
  return prefix;
}

/** Height of the bottom drawer bank, up to the first drawer that leaves the front grid. */
export function drawerRunOccupyMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  const gridMm = frontGridHeightMm(size);
  let used = 0;
  for (const item of drawerPrefix(fittings)) {
    const band = drawerBandMm(item.kind);
    if (used + band > gridMm) break;
    used += band;
  }
  return used;
}

export function needsShelfAfterDrawers(
  fittings: readonly CabinFitting[],
): boolean {
  const drawers = drawerPrefix(fittings);
  return drawers.length > 0 && fittings[drawers.length]?.kind !== "shelf";
}

export function doorLeafCount(widthMm: number): 1 | 2 {
  return widthMm >= 640 ? 2 : 1;
}

export function doorMinYMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  return overlayFrontY0Mm() + drawerRunOccupyMm(size, fittings);
}

export function doorClearHeightMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  return Math.max(
    0,
    size.heightMm - DOOR_OVERLAY_H_MM - drawerRunOccupyMm(size, fittings),
  );
}

/** The door zone (leaf + 1.5 mm gap at the bottom and top) has to be ≥ 320 mm. */
export function canHaveDoor(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): boolean {
  return doorClearHeightMm(size, fittings) + 2 * OVERLAY_INSET_MM >= DOOR_MIN_HEIGHT_MM;
}

function sequenceAllows(
  fittings: readonly CabinFitting[],
  kind: CabinFitKind,
): boolean {
  if (isDrawerKind(kind)) {
    return fittings.every((item) => isDrawerKind(item.kind));
  }
  return true;
}

export function canAddFitting(
  size: CabinSize,
  fittings: readonly CabinFitting[],
  kind: CabinFitKind,
  options?: CanAddFittingOptions,
): boolean {
  if (!sequenceAllows(fittings, kind)) return false;
  const next = [...fittings, { id: "next", kind }];
  if (trimFittings(size, next).length !== next.length) return false;
  if (options?.hasDoor && isDrawerKind(kind)) return canHaveDoor(size, next);
  return true;
}

export function trimFittings(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  return stackFittings(size, fittings)
    .filter(({ item }) => item.id !== CLOSING_SHELF_ID)
    .map(({ item }) => ({ ...item }));
}

export function nextFittingId(fittings: readonly CabinFitting[]): string {
  let max = 0;
  for (const item of fittings) {
    const match = /^fit-(\d+)$/.exec(item.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `fit-${max + 1}`;
}

export function addFitting(
  unit: CabinUnit,
  kind: CabinFitKind,
  depthMm: number,
  hasPlinth: boolean,
): CabinUnit | undefined {
  const size: CabinSize = {
    widthMm: unit.widthMm,
    heightMm: unit.heightMm,
    depthMm,
    hasPlinth,
  };
  const fittings = cloneFittings(unit.fittings ?? []);
  if (!canAddFitting(size, fittings, kind, { hasDoor: unit.hasDoor })) {
    return undefined;
  }
  const added: CabinFitting = { id: nextFittingId(fittings), kind };
  if (isDrawerKind(kind)) added.color = unit.color;
  fittings.push(added);
  return { ...unit, fittings };
}

export function removeFitting(unit: CabinUnit, fittingId: string): CabinUnit {
  return {
    ...unit,
    fittings: (unit.fittings ?? []).filter((item) => item.id !== fittingId),
  };
}

export function normalizeUnitInterior(
  unit: CabinUnit,
  depthMm: number,
  hasPlinth: boolean,
): CabinUnit {
  const size: CabinSize = {
    widthMm: unit.widthMm,
    heightMm: unit.heightMm,
    depthMm,
    hasPlinth,
  };
  const fittings = trimFittings(size, unit.fittings ?? []);
  const hasDoor = (unit.hasDoor ?? false) && canHaveDoor(size, fittings);
  return {
    ...unit,
    fittings,
    hasDoor,
    doorOpen: hasDoor && (unit.doorOpen ?? false),
  };
}

export function layoutFittings(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): PlacedFitting[] {
  const cavity = cabinCavity(size);
  const placed: PlacedFitting[] = [];
  for (const { item, y0, y1 } of stackFittings(size, fittings)) {
    // A bank that fills the front grid ends above the cavity (the grid also
    // covers half the bottom panel and the top panel); the tub stays inside.
    const min = { x: cavity.min.x, y: y0, z: cavity.min.z };
    const max = { x: cavity.max.x, y: Math.min(y1, cavity.max.y), z: cavity.max.z };
    if (item.kind === "hanger") {
      const rodR = HANGER_DIAMETER_MM * 0.5;
      const rodY = max.y - HANGER_DROP_MM;
      min.y = rodY - rodR;
      max.y = rodY + rodR;
      min.z = cavity.min.z + cavity.size.z * 0.35;
      max.z = min.z + HANGER_DIAMETER_MM;
    } else if (item.kind === "shelf") {
      max.y = min.y + SHELF_THICKNESS_MM;
    }
    placed.push({
      id: item.id,
      kind: item.kind,
      min,
      max,
      size: {
        x: max.x - min.x,
        y: max.y - min.y,
        z: max.z - min.z,
      },
      center: {
        x: (min.x + max.x) / 2,
        y: (min.y + max.y) / 2,
        z: (min.z + max.z) / 2,
      },
    });
  }
  return placed;
}

function vecBox(min: CabinVec3, max: CabinVec3): Pick<DrawerTubPanel, "min" | "max" | "center" | "size"> {
  return {
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
  };
}

/** Open-top drawer tub. Front outer face meets CEKMECE_KAPAK inner face. No lid. */
export function drawerTubPanels(placed: PlacedFitting): DrawerTubPanel[] {
  const { min, max } = placed;
  const t = DRAWER_WALL_MM;
  const wallH =
    placed.kind === "drawer320" ? DRAWER_320_WALL_MM : DRAWER_160_WALL_MM;
  const x0 = min.x;
  const x1 = max.x;
  const y0 = min.y;
  const y1 = y0 + wallH;
  const z0 = min.z;
  const z1 = max.z;
  return [
    { role: "bottom", ...vecBox({ x: x0, y: y0, z: z0 }, { x: x1, y: y0 + t, z: z1 }) },
    { role: "left", ...vecBox({ x: x0, y: y0, z: z0 }, { x: x0 + t, y: y1, z: z1 }) },
    { role: "right", ...vecBox({ x: x1 - t, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }) },
    { role: "back", ...vecBox({ x: x0 + t, y: y0, z: z0 }, { x: x1 - t, y: y1, z: z0 + t }) },
    { role: "front", ...vecBox({ x: x0 + t, y: y0, z: z1 - t }, { x: x1 - t, y: y1, z: z1 }) },
  ];
}

function frontPanelBox(
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  thick: number,
): CabinDoorLeaf {
  const min = { x, y, z };
  const max = { x: x + w, y: y + h, z: z + thick };
  return {
    id,
    min,
    max,
    size: { x: w, y: h, z: thick },
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
  };
}

function doorLeafBox(
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
): CabinDoorLeaf {
  return frontPanelBox(id, x, y, z, w, h, DOOR_THICKNESS_MM);
}

/** CEKMECE_KAPAK: same Y0 as KAPAK (65.5), W−3 and H−3. Gap of 3 mm is at band top. */
export function layoutDrawerFronts(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinDoorLeaf[] {
  const fronts: CabinDoorLeaf[] = [];
  const inset = OVERLAY_INSET_MM;
  let y = overlayFrontY0Mm();
  for (const item of drawerPrefix(fittings)) {
    const occupy = drawerBandMm(item.kind);
    const h = occupy - DOOR_OVERLAY_W_MM;
    fronts.push(
      frontPanelBox(
        `drawerFront-${item.id}`,
        inset,
        y,
        size.depthMm,
        size.widthMm - DOOR_OVERLAY_W_MM,
        h,
        DRAWER_FRONT_MM,
      ),
    );
    y += occupy;
  }
  return fronts;
}

export function layoutDoors(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinDoorLeaf[] {
  if (!canHaveDoor(size, fittings)) return [];
  const height = doorClearHeightMm(size, fittings);
  const y = doorMinYMm(size, fittings);
  const z = size.depthMm;
  const inset = DOOR_OVERLAY_W_MM * 0.5;
  if (doorLeafCount(size.widthMm) === 1) {
    return [
      doorLeafBox(
        "door-0",
        inset,
        y,
        z,
        size.widthMm - DOOR_OVERLAY_W_MM,
        height,
      ),
    ];
  }
  const leafW = size.widthMm >= 960 ? 477 : 317;
  return [
    doorLeafBox("door-0", inset, y, z, leafW, height),
    doorLeafBox("door-1", size.widthMm - inset - leafW, y, z, leafW, height),
  ];
}
