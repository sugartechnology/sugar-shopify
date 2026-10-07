/**
 * Koshoy cabinet engine: a thin adapter over the vendored pure core in
 * ./cabinet-core (copied from 3d-room-designer src/core/cabinet with
 * `npm run sync:cabinet-core`, never edited here). Pricing, tools and routes
 * code against CabinetEngine, so the backend validates, plans and bills with
 * exactly the rules the 3D view draws.
 */
import {
  applyEditOp,
  BOM_PARTS,
  CABIN_COLORS,
  CABIN_DEPTHS_MM,
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  DEFAULT_SKU_CONVENTION,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  DESIGN_LEVELS,
  DOOR_MIN_HEIGHT_MM,
  normalizeComposition,
  planCabinet,
  skuFor,
  toBom,
  type BomLine,
  type CabinColorId,
  type CabinComposition,
  type CabinFitKind,
  type DesignLevel,
  type EditOp,
  type EditResult,
  type PlanCabinetInput,
  type PlanCabinetResult,
  type SkuConvention,
} from "./cabinet-core";

export type {
  BomLine,
  BomPart,
  CabinColorId,
  CabinComposition,
  CabinFitKind,
  CabinFitting,
  CabinUnit,
  DesignKind,
  EditOp,
  EditRejectReason,
  EditResult,
  EditWarning,
  SkuConvention,
} from "./cabinet-core";
export {
  BOM_PARTS,
  CABIN_DEPTHS_MM,
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  DOOR_MIN_HEIGHT_MM,
};

export type PlanLevel = DesignLevel;
export const PLAN_LEVELS = DESIGN_LEVELS;
export type PlanInput = PlanCabinetInput;
export type PlanResult = PlanCabinetResult;

/** Input whitelists (tool schemas, request parsing, event serializer). */
export const CABIN_FIT_KINDS = [
  "drawer160",
  "drawer320",
  "shelf",
  "hanger",
] as const satisfies readonly CabinFitKind[];

export const CABIN_COLOR_IDS: readonly CabinColorId[] = CABIN_COLORS.map((option) => option.id);

/** Product-language colour names, straight from the core palette. */
export const CABIN_COLOR_LABELS = Object.fromEntries(
  CABIN_COLORS.map((option) => [option.id, option.label]),
) as Record<CabinColorId, string>;

/** CONTRACT §3 — unit is a 0-based index into composition.units. */
export const EDIT_ACTIONS = [
  "add_fitting",
  "remove_fitting",
  "set_unit_width",
  "set_unit_height",
  "set_total_width",
  "set_depth",
  "set_door",
  "set_color",
] as const satisfies readonly EditOp["action"][];

/**
 * PLACEHOLDER SKU convention until the real Shopify part SKUs are known
 * (open question S1). The convention itself lives in the core (bom.ts); swap
 * it here once Koshoy confirms the SKU layout.
 */
export const KOSHOY_SKU_CONVENTION: SkuConvention = DEFAULT_SKU_CONVENTION;

/**
 * Most fittings one unit may hold. The core stops drawers (13) and hangers
 * (3) by height but would take ~115 shelves; past this cap an edit is
 * refused as "no_room", so the scene the storefront draws (events.ts) always
 * carries every fitting the BOM bills.
 */
export const KOSHOY_MAX_FITTINGS_PER_UNIT = 16;

function withinFittingCap(composition: CabinComposition): boolean {
  return composition.units.every(
    (unit) => (unit.fittings ?? []).length <= KOSHOY_MAX_FITTINGS_PER_UNIT,
  );
}

export interface CabinetEngine {
  /** Deterministic template plan snapped to the catalog grid. */
  planCabinet(input: PlanInput): PlanResult;
  /** Validates and applies one panel intent; result is normalized. */
  applyEditOp(composition: CabinComposition, op: EditOp): EditResult;
  /** Deterministic, merged, stably sorted part list. */
  toBom(composition: CabinComposition): BomLine[];
  /** Shopify variant SKU for one BOM line. */
  skuFor(line: BomLine): string;
  /** Snaps a stored/foreign composition back onto the grid. */
  normalizeComposition(composition: CabinComposition): CabinComposition;
}

export function createCabinetEngine(
  convention: SkuConvention = KOSHOY_SKU_CONVENTION,
): CabinetEngine {
  return {
    planCabinet,
    applyEditOp(composition, op) {
      const result = applyEditOp(composition, op);
      if (result.ok && !withinFittingCap(result.composition)) {
        return { ok: false, reason: "no_room" };
      }
      return result;
    },
    toBom,
    skuFor: (line) => skuFor(line, convention),
    normalizeComposition,
  };
}

export const cabinetEngine: CabinetEngine = createCabinetEngine();

export function getCabinetEngine(): CabinetEngine {
  return cabinetEngine;
}
