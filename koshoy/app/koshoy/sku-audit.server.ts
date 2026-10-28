/**
 * Admin-only catalog audit: which parts our templates need, and which of them
 * the shop sells (matched by structure, part-catalog.ts). Shown on the embedded
 * admin page and /internal/sku-audit, so a data change in the shop is seen at once.
 */
import {
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  koshoyPartTitle,
  PLAN_LEVELS,
  type BomLine,
  type CabinetEngine,
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
}

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
  return required.map((row) => ({
    ...row,
    found: findPart(catalog, row.sku),
    candidates: catalog.ambiguous.get(partKeyOfTitle(row.sku) ?? "") ?? [],
  }));
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
