/**
 * Admin-only catalog audit: which parts our templates need, and which of them
 * the shop sells (matched by structure, part-catalog.ts). Shown on the embedded
 * admin page and /internal/sku-audit, so a data change in the shop is seen at once.
 */
import {
  CABIN_DEPTHS_MM,
  CABIN_HEIGHTS_MM,
  CABIN_WIDTHS_MM,
  CABINET_FRONT_SERIES_IDS,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  koshoyPartTitle,
  PLAN_LEVELS,
  type BomLine,
  type CabinComposition,
  type CabinetEngine,
  type CabinFitKind,
  type EditOp,
} from "./engine";
import { findPart, partKeyOfTitle, readPartCatalog, type PartCatalog, type ShopVariant } from "./part-catalog";
import { koshoyColors, shopColorKey, type ColorLook } from "./shop-colors";
import type { KoshoyAdminGraphql } from "./pricing.server";

export type { ShopVariant } from "./part-catalog";

export interface RequiredSku {
  sku: string;
  line: Omit<BomLine, "qty">;
  usedBy: string[];
}

export interface SkuAuditRow extends RequiredSku {
  found: ShopVariant | null;
  /** More than one shop product is this part: none is used until one is left. */
  candidates: ShopVariant[];
  /**
   * Why it is not priced: twins (two products), colour (sold in another colour
   * only), size (this part is sold in this colour, not in this size), part (no
   * product of this part in this colour at all).
   */
  problem: "" | "twins" | "colour" | "size" | "part";
}

import { AUDIT_PROBLEM_TEXT } from "./audit-text";

export { AUDIT_PROBLEM_TEXT };

function bodyLookIds(): string[] {
  return koshoyColors().all.filter((color) => color.use === "body").map((color) => color.id);
}

/**
 * Every part any template (kind × level × colour) needs; colours default to
 * every body colour with a look, offered or not, so a colour the shop sells
 * only in part is reported instead of silently dropped.
 */
export function requiredTemplateSkus(engine: CabinetEngine, colorIds: readonly string[] = bodyLookIds()): RequiredSku[] {
  const out = new Map<string, RequiredSku>();
  for (const kind of DESIGN_KINDS) {
    for (const level of PLAN_LEVELS) {
      for (const color of colorIds) {
        const plan = engine.planCabinet({ kind, level, color });
        const label = `${DESIGN_KIND_LABELS[kind]} · ${level}`;
        for (const line of engine.toBom(plan.composition)) {
          const sku = engine.skuFor(line);
          const { qty: _qty, ...part } = line;
          const row = out.get(sku) ?? { sku, line: part, usedBy: [] };
          if (!row.usedBy.includes(label)) row.usedBy.push(label);
          out.set(sku, row);
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Most examples kept per part in the full catalog audit (`usedBy`). */
const EXAMPLES_PER_PART = 3;

/**
 * Bodies the configurator can build, one per interior shape that changes the
 * parts list: every catalog width × height × depth and front series, open or
 * with a door, with a crown, and with each drawer stack (160 × n, 320 + 160 × n,
 * 320 × 2), one shelf or one hanger. Every body passes the core's edit rules,
 * so a size the studio refuses is not asked of the shop.
 */
function catalogBodies(engine: CabinetEngine, color: string): Array<{ label: string; composition: CabinComposition }> {
  const out: Array<{ label: string; composition: CabinComposition }> = [];
  const stacks: CabinFitKind[][] = [[], ["shelf"], ["hanger"]];
  for (let n = 1; n <= 14; n += 1) stacks.push(Array<CabinFitKind>(n).fill("drawer160"));
  for (let n = 0; n <= 12; n += 1) stacks.push(["drawer320", ...Array<CabinFitKind>(n).fill("drawer160")]);
  stacks.push(["drawer320", "drawer320"]);
  for (const series of CABINET_FRONT_SERIES_IDS) {
    for (const widthMm of CABIN_WIDTHS_MM) {
      for (const heightMm of CABIN_HEIGHTS_MM) {
        for (const depthMm of CABIN_DEPTHS_MM) {
          const base: CabinComposition = engine.normalizeComposition({
            units: [{ id: "cabin-1", widthMm, heightMm, fittings: [], hasDoor: false, color, hasCrown: true }],
            depthMm,
            hasPlinth: true,
            color,
            frontSeries: series,
          } as CabinComposition);
          for (const stack of stacks) {
            const fitted = applyAll(engine, base, stack.map((kind) => ({ action: "add_fitting", unit: 0, kind }) as EditOp));
            if (!fitted) continue;
            const size = `${widthMm / 10}×${heightMm / 10}×${depthMm / 10}`;
            const inside = stackLabel(stack);
            out.push({ label: `${size} ${inside}`, composition: fitted });
            const door = applyAll(engine, fitted, [{ action: "set_door", unit: 0, hasDoor: true }]);
            if (door) out.push({ label: `${size} ${inside} kapaklı ${series}`, composition: door });
          }
        }
      }
    }
  }
  return out;
}

const FIT_LABELS: Record<CabinFitKind, string> = {
  drawer160: "küçük çekmece",
  drawer320: "büyük çekmece",
  shelf: "raf",
  hanger: "askı",
};

function stackLabel(stack: readonly CabinFitKind[]): string {
  if (!stack.length) return "boş";
  const counts = new Map<CabinFitKind, number>();
  for (const kind of stack) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${n} ${FIT_LABELS[kind]}`).join(" + ");
}

/** null when the core refuses one of the ops (the body cannot be built). */
function applyAll(engine: CabinetEngine, composition: CabinComposition, ops: EditOp[]): CabinComposition | null {
  let current = composition;
  for (const op of ops) {
    const result = engine.applyEditOp(current, op);
    if (!result.ok) return null;
    current = result.composition;
  }
  return current;
}

/**
 * Every part × size × colour the configurator can produce (not only the
 * templates): the catalog bodies above in every body colour with a look, and
 * a handle in every handle colour with a look. ClickUp z8qu5d7ux8.
 */
export function requiredCatalogSkus(
  engine: CabinetEngine,
  colorIds: readonly string[] = bodyLookIds(),
  handleShopColors: readonly string[] = koshoyColors()
    .all.filter((color) => color.use === "handle")
    .map((color) => color.shopColor),
): RequiredSku[] {
  // ~0.4 s to build; the answer only changes with the colours (and a deploy).
  const key = JSON.stringify([colorIds, handleShopColors]);
  const cached = catalogCache.get(engine);
  if (cached?.key === key) return cached.rows;
  const rows = buildCatalogSkus(engine, colorIds, handleShopColors);
  catalogCache.set(engine, { key, rows });
  return rows;
}

const catalogCache = new WeakMap<CabinetEngine, { key: string; rows: RequiredSku[] }>();

function buildCatalogSkus(
  engine: CabinetEngine,
  colorIds: readonly string[],
  handleShopColors: readonly string[],
): RequiredSku[] {
  const out = new Map<string, RequiredSku>();
  const add = (line: Omit<BomLine, "qty">, sku: string, label: string) => {
    const row = out.get(sku) ?? { sku, line, usedBy: [] };
    if (row.usedBy.length < EXAMPLES_PER_PART && !row.usedBy.includes(label)) row.usedBy.push(label);
    out.set(sku, row);
  };
  // The structure is the same in every colour: build once, rename per colour.
  const shapes = new Map<string, { line: Omit<BomLine, "qty">; labels: string[] }>();
  for (const body of catalogBodies(engine, colorIds[0] ?? "")) {
    for (const { qty: _qty, ...line } of engine.toBom(body.composition)) {
      const key = JSON.stringify(line);
      const shape = shapes.get(key) ?? { line, labels: [] };
      if (shape.labels.length < EXAMPLES_PER_PART) shape.labels.push(body.label);
      shapes.set(key, shape);
    }
  }
  for (const color of colorIds) {
    for (const { line, labels } of shapes.values()) {
      const colored = { ...line, color } as Omit<BomLine, "qty">;
      for (const label of labels) add(colored, engine.skuFor({ ...colored, qty: 1 }), label);
    }
  }
  for (const shopColor of handleShopColors) {
    const handle: BomLine = { part: "KULP", widthMm: 0, heightMm: 0, depthMm: 0, color: "", qty: 1 };
    const { qty: _qty, ...line } = handle;
    add(line, koshoyPartTitle(handle, shopColor), "her kapak ve çekmece önü");
  }
  return [...out.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/**
 * Shop colours (upper case) the studio may offer: a body colour when every
 * template part is sold in it, a handle colour when a handle is sold in it.
 */
export function offeredShopColors(
  engine: CabinetEngine,
  catalog: PartCatalog,
  looks: readonly ColorLook[],
): { body: Set<string>; handles: Set<string> } {
  const lines = requiredTemplateSkus(engine, bodyLookIds().slice(0, 1)).map((row) => ({ ...row.line, qty: 1 }));
  const body = new Set<string>();
  const handles = new Set<string>();
  for (const look of looks) {
    const color = shopColorKey(look.shopColor);
    if (look.use === "body") {
      if (lines.every((line) => findPart(catalog, koshoyPartTitle(line, color)))) body.add(color);
    } else {
      const handle: BomLine = { part: "KULP", widthMm: 0, heightMm: 0, depthMm: 0, color: "", qty: 1 };
      if (findPart(catalog, koshoyPartTitle(handle, color))) handles.add(color);
    }
  }
  return { body, handles };
}

export function auditSkus(required: readonly RequiredSku[], variants: readonly ShopVariant[]): SkuAuditRow[] {
  const catalog = readPartCatalog(variants);
  const rows = required.map((row) => ({
    ...row,
    found: findPart(catalog, row.sku),
    candidates: catalog.ambiguous.get(partKeyOfTitle(row.sku) ?? "") ?? [],
  }));
  // Reasons come from the other rows: the same part in another colour or size.
  const shape = (line: RequiredSku["line"]) => JSON.stringify({ ...line, color: "" });
  const partColor = (line: RequiredSku["line"]) => `${line.part}|${line.series ?? ""}|${line.color}`;
  const soldShapes = new Set(rows.filter((row) => row.found).map((row) => shape(row.line)));
  const soldPartColors = new Set(rows.filter((row) => row.found).map((row) => partColor(row.line)));
  return rows.map((row) => ({
    ...row,
    problem: row.found
      ? ""
      : row.candidates.length > 1
        ? "twins"
        : soldShapes.has(shape(row.line))
          ? "colour"
          : soldPartColors.has(partColor(row.line))
            ? "size"
            : "part",
  }));
}

/** Problem rows as CSV (parça, ölçü, renk, neden) for the team. */
export function auditCsv(rows: readonly SkuAuditRow[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [["beklenen ad", "parça", "ölçü (mm)", "renk", "neden", "örnek gövde"].join(",")];
  for (const row of rows) {
    if (!row.problem) continue;
    const { part, widthMm, heightMm, depthMm, color } = row.line;
    lines.push(
      [row.sku, part, `${widthMm}x${heightMm}x${depthMm}`, color, AUDIT_PROBLEM_TEXT[row.problem], row.usedBy.join(" | ")]
        .map((value) => quote(String(value)))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

const PRODUCTS_QUERY = `#graphql
  query KoshoySkuAudit($after: String) {
    products(first: 100, after: $after, query: "-tag:koshoy-tasarim") {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        status
        partField: metafield(namespace: "koshoy", key: "parca") { value }
        variants(first: 100) { nodes { id title sku price } }
      }
    }
  }`;

/** All products (any status: active, draft, archived) with their variants. */
export async function fetchShopVariants(admin: KoshoyAdminGraphql, maxPages = 10): Promise<ShopVariant[]> {
  const out: ShopVariant[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await admin.graphql(PRODUCTS_QUERY, { variables: { after } });
    const json = (await response.json()) as {
      errors?: unknown;
      data?: {
        products?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: Array<{
            title?: string;
            status?: string;
            partField?: { value?: string | null } | null;
            variants?: { nodes?: Array<{ id?: string; title?: string; sku?: string | null; price?: unknown }> };
          }>;
        };
      };
    };
    const products = json.data?.products;
    // Never return a partial/empty catalog as if it were complete.
    if (json.errors || !products) throw new Error("Shopify product read failed");
    for (const product of products.nodes ?? []) {
      for (const variant of product.variants?.nodes ?? []) {
        out.push({
          variantId: String(variant.id ?? ""),
          productTitle: String(product.title ?? ""),
          productStatus: String(product.status ?? ""),
          variantTitle: String(variant.title ?? ""),
          sku: String(variant.sku ?? ""),
          price: String(variant.price ?? ""),
          partField: String(product.partField?.value ?? ""),
        });
      }
    }
    if (!products.pageInfo?.hasNextPage) break;
    after = products.pageInfo.endCursor ?? null;
  }
  return out;
}
