// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/edit.ts

import { isCabinColorId } from "./colors";
import {
  normalizeComposition,
  removeUnitFitting,
  setCompositionColor,
  setUnitColor,
  setUnitDoor,
  setUnitDoorColor,
  setUnitHeight,
  setUnitWidth,
  syncCompositionToWidth,
  totalWidthMm,
} from "./composeCabins";
import {
  addFitting,
  canHaveDoor,
  cloneFittings,
  doorClearHeightMm,
  drawerPrefix,
  isDrawerKind,
  nextFittingId,
  trimFittings,
  CLOSING_SHELF_ID,
  DOOR_MIN_HEIGHT_MM,
  DOOR_OVERLAY_H_MM,
} from "./fittings";
import {
  CABIN_DEPTHS_MM,
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  nearestDepth,
  nearestHeight,
  nearestWidth,
} from "./grid";
import type {
  CabinColorId,
  CabinComposition,
  CabinFitKind,
  CabinFitting,
  CabinSize,
  CabinUnit,
} from "./types";

/** `unit` is a 0-based index into `composition.units`. */
export type EditOp =
  | { action: "add_fitting"; unit: number; kind: CabinFitKind }
  | { action: "remove_fitting"; unit: number; index: number }
  | { action: "set_unit_width"; unit: number; widthMm: number }
  | { action: "set_unit_height"; unit: number; heightMm: number }
  | { action: "set_total_width"; widthMm: number }
  | { action: "set_depth"; depthMm: number }
  | { action: "set_door"; unit: number; hasDoor: boolean }
  | {
      action: "set_color";
      target: "all" | "unit" | "door";
      /** Required for "unit". For "door", omitted = every door. */
      unit?: number;
      color: CabinColorId;
    };

export type EditRejectReason =
  /** Not an object or unknown action. */
  | "invalid_op"
  /** Missing / non-integer / out-of-range unit index. */
  | "invalid_unit"
  /** Bad size, kind, color, target or flag. */
  | "invalid_value"
  /** Not enough interior height left for the fitting. */
  | "no_room"
  /** Door would be shorter than 320 mm. */
  | "door_too_short"
  /** Door height has no catalog KAPAK (H − drawers is not a catalog height). */
  | "door_size_unavailable"
  | "fitting_not_found"
  /** Door color on a unit (or design) without a door. */
  | "no_door"
  /** Total width would pass 5000 mm. */
  | "total_width_exceeded"
  /** Total width under the smallest unit (320 mm). */
  | "total_width_too_small"
  /** Op is valid but changes nothing. */
  | "no_change"
  /** Input is malformed or off-catalog, so no edit can produce a valid result. */
  | "invalid_composition";

/** Side effects of an accepted op that the caller may want to mention. */
export type EditWarning = "fittings_trimmed" | "door_removed" | "units_removed";

export type EditResult =
  | { ok: true; composition: CabinComposition; warnings?: EditWarning[] }
  | { ok: false; reason: EditRejectReason };

const FIT_KINDS: readonly CabinFitKind[] = ["drawer160", "drawer320", "shelf", "hanger"];

/**
 * Applies one product-level edit with the same functions the side panel uses,
 * plus explicit rule checks so invalid ops are rejected instead of silently
 * ignored. The op may come straight from untrusted JSON. The input is never
 * mutated; an accepted result is normalized and passes `compositionIssues`.
 */
export function applyEditOp(
  composition: CabinComposition,
  op: EditOp,
): EditResult {
  if (!op || typeof op !== "object") return { ok: false, reason: "invalid_op" };
  if (!composition || !Array.isArray(composition.units)) {
    return { ok: false, reason: "invalid_composition" };
  }
  // Ops address units / fittings by index but the helpers match by id, and
  // normalizing silently drops a reserved-id fitting: check the raw input.
  if (identityIssues(composition.units).length > 0) {
    return { ok: false, reason: "invalid_composition" };
  }
  const base = normalizeComposition(composition);
  const next = applyOp(base, op);
  if (typeof next === "string") return { ok: false, reason: next };
  const normalized = normalizeComposition(next);
  if (normalized.units.some((unit) => unit.hasDoor && !hasCatalogDoor(unit, normalized))) {
    return { ok: false, reason: "door_size_unavailable" };
  }
  if (compositionIssues(normalized).length > 0) {
    return { ok: false, reason: "invalid_composition" };
  }
  if (sameComposition(base, normalized)) return { ok: false, reason: "no_change" };
  const warnings = editWarnings(base, normalized, op);
  return warnings.length > 0
    ? { ok: true, composition: normalized, warnings }
    : { ok: true, composition: normalized };
}

/**
 * KAPAK exists only as H − 67 for the catalog heights (48 records = 4 widths ×
 * 12 heights). A door above drawers is H − drawers − 67, so e.g. 2304 with one
 * 160 drawer (2144, grid 13) or 480 mm of drawers (1824, grid 11) has no part.
 */
export function isCatalogDoorHeight(heightMm: number): boolean {
  return CABIN_HEIGHTS_MM.some((height) => height - DOOR_OVERLAY_H_MM === heightMm);
}

/**
 * Catalog + interior rule violations, empty when valid. Messages are for
 * server logs and tests only.
 */
export function compositionIssues(composition: CabinComposition): string[] {
  const issues: string[] = [];
  const units = composition.units ?? [];
  if (units.length === 0) issues.push("no units");
  if (!isOneOf(CABIN_DEPTHS_MM, composition.depthMm)) {
    issues.push(`depth ${composition.depthMm} is not a catalog depth`);
  }
  const total = totalWidthMm(units);
  if (total > CABIN_TOTAL_WIDTH_MAX_MM) {
    issues.push(`total width ${total} exceeds ${CABIN_TOTAL_WIDTH_MAX_MM}`);
  }
  if (composition.color !== undefined && !isCabinColorId(composition.color)) {
    issues.push("invalid composition color");
  }
  issues.push(...identityIssues(units));
  units.forEach((unit, index) => {
    for (const issue of unitIssues(unit, composition)) {
      issues.push(`unit ${index}: ${issue}`);
    }
  });
  return issues;
}

/** Duplicate unit / fitting ids and fittings using the closing-shelf id. */
function identityIssues(units: readonly CabinUnit[]): string[] {
  const issues: string[] = [];
  const unitIds = new Set<string>();
  units.forEach((unit, index) => {
    if (unitIds.has(unit.id)) issues.push(`unit ${index}: duplicate unit id`);
    unitIds.add(unit.id);
    const fittingIds = new Set<string>();
    for (const item of unit.fittings ?? []) {
      if (item.id === CLOSING_SHELF_ID) {
        issues.push(`unit ${index}: reserved fitting id ${CLOSING_SHELF_ID}`);
      } else if (fittingIds.has(item.id)) {
        issues.push(`unit ${index}: duplicate fitting id`);
      }
      fittingIds.add(item.id);
    }
  });
  return issues;
}

function unitIssues(unit: CabinUnit, composition: CabinComposition): string[] {
  const issues: string[] = [];
  if (!isOneOf(CABIN_WIDTHS_MM, unit.widthMm)) {
    issues.push(`width ${unit.widthMm} is not a catalog width`);
  }
  if (!isOneOf(CABIN_HEIGHTS_MM, unit.heightMm)) {
    issues.push(`height ${unit.heightMm} is not a catalog height`);
  }
  if (unit.color !== undefined && !isCabinColorId(unit.color)) issues.push("invalid color");
  if (unit.doorColor !== undefined && !isCabinColorId(unit.doorColor)) {
    issues.push("invalid door color");
  }
  const fittings = unit.fittings ?? [];
  if (fittings.some((item) => !isFitKind(item.kind))) {
    issues.push("unknown fitting kind");
    return issues;
  }
  if (fittings.some((item) => item.color !== undefined && !isCabinColorId(item.color))) {
    issues.push("invalid fitting color");
  }
  const drawers = fittings.filter((item) => isDrawerKind(item.kind)).length;
  if (drawerPrefix(fittings).length !== drawers) {
    issues.push("drawers must sit at the bottom");
  }
  const size = unitSize(unit, composition);
  if (trimFittings(size, fittings).length !== fittings.length) {
    issues.push("fittings do not fit the interior");
  }
  if (unit.hasDoor && !canHaveDoor(size, fittings)) {
    issues.push(`door shorter than ${DOOR_MIN_HEIGHT_MM} mm`);
  } else if (unit.hasDoor && !hasCatalogDoor(unit, composition)) {
    issues.push(`door height ${doorClearHeightMm(size, fittings)} is not a catalog KAPAK`);
  }
  return issues;
}

function applyOp(
  c: CabinComposition,
  op: EditOp,
): CabinComposition | EditRejectReason {
  switch (op.action) {
    case "add_fitting":
      return addFittingOp(c, op.unit, op.kind);
    case "remove_fitting":
      return removeFittingOp(c, op.unit, op.index);
    case "set_unit_width":
      return unitWidthOp(c, op.unit, op.widthMm);
    case "set_unit_height":
      return unitHeightOp(c, op.unit, op.heightMm);
    case "set_total_width":
      return totalWidthOp(c, op.widthMm);
    case "set_depth":
      return depthOp(c, op.depthMm);
    case "set_door":
      return doorOp(c, op.unit, op.hasDoor);
    case "set_color":
      return colorOp(c, op.target, op.unit, op.color);
    default:
      return "invalid_op";
  }
}

function addFittingOp(
  c: CabinComposition,
  index: unknown,
  kind: unknown,
): CabinComposition | EditRejectReason {
  const unit = unitAt(c, index);
  if (!unit) return "invalid_unit";
  if (!isFitKind(kind)) return "invalid_value";
  if (isDrawerKind(kind)) return addDrawerOp(c, unit, kind);
  // Shelf / hanger: appended like the side panel; undefined = no room left.
  const updated = addFitting(unit, kind, c.depthMm, c.hasPlinth);
  if (!updated) return "no_room";
  return withUnit(c, unit, updated);
}

/**
 * The side panel only appends, so it refuses a drawer once a shelf or hanger
 * exists. Here the drawer goes on top of the bottom bank instead (index =
 * bank length): drawers stay a prefix ("Çekmeceler yalnız altta") and the
 * default gardırop / vestiyer units can still get one. Everything above the
 * bank has to keep fitting and the door has to stay ≥ 320 mm; the catalog
 * KAPAK height is checked by `applyEditOp`.
 */
function addDrawerOp(
  c: CabinComposition,
  unit: CabinUnit,
  kind: CabinFitKind,
): CabinComposition | EditRejectReason {
  const size = unitSize(unit, c);
  const fittings = cloneFittings(unit.fittings ?? []);
  const added: CabinFitting = { id: nextFittingId(fittings), kind, color: unit.color };
  fittings.splice(drawerPrefix(fittings).length, 0, added);
  if (trimFittings(size, fittings).length !== fittings.length) return "no_room";
  if (unit.hasDoor && !canHaveDoor(size, fittings)) return "door_too_short";
  return withUnit(c, unit, { ...unit, fittings });
}

function removeFittingOp(
  c: CabinComposition,
  index: unknown,
  fittingIndex: unknown,
): CabinComposition | EditRejectReason {
  const unit = unitAt(c, index);
  if (!unit) return "invalid_unit";
  if (typeof fittingIndex !== "number" || !Number.isInteger(fittingIndex)) {
    return "fitting_not_found";
  }
  const fitting = (unit.fittings ?? [])[fittingIndex];
  if (!fitting) return "fitting_not_found";
  return { ...c, units: removeUnitFitting(c.units, unit.id, fitting.id) };
}

function unitWidthOp(
  c: CabinComposition,
  index: unknown,
  value: unknown,
): CabinComposition | EditRejectReason {
  const unit = unitAt(c, index);
  if (!unit) return "invalid_unit";
  if (!isPositive(value)) return "invalid_value";
  const widthMm = nearestWidth(value);
  if (totalWidthMm(c.units) - unit.widthMm + widthMm > CABIN_TOTAL_WIDTH_MAX_MM) {
    return "total_width_exceeded";
  }
  return { ...c, units: setUnitWidth(c.units, unit.id, widthMm) };
}

function unitHeightOp(
  c: CabinComposition,
  index: unknown,
  value: unknown,
): CabinComposition | EditRejectReason {
  const unit = unitAt(c, index);
  if (!unit) return "invalid_unit";
  if (!isPositive(value)) return "invalid_value";
  return { ...c, units: setUnitHeight(c.units, unit.id, nearestHeight(value)) };
}

function totalWidthOp(
  c: CabinComposition,
  value: unknown,
): CabinComposition | EditRejectReason {
  if (!isPositive(value)) return "invalid_value";
  if (value > CABIN_TOTAL_WIDTH_MAX_MM) return "total_width_exceeded";
  if (value < CABIN_WIDTHS_MM[0]) return "total_width_too_small";
  return syncCompositionToWidth(c, value);
}

function depthOp(
  c: CabinComposition,
  value: unknown,
): CabinComposition | EditRejectReason {
  if (!isPositive(value)) return "invalid_value";
  return { ...c, depthMm: nearestDepth(value) };
}

function doorOp(
  c: CabinComposition,
  index: unknown,
  hasDoor: unknown,
): CabinComposition | EditRejectReason {
  const unit = unitAt(c, index);
  if (!unit) return "invalid_unit";
  if (typeof hasDoor !== "boolean") return "invalid_value";
  if (hasDoor && !canHaveDoor(unitSize(unit, c), unit.fittings ?? [])) {
    return "door_too_short";
  }
  return { ...c, units: setUnitDoor(c.units, unit.id, hasDoor) };
}

function colorOp(
  c: CabinComposition,
  target: unknown,
  index: unknown,
  color: unknown,
): CabinComposition | EditRejectReason {
  if (!isCabinColorId(color)) return "invalid_value";
  if (target === "all") {
    // setCompositionColor paints visible units only; units hidden in the
    // width memory would come back in the old color on the next grow.
    const memory = setCompositionColor({ ...c, units: c.widestUnits ?? [] }, color).units;
    return { ...setCompositionColor(c, color), widestUnits: memory };
  }
  if (target === "unit") {
    const unit = unitAt(c, index);
    if (!unit) return "invalid_unit";
    return { ...c, units: setUnitColor(c.units, unit.id, color) };
  }
  if (target !== "door") return "invalid_value";
  if (index === undefined) {
    const doors = c.units.filter((unit) => unit.hasDoor);
    if (doors.length === 0) return "no_door";
    let units = c.units;
    for (const unit of doors) units = setUnitDoorColor(units, unit.id, color);
    return { ...c, units };
  }
  const unit = unitAt(c, index);
  if (!unit) return "invalid_unit";
  if (!unit.hasDoor) return "no_door";
  return { ...c, units: setUnitDoorColor(c.units, unit.id, color) };
}

function editWarnings(
  before: CabinComposition,
  after: CabinComposition,
  op: EditOp,
): EditWarning[] {
  const warnings: EditWarning[] = [];
  let trimmed = false;
  let doorRemoved = false;
  let unitsRemoved = false;
  for (const unit of before.units) {
    const next = after.units.find((item) => item.id === unit.id);
    if (!next) {
      unitsRemoved = true;
      continue;
    }
    if (op.action !== "remove_fitting" && next.fittings.length < unit.fittings.length) {
      trimmed = true;
    }
    if (op.action !== "set_door" && unit.hasDoor && !next.hasDoor) doorRemoved = true;
  }
  if (trimmed) warnings.push("fittings_trimmed");
  if (doorRemoved) warnings.push("door_removed");
  if (unitsRemoved) warnings.push("units_removed");
  return warnings;
}

/** Structural equality; open poses and width memory are ignored. */
function sameComposition(a: CabinComposition, b: CabinComposition): boolean {
  if (
    a.depthMm !== b.depthMm ||
    a.hasPlinth !== b.hasPlinth ||
    a.color !== b.color ||
    a.units.length !== b.units.length
  ) {
    return false;
  }
  return a.units.every((unit, index) => sameUnit(unit, b.units[index]));
}

function sameUnit(a: CabinUnit, b: CabinUnit): boolean {
  if (
    a.id !== b.id ||
    a.widthMm !== b.widthMm ||
    a.heightMm !== b.heightMm ||
    a.hasDoor !== b.hasDoor ||
    a.color !== b.color ||
    a.doorColor !== b.doorColor ||
    a.fittings.length !== b.fittings.length
  ) {
    return false;
  }
  return a.fittings.every((item, index) => {
    const other = b.fittings[index];
    return item.id === other.id && item.kind === other.kind && item.color === other.color;
  });
}

function hasCatalogDoor(unit: CabinUnit, c: CabinComposition): boolean {
  return isCatalogDoorHeight(doorClearHeightMm(unitSize(unit, c), unit.fittings ?? []));
}

function unitAt(c: CabinComposition, index: unknown): CabinUnit | undefined {
  if (typeof index !== "number" || !Number.isInteger(index)) return undefined;
  return c.units[index];
}

function withUnit(
  c: CabinComposition,
  unit: CabinUnit,
  updated: CabinUnit,
): CabinComposition {
  return {
    ...c,
    units: c.units.map((item) => (item === unit ? updated : item)),
  };
}

function unitSize(unit: CabinUnit, c: CabinComposition): CabinSize {
  return {
    widthMm: unit.widthMm,
    heightMm: unit.heightMm,
    depthMm: c.depthMm,
    hasPlinth: c.hasPlinth,
  };
}

function isFitKind(value: unknown): value is CabinFitKind {
  return FIT_KINDS.includes(value as CabinFitKind);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isOneOf(allowed: readonly number[], value: number): boolean {
  return allowed.includes(value);
}
