// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/fittings.ts

import { cabinCavity } from "./buildCabinPanels";
import type {
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
export const HANGER_PREF_ZONE_MM = 800;
export const DOOR_OVERLAY_W_MM = 3;
export const DOOR_OVERLAY_H_MM = 67;
/** Same 1.5 mm side/top pay as W−3 / MCP KAPAK (Y 65.5 … H−1.5). */
export const OVERLAY_INSET_MM = DOOR_OVERLAY_W_MM * 0.5;
export const DOOR_THICKNESS_MM = 18;
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

export function occupyMm(kind: CabinFitKind, remainingMm: number): number | undefined {
  if (kind === "drawer160") return remainingMm >= DRAWER_160_MM ? DRAWER_160_MM : undefined;
  if (kind === "drawer320") return remainingMm >= DRAWER_320_MM ? DRAWER_320_MM : undefined;
  if (kind === "shelf") {
    return remainingMm >= SHELF_THICKNESS_MM ? SHELF_THICKNESS_MM : undefined;
  }
  if (remainingMm < HANGER_MIN_ZONE_MM) return undefined;
  return Math.min(HANGER_PREF_ZONE_MM, remainingMm);
}

export function fittingsWithClosingShelf(
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  const list = cloneFittings(fittings);
  const n = drawerPrefix(list).length;
  if (n === 0 || list[n]?.kind === "shelf") return list;
  list.splice(n, 0, { id: CLOSING_SHELF_ID, kind: "shelf" });
  return list;
}

export function usedFittingHeightMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  const cavity = cabinCavity(size);
  let used = 0;
  for (const item of fittingsWithClosingShelf(fittings)) {
    const occupy = occupyMm(item.kind, cavity.size.y - used);
    if (occupy === undefined) break;
    used += occupy;
  }
  return used;
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

export function drawerRunOccupyMm(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): number {
  const cavityH = cabinCavity(size).size.y;
  let used = 0;
  for (const item of drawerPrefix(fittings)) {
    const occupy = occupyMm(item.kind, cavityH - used);
    if (occupy === undefined) break;
    used += occupy;
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

export function canHaveDoor(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): boolean {
  return doorClearHeightMm(size, fittings) >= DOOR_MIN_HEIGHT_MM;
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
  if (occupyMm(kind, remainingCavityMm(size, fittings)) === undefined) {
    return false;
  }
  if (options?.hasDoor && isDrawerKind(kind)) {
    const next = [...fittings, { id: "next", kind }];
    return canHaveDoor(size, next);
  }
  return true;
}

export function trimFittings(
  size: CabinSize,
  fittings: readonly CabinFitting[],
): CabinFitting[] {
  const cavityH = cabinCavity(size).size.y;
  const kept: CabinFitting[] = [];
  let used = 0;
  for (const item of fittingsWithClosingShelf(fittings)) {
    const occupy = occupyMm(item.kind, cavityH - used);
    if (occupy === undefined) break;
    used += occupy;
    if (item.id === CLOSING_SHELF_ID) continue;
    kept.push({ ...item });
  }
  return kept;
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
  let y = cavity.min.y;
  for (const item of fittingsWithClosingShelf(fittings)) {
    const occupy = occupyMm(item.kind, cavity.max.y - y);
    if (occupy === undefined) break;
    const min = { x: cavity.min.x, y, z: cavity.min.z };
    const max = { x: cavity.max.x, y: y + occupy, z: cavity.max.z };
    if (item.kind === "hanger") {
      const rodR = HANGER_DIAMETER_MM * 0.5;
      const rodY = max.y - 20;
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
    y += occupy;
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
    const occupy = item.kind === "drawer320" ? DRAWER_320_MM : DRAWER_160_MM;
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
  const height = doorClearHeightMm(size, fittings);
  if (height < DOOR_MIN_HEIGHT_MM) return [];
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
