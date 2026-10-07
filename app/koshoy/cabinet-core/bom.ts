// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/bom.ts

import { CABIN_COLORS, normalizeCabinColor } from "./colors";
import { normalizeComposition } from "./composeCabins";
import {
  DRAWER_160_MM,
  DRAWER_320_MM,
  isDrawerKind,
  layoutDoors,
  layoutDrawerFronts,
  layoutFittings,
} from "./fittings";
import type {
  CabinColorId,
  CabinComposition,
  CabinFitting,
  CabinSize,
  CabinUnit,
} from "./types";

/** Catalog part names (KABIN → GOVDE, CEKMECE_KAPAK → CEKMECE_ON). */
export type BomPart =
  | "GOVDE"
  | "KAPAK"
  | "RAF"
  | "CEKMECE"
  | "CEKMECE_ON"
  | "ASKI"
  | "TAC";

/** Output order of `toBom`. */
export const BOM_PARTS: readonly BomPart[] = [
  "GOVDE",
  "KAPAK",
  "RAF",
  "CEKMECE",
  "CEKMECE_ON",
  "ASKI",
  "TAC",
];

/**
 * One catalog part. Sizes follow the catalog record: KAPAK / CEKMECE_ON have
 * depth 0, RAF has height 0, ASKI only carries the unit width.
 */
export interface BomLine {
  part: BomPart;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  color: CabinColorId;
  /** GOVDE only. */
  plinth?: boolean;
  qty: number;
}

export type SkuField = "widthMm" | "heightMm" | "depthMm" | "color";

/**
 * PLACEHOLDER SKU convention until the real Shopify part SKUs are known
 * (open question S1). Everything SKU-specific lives here.
 */
export interface SkuConvention {
  separator: string;
  partCodes: Record<BomPart, string>;
  /** SKU segments after the part code, in order. */
  fields: Record<BomPart, readonly SkuField[]>;
  colorCodes: Record<CabinColorId, string>;
  /** Last GOVDE segment when the carcass has no plinth. */
  noPlinthSuffix: string;
}

export const DEFAULT_SKU_CONVENTION: SkuConvention = {
  separator: "-",
  partCodes: {
    GOVDE: "GOVDE",
    KAPAK: "KAPAK",
    RAF: "RAF",
    CEKMECE: "CEKMECE",
    CEKMECE_ON: "CEKMECE_ON",
    ASKI: "ASKI",
    TAC: "TAC",
  },
  fields: {
    GOVDE: ["widthMm", "heightMm", "depthMm", "color"],
    KAPAK: ["widthMm", "heightMm", "color"],
    RAF: ["widthMm", "depthMm", "color"],
    CEKMECE: ["widthMm", "heightMm", "depthMm", "color"],
    CEKMECE_ON: ["widthMm", "heightMm", "color"],
    ASKI: ["widthMm"],
    TAC: ["widthMm", "depthMm", "color"],
  },
  colorCodes: { wood: "WOOD", ivory: "IVORY", blue: "BLUE" },
  noPlinthSuffix: "BAZASIZ",
};

export interface SkuLine {
  sku: string;
  qty: number;
}

/**
 * Parts list of a composition. The composition is normalized first and every
 * part comes from the layout the 3D view draws: closing shelf included, doors
 * only when they fit, door leaves per width. TAC is never emitted (no crown in
 * the model yet). Identical lines are merged and sorted.
 */
export function toBom(composition: CabinComposition): BomLine[] {
  const normalized = normalizeComposition(composition);
  const lines: BomLine[] = [];
  for (const unit of normalized.units) {
    pushUnitParts(lines, unit, normalized);
  }
  return mergeBomLines(lines);
}

export function skuFor(
  line: BomLine,
  convention: SkuConvention = DEFAULT_SKU_CONVENTION,
): string {
  const segments = [convention.partCodes[line.part]];
  for (const field of convention.fields[line.part]) {
    segments.push(
      field === "color" ? convention.colorCodes[line.color] : String(line[field]),
    );
  }
  if (line.part === "GOVDE" && line.plinth === false && convention.noPlinthSuffix) {
    segments.push(convention.noPlinthSuffix);
  }
  return segments.join(convention.separator);
}

/** BOM lines → SKU quantities. Lines sharing a SKU (e.g. ASKI) are summed. */
export function toSkuLines(
  lines: readonly BomLine[],
  convention: SkuConvention = DEFAULT_SKU_CONVENTION,
): SkuLine[] {
  const bySku = new Map<string, SkuLine>();
  for (const line of lines) {
    const sku = skuFor(line, convention);
    const existing = bySku.get(sku);
    if (existing) existing.qty += line.qty;
    else bySku.set(sku, { sku, qty: line.qty });
  }
  return [...bySku.values()];
}

function pushUnitParts(
  lines: BomLine[],
  unit: CabinUnit,
  composition: CabinComposition,
): void {
  const size: CabinSize = {
    widthMm: unit.widthMm,
    heightMm: unit.heightMm,
    depthMm: composition.depthMm,
    hasPlinth: composition.hasPlinth,
  };
  const color = normalizeCabinColor(unit.color ?? composition.color);
  const fittings = unit.fittings ?? [];
  lines.push(
    part("GOVDE", size.widthMm, size.heightMm, size.depthMm, color, size.hasPlinth),
  );
  if (unit.hasDoor) {
    const doorColor = normalizeCabinColor(unit.doorColor ?? color);
    for (const leaf of layoutDoors(size, fittings)) {
      lines.push(part("KAPAK", leaf.size.x, leaf.size.y, 0, doorColor));
    }
  }
  const placed = layoutFittings(size, fittings);
  for (const item of placed) {
    if (isDrawerKind(item.kind)) {
      const bandMm = item.kind === "drawer320" ? DRAWER_320_MM : DRAWER_160_MM;
      lines.push(
        part("CEKMECE", size.widthMm, bandMm, size.depthMm, drawerColor(fittings, item.id, color)),
      );
    } else if (item.kind === "shelf") {
      lines.push(part("RAF", size.widthMm, 0, size.depthMm, color));
    } else if (item.kind === "hanger") {
      lines.push(part("ASKI", size.widthMm, 0, 0, color));
    }
    // Unknown kinds (corrupt / legacy data) have no catalog part: not billed.
  }
  const placedIds = new Set(placed.map((item) => item.id));
  for (const front of layoutDrawerFronts(size, fittings)) {
    const fittingId = front.id.replace(/^drawerFront-/, "");
    if (!placedIds.has(fittingId)) continue;
    lines.push(
      part("CEKMECE_ON", front.size.x, front.size.y, 0, drawerColor(fittings, fittingId, color)),
    );
  }
}

function part(
  name: BomPart,
  widthMm: number,
  heightMm: number,
  depthMm: number,
  color: CabinColorId,
  plinth?: boolean,
): BomLine {
  return plinth === undefined
    ? { part: name, widthMm, heightMm, depthMm, color, qty: 1 }
    : { part: name, widthMm, heightMm, depthMm, color, plinth, qty: 1 };
}

function drawerColor(
  fittings: readonly CabinFitting[],
  fittingId: string,
  fallback: CabinColorId,
): CabinColorId {
  const fitting = fittings.find((item) => item.id === fittingId);
  return normalizeCabinColor(fitting?.color ?? fallback);
}

function lineKey(line: BomLine): string {
  return [
    line.part,
    line.widthMm,
    line.heightMm,
    line.depthMm,
    line.color,
    line.plinth === undefined ? "" : String(line.plinth),
  ].join("|");
}

function mergeBomLines(lines: readonly BomLine[]): BomLine[] {
  const merged = new Map<string, BomLine>();
  for (const line of lines) {
    const key = lineKey(line);
    const existing = merged.get(key);
    if (existing) existing.qty += line.qty;
    else merged.set(key, { ...line });
  }
  return [...merged.values()].sort(compareBomLines);
}

function colorRank(color: CabinColorId): number {
  return CABIN_COLORS.findIndex((option) => option.id === color);
}

/** Part order, then larger sizes first, plinth before none, then color. */
function compareBomLines(a: BomLine, b: BomLine): number {
  return (
    BOM_PARTS.indexOf(a.part) - BOM_PARTS.indexOf(b.part) ||
    b.widthMm - a.widthMm ||
    b.heightMm - a.heightMm ||
    b.depthMm - a.depthMm ||
    Number(b.plinth ?? false) - Number(a.plinth ?? false) ||
    colorRank(a.color) - colorRank(b.color)
  );
}
