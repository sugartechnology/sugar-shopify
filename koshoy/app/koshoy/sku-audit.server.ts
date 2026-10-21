/**
 * Admin-only SKU audit: which part SKUs our templates need, and which of them
 * exist as Shopify variants in the shop. Shown on the embedded admin page so
 * the real SKU convention (open question S1) can be read off the shop.
 */
import {
  CABIN_COLOR_IDS,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  PLAN_LEVELS,
  type BomLine,
  type CabinetEngine,
} from "./engine";
import type { KoshoyAdminGraphql } from "./pricing.server";

export interface RequiredSku {
  sku: string;
  line: Omit<BomLine, "qty">;
  usedBy: string[];
}

export interface ShopVariant {
  variantId: string;
  productTitle: string;
  productStatus: string;
  variantTitle: string;
  sku: string;
  price: string;
}

export interface SkuAuditRow extends RequiredSku {
  found: ShopVariant | null;
}

/** Every SKU any template (kind × level × colour) produces. */
export function requiredTemplateSkus(engine: CabinetEngine): RequiredSku[] {
  const out = new Map<string, RequiredSku>();
  for (const kind of DESIGN_KINDS) {
    for (const level of PLAN_LEVELS) {
      for (const color of CABIN_COLOR_IDS) {
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

/** Shop product titles are the part keys; SKUs match too once the shop adds them. */
export function partKeyOf(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

export function variantsByPartKey(variants: readonly ShopVariant[]): Map<string, ShopVariant> {
  const out = new Map<string, ShopVariant>();
  for (const variant of variants) {
    const keys = [variant.productTitle, variant.sku].filter(Boolean).map(partKeyOf);
    for (const key of keys) if (!out.has(key)) out.set(key, variant);
  }
  return out;
}

export function auditSkus(required: readonly RequiredSku[], variants: readonly ShopVariant[]): SkuAuditRow[] {
  const byKey = variantsByPartKey(variants);
  return required.map((row) => ({ ...row, found: byKey.get(partKeyOf(row.sku)) ?? null }));
}

const PRODUCTS_QUERY = `#graphql
  query KoshoySkuAudit($after: String) {
    products(first: 100, after: $after, query: "-tag:koshoy-tasarim") {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        status
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
        });
      }
    }
    if (!products.pageInfo?.hasNextPage) break;
    after = products.pageInfo.endCursor ?? null;
  }
  return out;
}
