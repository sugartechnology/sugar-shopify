/**
 * Koshoy pricing (Model B): composition → toBom → skuFor → Shopify variant
 * price. Shopify is the only price authority; an unresolved SKU never gets a
 * guessed price, the display becomes [FİYAT] and the SKU is logged.
 */
import { gidToNumericId } from "../services/shopify-ids";
import { fetchShopVariants, partKeyOf, variantsByPartKey, type ShopVariant } from "./sku-audit.server";
import type { BomPart, CabinComposition, CabinetEngine } from "./engine";
import { PRICE_PLACEHOLDER } from "./events";

/** The part of the Admin GraphQL client pricing needs. */
export interface KoshoyAdminGraphql {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
}

export interface SkuPrice {
  variantId: number;
  priceCents: number;
}

export type SkuResolver = (skus: string[]) => Promise<Map<string, SkuPrice>>;

export interface KoshoyQuoteLine {
  sku: string;
  part: BomPart;
  qty: number;
  variantId: number | null;
  unitCents: number | null;
}

export interface KoshoyQuote {
  display: string;
  totalCents: number | null;
  lines: KoshoyQuoteLine[];
  unresolved: string[];
}

export interface KoshoyPricer {
  quote(composition: CabinComposition): Promise<KoshoyQuote>;
}

const POSITIVE_TTL_MS = 5 * 60 * 1000;

/** tr-TR money display, e.g. 1595814 → "15.958,14 TL". */
export function formatTl(cents: number): string {
  const abs = Math.max(0, Math.round(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${whole},${fraction} TL`;
}

export function moneyToCents(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "gid://shopify/ProductVariant/123" → 123 (the id /cart/add.js expects). */
export function variantGidToNumber(gid: string): number | null {
  const tail = gidToNumericId(String(gid ?? ""));
  if (!/^\d+$/.test(tail)) return null;
  const id = Number(tail);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/* ---------------- mock table (KOSHOY_PRICE_MOCK=1) ---------------- */

/** Spike numbers (MCP × 1.10); `*` matches any colour suffix. */
export const KOSHOY_MOCK_PRICES: ReadonlyArray<{ pattern: string; price: string }> = [
  { pattern: "Bakay 960x2304x640 mm", price: "6425.00" },
  { pattern: "Acıbay 477x2237x0 mm", price: "1069.43" },
  { pattern: "Tekçe 960x0x640 mm", price: "573.28" },
  { pattern: "Gardırop Askısı 960", price: "396.00" },
];

export function isKoshoyPriceMock(): boolean {
  const value = (process.env.KOSHOY_PRICE_MOCK ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Stable fake variant id so the cart path can be exercised in dev. */
function mockVariantId(sku: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sku.length; i += 1) {
    hash ^= sku.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 9_000_000_000_000 + hash;
}

export function createMockSkuResolver(
  table: ReadonlyArray<{ pattern: string; price: string }> = KOSHOY_MOCK_PRICES,
): SkuResolver {
  const rows = table.map((row) => ({
    match: globToRegExp(row.pattern),
    cents: moneyToCents(row.price),
  }));
  return async (skus) => {
    const out = new Map<string, SkuPrice>();
    for (const sku of skus) {
      const row = rows.find((item) => item.match.test(sku));
      if (row && row.cents !== null) {
        out.set(sku, { variantId: mockVariantId(sku), priceCents: row.cents });
      }
    }
    return out;
  };
}

/* ---------------- Shopify Admin resolver ---------------- */

/**
 * Koshoy's parts are products named by type + size (no SKUs). The whole part
 * catalog (~260 products) is read once per shop and kept for a few minutes;
 * every BOM key is then matched by exact title (or SKU, if the shop adds one).
 */
type CatalogEntry = { byKey: Map<string, SkuPrice>; expiresAt: number };
const sharedCatalogs = new Map<string, CatalogEntry>();

export function createShopifySkuResolver(
  admin: KoshoyAdminGraphql,
  shop: string,
  options: {
    cache?: Map<string, CatalogEntry>;
    now?: () => number;
    fetchVariants?: (admin: KoshoyAdminGraphql) => Promise<ShopVariant[]>;
  } = {},
): SkuResolver {
  const cache = options.cache ?? sharedCatalogs;
  const now = options.now ?? Date.now;
  const fetchVariants = options.fetchVariants ?? fetchShopVariants;

  async function catalog(): Promise<Map<string, SkuPrice>> {
    const hit = cache.get(shop);
    if (hit && hit.expiresAt > now()) return hit.byKey;
    const byKey = new Map<string, SkuPrice>();
    for (const [key, variant] of variantsByPartKey(await fetchVariants(admin))) {
      const variantId = variantGidToNumber(variant.variantId);
      const priceCents = moneyToCents(variant.price);
      if (variantId && priceCents !== null) byKey.set(key, { variantId, priceCents });
    }
    cache.set(shop, { byKey, expiresAt: now() + POSITIVE_TTL_MS });
    return byKey;
  }

  return async (keys) => {
    const byKey = await catalog();
    const out = new Map<string, SkuPrice>();
    for (const key of keys) {
      const value = byKey.get(partKeyOf(key));
      if (value) out.set(key, value);
    }
    return out;
  };
}

/**
 * Resolver for a shop: the spike price table when KOSHOY_PRICE_MOCK=1 (no
 * Shopify calls), otherwise the shop's part catalog matched by product title.
 */
export function createKoshoySkuResolver(admin: KoshoyAdminGraphql, shop: string): SkuResolver {
  return isKoshoyPriceMock() ? createMockSkuResolver() : createShopifySkuResolver(admin, shop);
}

/* ---------------- pricer ---------------- */

export function createKoshoyPricer(
  engine: CabinetEngine,
  resolve: SkuResolver,
): KoshoyPricer {
  return {
    async quote(composition) {
      const bySku = new Map<string, { part: BomPart; qty: number }>();
      for (const line of engine.toBom(composition)) {
        const sku = engine.skuFor(line);
        const existing = bySku.get(sku);
        if (existing) existing.qty += line.qty;
        else bySku.set(sku, { part: line.part, qty: line.qty });
      }

      let prices = new Map<string, SkuPrice>();
      try {
        prices = await resolve([...bySku.keys()]);
      } catch (error) {
        console.error("[koshoy] price lookup failed", error);
      }

      const lines: KoshoyQuoteLine[] = [...bySku].map(([sku, row]) => {
        const price = prices.get(sku);
        return {
          sku,
          part: row.part,
          qty: row.qty,
          variantId: price?.variantId ?? null,
          unitCents: price?.priceCents ?? null,
        };
      });
      const unresolved = lines.filter((line) => line.unitCents === null).map((line) => line.sku);
      if (!lines.length || unresolved.length) {
        if (unresolved.length) console.error("[koshoy] unresolved sku", unresolved);
        return { display: PRICE_PLACEHOLDER, totalCents: null, lines, unresolved };
      }
      const totalCents = lines.reduce((sum, line) => sum + line.qty * (line.unitCents ?? 0), 0);
      return { display: formatTl(totalCents), totalCents, lines, unresolved: [] };
    },
  };
}

/* ---------------- cart lines ---------------- */

export interface KoshoyCartLine {
  variantId: number;
  quantity: number;
  properties: { _tasarim: string };
}

/**
 * /cart/add.js lines for a server-side quote, grouped under the design id.
 * Null when any part is unresolved: the cart never gets a partial design.
 */
export function buildKoshoyCartLines(
  quote: KoshoyQuote,
  designId: string,
): KoshoyCartLine[] | null {
  if (quote.totalCents === null || quote.unresolved.length || !quote.lines.length) return null;
  const lines: KoshoyCartLine[] = [];
  for (const line of quote.lines) {
    if (line.variantId === null || !Number.isSafeInteger(line.qty) || line.qty < 1) return null;
    lines.push({
      variantId: line.variantId,
      quantity: line.qty,
      properties: { _tasarim: designId },
    });
  }
  return lines;
}
