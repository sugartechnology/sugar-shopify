// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/fittings.ts

import { cabinCavity } from "./buildCabinPanels";
import { nearestDepth } from "./grid";
import { CABINET_RULES, frontThicknessMm, maxHangers, maxShelves } from "./rules";
import type {
  CabinCavity,
  CabinFitKind,
  CabinFitting,
  CabinSize,
  CabinUnit,
  CabinVec3,
} from "./types";

// Sizes below are PnP-3D's 3D model (measured on its KOSHOY-TEST designs).
// Rules the product team may change live in rules.ts.

export const SHELF_THICKNESS_MM = 16;
/** Shelf depth: 1 mm off the back panel, 2 mm behind the front edge (z 25 … D − 2). */
export const SHELF_BACK_GAP_MM = 1;
export const SHELF_FRONT_SETBACK_MM = 2;
export const DRAWER_160_MM = 160;
export const DRAWER_320_MM = 320;
/** Hanger rod: a 28 × 15 mm profile, 4 mm off each side panel (W − 40 long). */
export const HANGER_ROD_HEIGHT_MM = 28;
export const HANGER_ROD_DEPTH_MM = 15;
export const HANGER_ROD_SIDE_GAP_MM = 4;
/** Rod centre from the back (z) per body depth (PnP-3D, measured 28 Oct). */
export const HANGER_ROD_Z_MM: Readonly<Record<number, number>> = { 320: 155, 480: 219, 640: 347 };
/** The flange holding each rod end on the side panel. */
export const HANGER_FLANGE_WIDTH_MM = 13;
export const HANGER_FLANGE_DEPTH_MM = 18.6;
/** Flange extent under / over the rod centre (42.8 mm in all). */
export const HANGER_FLANGE_BELOW_MM = 15.7;
export const HANGER_FLANGE_ABOVE_MM = 27.1;
export const HANGER_MIN_ZONE_MM = 400;
/** Rod centre under the shelf or top panel above it (PnP-3D: 2186.32 in a 2304 vestiyer). */
export const HANGER_DROP_MM = 101.68;
/**
 * Two hangers: PnP-3D gives each 1120 mm from the top and puts the shelf
 * between them 8 mm above the lower one's zone (2304: shelf 1176, rods
 * 2186.32 / 1066.32).
 */
export const HANGER_SHELF_LIFT_MM = 8;
/** Free shelves sit on a 160 mm grid (PnP-3D: 248 / 408 / 568 with a plinth). */
export const SHELF_GRID_MM = 160;
export const DOOR_OVERLAY_W_MM = 3;
export const DOOR_OVERLAY_H_MM = 67;
/** Same 1.5 mm side/top pay as W−3 / MCP KAPAK (Y 65.5 … H−1.5). */
export const OVERLAY_INSET_MM = DOOR_OVERLAY_W_MM * 0.5;
/**
 * Smallest door zone: one 160 mm front band, i.e. the 157 mm KAPAK of a 224
 * body plus its 1.5 mm gap at the bottom and top.
 */
export const DOOR_MIN_HEIGHT_MM = 160;
export const DRAWER_WALL_MM = 16;
export const DRAWER_160_WALL_MM = 90;
export const DRAWER_320_WALL_MM = 210;
/** Drawer box sides stand 6.5 mm off the side panels (rails). */
export const DRAWER_RAIL_GAP_MM = 6.5;
/** Box sides start 36.5 mm above the band bottom (43 above the front's lower edge). */
export const DRAWER_TUB_LIFT_MM = 36.5;
/** 8 mm bottom, 10.5 mm above the side's lower edge, in 7 mm grooves of the sides, back and front. */
export const DRAWER_BOTTOM_MM = 8;
export const DRAWER_BOTTOM_LIFT_MM = 10.5;
export const DRAWER_GROOVE_MM = 7;
/** Box depth from the back's outer face to the drawer front, per body depth (rail length). */
export const DRAWER_BOX_DEPTH_MM: Readonly<Record<number, number>> = { 320: 250, 480: 400, 640: 450 };
export const CLOSING_SHELF_ID = "kapatan-raf";
/** Shelf between two hangers; more than two get `aski-rafi-2`, … */
export const HANGER_SHELF_ID = "aski-rafi";

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

export interface CabinBox {
  min: CabinVec3;
  max: CabinVec3;
  center: CabinVec3;
  size: CabinVec3;
}

/** Open-top box; the drawer front closes it. */
export interface DrawerTubPanel extends CabinBox {
  role: "bottom" | "left" | "right" | "back";
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

/** Shelves the layout adds by itself (closing shelf, hanger shelf). */
export function isAutoShelfId(id: string): boolean {
  return id === CLOSING_SHELF_ID || id === HANGER_SHELF_ID || id.startsWith(`${HANGER_SHELF_ID}-`);
}

/**
 * Adds the shelves the catalog puts in by itself:
 * - a hanger shelf between two hangers; the lower hanger hangs from it
 *   (PnP-3D adds it with the second hanger);
 * - the closing shelf above the drawer bank, unless the user already put a
 *   shelf there or the bank reaches the top panel (nothing above to close off).
 */
export function fittingsWithAutoShelves(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  const list = cloneFittings(fittings);
  let hangerShelves = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].kind !== "hanger" || list[i - 1].kind !== "hanger") continue;
    hangerShelves++;
    const id = hangerShelves === 1 ? HANGER_SHELF_ID : `${HANGER_SHELF_ID}-${hangerShelves}`;
    list.splice(i, 0, { id, kind: "shelf" });
    i++;
  }
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
  const list = fittingsWithAutoShelves(size, fittings);
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
    // A hanger shelf only comes with the hanger above it.
    if (isAutoShelfId(free[n - 1].id)) continue;
    const placed = layoutFreeFittings(size, y, free.slice(0, n));
    if (placed) return stacked.concat(placed);
  }
  return stacked;
}

/**
 * Grid lines for free shelves above `startY`: shelf bottoms on cavity bottom
 * + 16 + 160·k, at least one grid step above `startY`. The top line is the
 * last one PnP-3D's shelf count allows (`maxShelves`): with a plinth it
 * leaves 104 mm under the top panel (544: 248 and 408).
 */
function shelfLinesMm(size: CabinSize, cavity: CabinCavity, startY: number): number[] {
  const lines: number[] = [];
  const lastK = maxShelves(size.heightMm, 0);
  for (let k = 0; k <= lastK; k++) {
    const y = cavity.min.y + SHELF_THICKNESS_MM + SHELF_GRID_MM * k;
    if (y + SHELF_THICKNESS_MM > cavity.max.y) break;
    if (y - startY >= SHELF_GRID_MM) lines.push(y);
  }
  return lines;
}

/**
 * Shelves and hangers above `startY` (the drawer bank, or the cavity bottom).
 * The shelves split the space into gaps, counted in grid steps; a hanger hangs
 * in the gap it is listed in, its rod 101.68 mm under the shelf or top panel
 * above. Without hangers the gaps get the same number of whole steps; with
 * hangers the other gaps get one step and the hanger gaps share the rest.
 * Spare steps go to the lowest gaps. Only when there are too few whole steps
 * does the top gap take the short step under the top panel. Two hangers on
 * top follow PnP-3D's 1120 mm zones (`HANGER_SHELF_LIFT_MM`). Undefined when
 * the fittings do not fit.
 */
function layoutFreeFittings(
  size: CabinSize,
  startY: number,
  items: readonly CabinFitting[],
): StackedFitting[] | undefined {
  const cavity = cabinCavity(size);
  const lines = shelfLinesMm(size, cavity, startY);
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
  if (gapCount > lines.length + 1) return undefined;
  const wholeLines = lines.filter((y) => y + SHELF_THICKNESS_MM + SHELF_GRID_MM <= cavity.max.y);
  let spare = Math.max(0, wholeLines.length + 1 - gapCount);
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
  // Where the rod hangs from: the shelf above, or the lower hanger zone's top.
  const hangTop: number[] = [];
  for (let g = 0; g < gapCount; g++) hangTop.push(gapTop(g));
  const topGap = gapCount - 1;
  if (topGap > 0 && hangerGaps.includes(topGap) && hangerGaps.includes(topGap - 1)) {
    const zoneTop = cavity.max.y - CABINET_RULES.hangerZoneMm;
    if (zoneTop - gapBottom(topGap - 1) >= HANGER_MIN_ZONE_MM) {
      shelfY[topGap - 1] = zoneTop + HANGER_SHELF_LIFT_MM;
      hangTop[topGap - 1] = zoneTop;
    }
  }
  for (const g of hangerGaps) {
    if (gapTop(g) - gapBottom(g) < HANGER_MIN_ZONE_MM) return undefined;
  }
  return items.map((item, index) => {
    if (item.kind === "shelf") {
      const y0 = shelfY[gapOfItem[index] - 1];
      return { item, y0, y1: y0 + SHELF_THICKNESS_MM };
    }
    const g = gapOfItem[index];
    return { item, y0: gapBottom(g), y1: hangTop[g] };
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

/** The door zone (leaf + 1.5 mm gap at the bottom and top) has to be ≥ 160 mm. */
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
  if (interiorRuleExcess(size, next) > interiorRuleExcess(size, fittings)) return false;
  if (options?.hasDoor && isDrawerKind(kind)) return canHaveDoor(size, next);
  return true;
}

/**
 * Breaks of PnP-3D's capacity rules (`CABINET_RULES`), on top of what fits:
 * - hangers past `maxHangers`;
 * - shelves past `maxShelves`, auto shelves included;
 * - a shelf or drawer box inside a hanger zone. PnP-3D gives the hangers
 *   1120 mm each from the top panel down ("Askı Alanı") and reports any part
 *   that touches it, so nothing goes above a hanger and only short parts
 *   below it (2304: six shelves under one hanger, nothing under two). The
 *   shelf between two hangers belongs to them.
 * These are counted, not trimmed: a stored design past them still opens and
 * can be fixed by removing parts; an edit may not add to them.
 */
export function interiorRuleIssues(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): string[] {
  const issues: string[] = [];
  const list = fittingsWithAutoShelves(size, fittings);
  const hangers = list.filter((item) => item.kind === "hanger").length;
  const hangerCap = maxHangers(size.heightMm);
  if (hangers > hangerCap) issues.push(`${hangers} hangers, at most ${hangerCap}`);
  const shelves = list.filter((item) => item.kind === "shelf").length;
  const drawerSteps = drawerRunOccupyMm(size, list) / SHELF_GRID_MM;
  const shelfCap = maxShelves(size.heightMm, drawerSteps);
  if (shelves > shelfCap) issues.push(`${shelves} shelves, at most ${shelfCap}`);
  for (const part of hangerZoneParts(size, list)) issues.push(`${part} in the hanger zone`);
  return issues;
}

/** Kinds of the placed parts that reach into the hanger zone (see above). */
function hangerZoneParts(size: CabinSize, list: readonly CabinFitting[]): CabinFitKind[] {
  const hangers = list.filter((item) => item.kind === "hanger").length;
  if (hangers === 0) return [];
  const cavity = cabinCavity(size);
  const zoneBottom = cavity.max.y - CABINET_RULES.hangerZoneMm * hangers;
  const between = new Set<string>();
  list.forEach((item, i) => {
    if (item.kind === "shelf" && list[i - 1]?.kind === "hanger" && list[i + 1]?.kind === "hanger") {
      between.add(item.id);
    }
  });
  const parts: CabinFitKind[] = [];
  for (const placed of layoutFittings(size, list)) {
    if (placed.kind === "hanger" || between.has(placed.id)) continue;
    // A drawer counts by its box (the front is outside the body).
    const top = isDrawerKind(placed.kind)
      ? Math.max(...drawerTubPanels(placed).map((panel) => panel.max.y))
      : placed.max.y;
    if (top > zoneBottom) parts.push(placed.kind);
  }
  return parts;
}

/** How far a unit is past the capacity rules; 0 = within them. */
export function interiorRuleExcess(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  const list = fittingsWithAutoShelves(size, fittings);
  const hangers = list.filter((item) => item.kind === "hanger").length;
  const shelves = list.filter((item) => item.kind === "shelf").length;
  const drawerSteps = drawerRunOccupyMm(size, list) / SHELF_GRID_MM;
  return (
    Math.max(0, hangers - maxHangers(size.heightMm)) +
    Math.max(0, shelves - maxShelves(size.heightMm, drawerSteps)) +
    hangerZoneParts(size, list).length
  );
}

export function trimFittings(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  return stackFittings(size, fittings)
    .filter(({ item }) => !isAutoShelfId(item.id))
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
  const { hasCrown, ...rest } = unit;
  return {
    ...rest,
    fittings,
    hasDoor,
    doorOpen: hasDoor && (unit.doorOpen ?? false),
    // Only written when on, so stored designs without a crown stay as they were.
    ...(hasCrown === true ? { hasCrown: true } : {}),
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
      // The rod; its flanges come from `hangerFlanges`.
      const rodY = max.y - HANGER_DROP_MM;
      const rodZ = hangerRodZMm(size.depthMm);
      min.x = cavity.min.x + HANGER_ROD_SIDE_GAP_MM;
      max.x = cavity.max.x - HANGER_ROD_SIDE_GAP_MM;
      min.y = rodY - HANGER_ROD_HEIGHT_MM / 2;
      max.y = rodY + HANGER_ROD_HEIGHT_MM / 2;
      min.z = rodZ - HANGER_ROD_DEPTH_MM / 2;
      max.z = rodZ + HANGER_ROD_DEPTH_MM / 2;
    } else if (item.kind === "shelf") {
      max.y = min.y + SHELF_THICKNESS_MM;
      min.z = cavity.min.z + SHELF_BACK_GAP_MM;
      max.z = cavity.max.z - SHELF_FRONT_SETBACK_MM;
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

function hangerRodZMm(depthMm: number): number {
  return HANGER_ROD_Z_MM[nearestDepth(depthMm)];
}

function vecBox(min: CabinVec3, max: CabinVec3): CabinBox {
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

/**
 * Drawer box inside its band (PnP-3D): two sides on the rails, a back across
 * them and an 8 mm bottom in grooves. The drawer front closes it; there is
 * no front panel and no lid. Only the 3D view draws it (the BOM has one
 * CEKMECE line).
 */
export function drawerTubPanels(placed: PlacedFitting): DrawerTubPanel[] {
  const { min, max } = placed;
  const t = DRAWER_WALL_MM;
  const g = DRAWER_GROOVE_MM;
  const wallH =
    placed.kind === "drawer320" ? DRAWER_320_WALL_MM : DRAWER_160_WALL_MM;
  const x0 = min.x + DRAWER_RAIL_GAP_MM;
  const x1 = max.x - DRAWER_RAIL_GAP_MM;
  const y0 = min.y + DRAWER_TUB_LIFT_MM;
  const y1 = y0 + wallH;
  // The band reaches the body front (max.z = D), where the drawer front starts.
  const z1 = max.z;
  const z0 = z1 - DRAWER_BOX_DEPTH_MM[nearestDepth(max.z)];
  const bottomY = y0 + DRAWER_BOTTOM_LIFT_MM;
  return [
    {
      role: "bottom",
      ...vecBox(
        { x: x0 + t - g, y: bottomY, z: z0 + t - g },
        { x: x1 - t + g, y: bottomY + DRAWER_BOTTOM_MM, z: z1 + g },
      ),
    },
    { role: "left", ...vecBox({ x: x0, y: y0, z: z0 + t }, { x: x0 + t, y: y1, z: z1 }) },
    { role: "right", ...vecBox({ x: x1 - t, y: y0, z: z0 + t }, { x: x1, y: y1, z: z1 }) },
    { role: "back", ...vecBox({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z0 + t }) },
  ];
}

/** The two flanges holding a hanger rod (`placed` is the rod), on the side panels. */
export function hangerFlanges(placed: PlacedFitting): CabinBox[] {
  const y0 = placed.center.y - HANGER_FLANGE_BELOW_MM;
  const y1 = placed.center.y + HANGER_FLANGE_ABOVE_MM;
  const z0 = placed.center.z - HANGER_FLANGE_DEPTH_MM / 2;
  const z1 = placed.center.z + HANGER_FLANGE_DEPTH_MM / 2;
  const left = placed.min.x - HANGER_ROD_SIDE_GAP_MM;
  const right = placed.max.x + HANGER_ROD_SIDE_GAP_MM;
  return [
    vecBox({ x: left, y: y0, z: z0 }, { x: left + HANGER_FLANGE_WIDTH_MM, y: y1, z: z1 }),
    vecBox({ x: right - HANGER_FLANGE_WIDTH_MM, y: y0, z: z0 }, { x: right, y: y1, z: z1 }),
  ];
}

/**
 * Crown (TAC) on the body: full width, 25 mm, overhanging the front by
 * 20 mm (D + 20). Doors keep their 1.5 mm gap under it; only the 16 mm top
 * panel edge shows between door and crown.
 */
export function layoutCrown(size: CabinSize): CabinBox {
  const { crownThicknessMm, crownExtraDepthMm } = CABINET_RULES;
  return vecBox(
    { x: 0, y: size.heightMm, z: 0 },
    { x: size.widthMm, y: size.heightMm + crownThicknessMm, z: size.depthMm + crownExtraDepthMm },
  );
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

/**
 * CEKMECE_KAPAK: same Y0 as KAPAK (65.5), W−3 and H−3. Gap of 3 mm is at band
 * top. `thicknessMm` comes from the front series (`frontThicknessMm`).
 */
export function layoutDrawerFronts(
  size: CabinSize,
  fittings: readonly CabinFitting[],
  thicknessMm: number = frontThicknessMm(),
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
        thicknessMm,
      ),
    );
    y += occupy;
  }
  return fronts;
}

/** Door leaves; `thicknessMm` comes from the front series (`frontThicknessMm`). */
export function layoutDoors(
  size: CabinSize,
  fittings: readonly CabinFitting[],
  thicknessMm: number = frontThicknessMm(),
): CabinDoorLeaf[] {
  if (!canHaveDoor(size, fittings)) return [];
  const height = doorClearHeightMm(size, fittings);
  const y = doorMinYMm(size, fittings);
  const z = size.depthMm;
  const inset = DOOR_OVERLAY_W_MM * 0.5;
  if (doorLeafCount(size.widthMm) === 1) {
    return [
      frontPanelBox("door-0", inset, y, z, size.widthMm - DOOR_OVERLAY_W_MM, height, thicknessMm),
    ];
  }
  const leafW = size.widthMm >= 960 ? 477 : 317;
  return [
    frontPanelBox("door-0", inset, y, z, leafW, height, thicknessMm),
    frontPanelBox("door-1", size.widthMm - inset - leafW, y, z, leafW, height, thicknessMm),
  ];
}
