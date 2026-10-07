// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/composeCabins.ts

import { normalizeCabinColor } from "./colors";
import {
  addFitting,
  cloneFittings,
  isDrawerKind,
  normalizeUnitInterior,
  removeFitting,
} from "./fittings";
import {
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  nearestHeight,
  nearestWidth,
  nextWidthAbove,
} from "./grid";
import type {
  CabinColorId,
  CabinComposition,
  CabinFitKind,
  CabinUnit,
} from "./types";

function emptyInterior(): Pick<CabinUnit, "fittings" | "hasDoor" | "doorOpen"> {
  return { fittings: [], hasDoor: false, doorOpen: false };
}

export function cloneCabinUnits(units: readonly CabinUnit[]): CabinUnit[] {
  return units.map((unit) => cloneCabinUnit(unit));
}

function cloneCabinUnit(unit: CabinUnit): CabinUnit {
  return {
    ...unit,
    fittings: cloneFittings(unit.fittings ?? []),
    hasDoor: unit.hasDoor ?? false,
    doorOpen: unit.doorOpen ?? false,
    color: normalizeCabinColor(unit.color),
    doorColor: unit.doorColor ? normalizeCabinColor(unit.doorColor) : undefined,
  };
}

export function cloneCabinComposition(
  composition: CabinComposition,
): CabinComposition {
  const units = cloneCabinUnits(composition.units);
  return {
    units,
    depthMm: composition.depthMm,
    hasPlinth: composition.hasPlinth,
    color: normalizeCabinColor(composition.color),
    widestUnits: cloneCabinUnits(composition.widestUnits ?? units),
  };
}

export function totalWidthMm(units: readonly CabinUnit[]): number {
  let total = 0;
  for (const unit of units) total += unit.widthMm;
  return total;
}

export function maxHeightMm(units: readonly CabinUnit[]): number {
  let max: number = CABIN_HEIGHTS_MM[0];
  for (const unit of units) {
    if (unit.heightMm > max) max = unit.heightMm;
  }
  return max;
}

export function largestWidthAtMost(maxMm: number): number | undefined {
  let best: number | undefined;
  for (const width of CABIN_WIDTHS_MM) {
    if (width <= maxMm && (best === undefined || width > best)) best = width;
  }
  return best;
}

export function nextCabinUnitId(units: readonly CabinUnit[]): string {
  let max = 0;
  for (const unit of units) {
    const match = /^cabin-(\d+)$/.exec(unit.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `cabin-${max + 1}`;
}

export function syncCompositionToWidth(
  composition: CabinComposition,
  targetMm: number,
): CabinComposition {
  const cap = Math.min(
    Math.max(targetMm, CABIN_WIDTHS_MM[0]),
    CABIN_TOTAL_WIDTH_MAX_MM,
  );
  const next = cloneCabinComposition(composition);
  if (next.units.length === 0) {
    next.units = [defaultCabinUnit()];
  }
  next.widestUnits = syncWidestUnits(next.units, next.widestUnits);
  const total = totalWidthMm(next.units);
  if (total < cap) expandUnits(next, cap);
  else if (total > cap) shrinkUnits(next, cap);
  next.widestUnits = syncWidestUnits(next.units, next.widestUnits);
  return next;
}

/** Visible units only; memory is dropped. Prefer syncCompositionToWidth. */
export function syncUnitsToWidth(
  units: readonly CabinUnit[],
  targetMm: number,
): CabinUnit[] {
  return syncCompositionToWidth(
    { units: cloneCabinUnits(units), depthMm: 640, hasPlinth: true },
    targetMm,
  ).units;
}

function defaultCabinUnit(): CabinUnit {
  return {
    id: "cabin-1",
    widthMm: CABIN_WIDTHS_MM[0],
    heightMm: CABIN_HEIGHTS_MM[CABIN_HEIGHTS_MM.length - 1],
    color: "wood",
    ...emptyInterior(),
  };
}

function syncWidestUnits(
  units: readonly CabinUnit[],
  widest: readonly CabinUnit[] | undefined,
): CabinUnit[] {
  const next = cloneCabinUnits(widest ?? []);
  for (let i = 0; i < units.length; i++) {
    const visible = units[i];
    if (!next[i]) {
      next[i] = cloneCabinUnit(visible);
      continue;
    }
    const keptWidth = Math.max(next[i].widthMm, visible.widthMm);
    next[i] = cloneCabinUnit(visible);
    next[i].widthMm = keptWidth;
  }
  return next;
}

export function setUnitWidth(
  units: readonly CabinUnit[],
  id: string,
  widthMm: number,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  if (!unit) return next;
  const others = totalWidthMm(next) - unit.widthMm;
  const snapped = nearestWidth(widthMm);
  const allowed = largestWidthAtMost(
    Math.min(snapped, CABIN_TOTAL_WIDTH_MAX_MM - others),
  );
  if (allowed !== undefined) unit.widthMm = allowed;
  return next;
}

export function setUnitHeight(
  units: readonly CabinUnit[],
  id: string,
  heightMm: number,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  if (unit) unit.heightMm = nearestHeight(heightMm);
  return next;
}

export function setMaxHeight(
  units: readonly CabinUnit[],
  heightMm: number,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const oldMax = maxHeightMm(next);
  const nextHeight = nearestHeight(heightMm);
  for (const unit of next) {
    if (unit.heightMm === oldMax) unit.heightMm = nextHeight;
  }
  return next;
}

export function normalizeComposition(
  composition: CabinComposition,
): CabinComposition {
  const color = normalizeCabinColor(composition.color);
  const units = composition.units.map((unit) =>
    normalizeUnitColors(
      normalizeUnitInterior(unit, composition.depthMm, composition.hasPlinth),
      color,
    ),
  );
  const widestUnits = syncWidestUnits(units, composition.widestUnits).map(
    (unit, index) => {
      if (index < units.length) return unit;
      return normalizeUnitColors(
        normalizeUnitInterior(unit, composition.depthMm, composition.hasPlinth),
        unit.color ?? color,
      );
    },
  );
  return {
    ...composition,
    color,
    units,
    widestUnits,
  };
}

function normalizeUnitColors(unit: CabinUnit, fallback: CabinColorId): CabinUnit {
  const color = normalizeCabinColor(unit.color ?? fallback);
  return {
    ...unit,
    color,
    doorColor: unit.hasDoor
      ? normalizeCabinColor(unit.doorColor ?? color)
      : undefined,
    fittings: (unit.fittings ?? []).map((item) =>
      isDrawerKind(item.kind)
        ? { ...item, color: normalizeCabinColor(item.color ?? color) }
        : { ...item, color: undefined },
    ),
  };
}

function paintUnit(unit: CabinUnit, color: CabinColorId): CabinUnit {
  const next = cloneCabinUnit(unit);
  next.color = color;
  next.doorColor = next.hasDoor ? color : undefined;
  next.fittings = next.fittings.map((item) =>
    isDrawerKind(item.kind) ? { ...item, color } : { ...item, color: undefined },
  );
  return next;
}

export function setCompositionColor(
  composition: CabinComposition,
  color: CabinColorId,
): CabinComposition {
  const next = normalizeCabinColor(color);
  return {
    ...cloneCabinComposition(composition),
    color: next,
    units: composition.units.map((unit) => paintUnit(unit, next)),
  };
}

export function setUnitColor(
  units: readonly CabinUnit[],
  id: string,
  color: CabinColorId,
): CabinUnit[] {
  const next = normalizeCabinColor(color);
  return units.map((unit) => (unit.id === id ? paintUnit(unit, next) : cloneCabinUnit(unit)));
}

export function setUnitDoorColor(
  units: readonly CabinUnit[],
  id: string,
  color: CabinColorId,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  if (unit?.hasDoor) unit.doorColor = normalizeCabinColor(color);
  return next;
}

export function setFittingColor(
  units: readonly CabinUnit[],
  id: string,
  fittingId: string,
  color: CabinColorId,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  const fitting = unit?.fittings.find((item) => item.id === fittingId);
  if (fitting && isDrawerKind(fitting.kind)) {
    fitting.color = normalizeCabinColor(color);
  }
  return next;
}

export function setUnitDoor(
  units: readonly CabinUnit[],
  id: string,
  hasDoor: boolean,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  if (unit) {
    unit.hasDoor = hasDoor;
    if (!hasDoor) {
      unit.doorOpen = false;
      unit.doorColor = undefined;
    } else {
      unit.doorColor = normalizeCabinColor(unit.doorColor ?? unit.color);
    }
  }
  return next;
}

export function setUnitDoorOpen(
  units: readonly CabinUnit[],
  id: string,
  doorOpen: boolean,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  if (unit?.hasDoor) unit.doorOpen = doorOpen;
  return next;
}

export function setFittingOpen(
  units: readonly CabinUnit[],
  id: string,
  fittingId: string,
  open: boolean,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const unit = next.find((item) => item.id === id);
  const fitting = unit?.fittings.find((item) => item.id === fittingId);
  if (fitting) fitting.open = open;
  return next;
}

export function unitInteriorStructureEqual(a: CabinUnit, b: CabinUnit): boolean {
  if ((a.hasDoor ?? false) !== (b.hasDoor ?? false)) return false;
  const left = a.fittings ?? [];
  const right = b.fittings ?? [];
  if (left.length !== right.length) return false;
  return left.every(
    (item, index) => item.id === right[index].id && item.kind === right[index].kind,
  );
}

export function unitOpenChanged(a: CabinUnit, b: CabinUnit): boolean {
  if ((a.doorOpen ?? false) !== (b.doorOpen ?? false)) return true;
  const left = a.fittings ?? [];
  const right = b.fittings ?? [];
  return left.some(
    (item, index) => (item.open ?? false) !== (right[index]?.open ?? false),
  );
}

export function addUnitFitting(
  units: readonly CabinUnit[],
  id: string,
  kind: CabinFitKind,
  depthMm: number,
  hasPlinth: boolean,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const index = next.findIndex((item) => item.id === id);
  if (index < 0) return next;
  const updated = addFitting(next[index], kind, depthMm, hasPlinth);
  if (updated) next[index] = updated;
  return next;
}

export function removeUnitFitting(
  units: readonly CabinUnit[],
  id: string,
  fittingId: string,
): CabinUnit[] {
  const next = cloneCabinUnits(units);
  const index = next.findIndex((item) => item.id === id);
  if (index < 0) return next;
  next[index] = removeFitting(next[index], fittingId);
  return next;
}

function expandUnits(composition: CabinComposition, targetMm: number): void {
  const units = composition.units;
  const widest = composition.widestUnits ?? [];
  composition.widestUnits = widest;
  let total = totalWidthMm(units);
  while (total < targetMm) {
    const remaining = Math.min(targetMm, CABIN_TOTAL_WIDTH_MAX_MM) - total;
    if (units.length === 0) break;
    const last = units[units.length - 1];
    const grown = nextWidthAbove(last.widthMm);
    if (grown !== undefined && grown - last.widthMm <= remaining) {
      total += grown - last.widthMm;
      last.widthMm = grown;
      continue;
    }
    const remembered = widest[units.length];
    if (remembered) {
      const widthMm = largestWidthAtMost(Math.min(remaining, remembered.widthMm));
      if (widthMm === undefined) break;
      const restored = cloneCabinUnit(remembered);
      restored.widthMm = widthMm;
      units.push(restored);
      total += widthMm;
      continue;
    }
    const widthMm = largestWidthAtMost(remaining);
    if (widthMm === undefined) break;
    const added = cloneCabinUnit(last);
    added.id = nextCabinUnitId([...units, ...widest]);
    added.widthMm = widthMm;
    units.push(added);
    widest.push(cloneCabinUnit(added));
    total += widthMm;
  }
}

function shrinkUnits(composition: CabinComposition, targetMm: number): void {
  const units = composition.units;
  let total = totalWidthMm(units);
  while (total > targetMm && units.length > 0) {
    const last = units[units.length - 1];
    const without = total - last.widthMm;
    if (without >= targetMm) {
      units.pop();
      total = without;
      if (units.length === 0) {
        units.push({
          ...cloneCabinUnit(last),
          widthMm: CABIN_WIDTHS_MM[0],
        });
        break;
      }
      continue;
    }
    const fit = largestWidthAtMost(targetMm - without);
    if (fit === undefined) {
      if (units.length > 1) {
        units.pop();
        total = without;
        continue;
      }
      last.widthMm = CABIN_WIDTHS_MM[0];
      break;
    }
    last.widthMm = fit;
    break;
  }
}
