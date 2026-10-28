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
  CABIN_DEPTHS_MM,
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_SAFETY_MM,
  CABIN_WIDTHS_MM,
  DEFAULT_SKU_CONVENTION,
  defaultFrontSeries,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  DESIGN_LEVELS,
  DOOR_MIN_HEIGHT_MM,
  normalizeComposition,
  planCabinet,
  skuFor,
  toBom,
  unitWidthsForKind,
  type BomLine,
  type BomPart,
  type CabinColorId,
  type CabinComposition,
  type CabinFitKind,
  type DesignKind,
  type DesignLevel,
  type EditOp,
  type EditResult,
  type PlanCabinetInput,
  type PlanCabinetResult,
  type SkuConvention,
} from "./cabinet-core";
import { PART_NAMES } from "./part-catalog";
import { shopColorOf } from "./shop-colors";

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
  CABIN_TOTAL_WIDTH_SAFETY_MM,
  CABIN_WIDTHS_MM,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  DOOR_MIN_HEIGHT_MM,
  unitWidthsForKind,
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

/** CONTRACT §3 — unit is a 0-based index into composition.units. */
export const EDIT_ACTIONS = [
  "add_fitting",
  "remove_fitting",
  "set_unit_width",
  "set_unit_height",
  "set_total_width",
  "set_depth",
  "set_door",
  "set_crown",
  "set_front_series",
  "set_color",
  "set_handle",
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
  /**
   * Validates and applies one panel intent; result is normalized. With
   * `kind`, width ops follow that kind's size rules (DESIGN_KIND_RULES).
   */
  applyEditOp(composition: CabinComposition, op: EditOp, kind?: DesignKind): EditResult;
  /** Deterministic, merged, stably sorted part list. */
  toBom(composition: CabinComposition): BomLine[];
  /** Shopify variant SKU for one BOM line. */
  skuFor(line: BomLine): string;
  /** Snaps a stored/foreign composition back onto the grid. */
  normalizeComposition(composition: CabinComposition): CabinComposition;
}

/**
 * Shop name of a part; doors and drawer fronts are named by their front series
 * (shop-parts.json). A part or series missing there never matches a shop
 * product, so its price shows [FİYAT] instead of borrowing another one's price.
 */
function shopPartName(part: BomPart, series: string | undefined): string {
  const front = part === "KAPAK" || part === "CEKMECE_ON";
  const wanted = front ? series ?? defaultFrontSeries().id : undefined;
  const row = PART_NAMES.find((item) => item.part === part && item.series === wanted);
  return row?.name ?? `Bilinmeyen parça ${part} ${wanted ?? ""}`.trim();
}

/**
 * Shopify product title of one BOM part. Koshoy's shop has no SKUs: every
 * catalog part is its own product named by part name + shop colour + nominal size,
 * e.g. "Bakay LAKE BEYAZ 960x2304x640 mm" (body), "Acıbay KUMTAŞI 477x2237x0 mm"
 * (door leaf), "Kulp SİYAH" (handle). Drawer fronts are listed by nominal
 * width/band; the BOM keeps the 3 mm gap. `shopColor` overrides the line's
 * colour (checking what the shop sells in one colour).
 */
export function koshoyPartTitle(line: BomLine, shopColor = shopColorOf(line.color)): string {
  const name = shopPartName(line.part, line.series);
  const colorSize = (w: number, h: number, d: number) => `${shopColor} ${w}x${h}x${d} mm`;
  switch (line.part) {
    case "GOVDE":
      // Only bodies with plinth exist in the shop; a plinthless one stays unresolved.
      return `${name} ${colorSize(line.widthMm, line.heightMm, line.depthMm)}${line.plinth === false ? " (bazasız)" : ""}`;
    case "KAPAK":
      return `${name} ${colorSize(line.widthMm, line.heightMm, 0)}`;
    case "CEKMECE_ON":
      return `${name} ${colorSize(line.widthMm + 3, line.heightMm + 3, 0)}`;
    case "CEKMECE":
      return `${name} ${colorSize(line.widthMm, line.heightMm, line.depthMm)}`;
    case "RAF":
      return `${name} ${colorSize(line.widthMm, 0, line.depthMm)}`;
    case "TAC":
      return `${name} ${colorSize(line.widthMm, 25, line.depthMm)}`;
    case "ASKI":
      return `${name} ${line.widthMm}`;
    case "KULP":
      return `${name} ${shopColor}`;
  }
}

export function createCabinetEngine(
  partKey: (line: BomLine) => string = (line) => koshoyPartTitle(line),
): CabinetEngine {
  return {
    planCabinet,
    applyEditOp(composition, op, kind) {
      const result = applyEditOp(composition, op, kind);
      if (result.ok && !withinFittingCap(result.composition)) {
        return { ok: false, reason: "no_room" };
      }
      return result;
    },
    toBom,
    skuFor: partKey,
    normalizeComposition,
  };
}

export const cabinetEngine: CabinetEngine = createCabinetEngine();

export function getCabinetEngine(): CabinetEngine {
  return cabinetEngine;
}
