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
  "set_crown",
  "set_front_series",
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
 * Shop colour in every part title. Since 28 Oct the shop lists each part in
 * LAKE BEYAZ and KUMTAŞI; the LAKE BEYAZ products are the original ones (same
 * variant ids as before the colour was added), so every 3D colour prices from them.
 */
const SHOP_PART_COLOR = "LAKE BEYAZ";

/**
 * Shop name of each front series (`CABINET_RULES.frontSeries` ids); drawer
 * fronts add " Çekmece". A series missing here never matches a shop product,
 * so its price shows [FİYAT] instead of borrowing another series' price.
 */
const SHOP_FRONT_NAMES: Record<string, string> = {
  "kapak-16": "Acıbay",
  "kapak-18": "Aruuke",
};

function shopFrontName(series: string | undefined): string {
  const id = series ?? defaultFrontSeries().id;
  return SHOP_FRONT_NAMES[id] ?? `Bilinmeyen kapak serisi ${id}`;
}

/**
 * Shopify product title of one BOM part. Koshoy's shop has no SKUs: every
 * catalog part is its own product named by type + shop colour + nominal size,
 * e.g. "Bakay LAKE BEYAZ 960x2304x640 mm" (body), "Acıbay LAKE BEYAZ 477x2237x0 mm"
 * (door leaf). Drawer fronts are listed by nominal width/band; the BOM keeps the 3 mm gap.
 */
export function koshoyPartTitle(line: BomLine): string {
  const colorSize = (w: number, h: number, d: number) => `${SHOP_PART_COLOR} ${w}x${h}x${d} mm`;
  switch (line.part) {
    case "GOVDE":
      // Only bodies with plinth exist in the shop; a plinthless one stays unresolved.
      return `Bakay ${colorSize(line.widthMm, line.heightMm, line.depthMm)}${line.plinth === false ? " (bazasız)" : ""}`;
    case "KAPAK":
      return `${shopFrontName(line.series)} ${colorSize(line.widthMm, line.heightMm, 0)}`;
    case "CEKMECE_ON":
      return `${shopFrontName(line.series)} Çekmece ${colorSize(line.widthMm + 3, line.heightMm + 3, 0)}`;
    case "CEKMECE":
      return `Sırgak ${colorSize(line.widthMm, line.heightMm, line.depthMm)}`;
    case "RAF":
      return `Tekçe ${colorSize(line.widthMm, 0, line.depthMm)}`;
    case "TAC":
      return `Tündük ${colorSize(line.widthMm, 25, line.depthMm)}`;
    case "ASKI":
      return `Gardırop Askısı ${line.widthMm}`;
  }
}

export function createCabinetEngine(
  partKey: (line: BomLine) => string = koshoyPartTitle,
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
