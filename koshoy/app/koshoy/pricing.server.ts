/**
 * Koshoy pricing (Model B): composition → toBom → skuFor → Shopify variant
 * price. Shopify is the only price authority; an unresolved SKU never gets a
 * guessed price, the display becomes [FİYAT] and the SKU is logged.
 */
import { gidToNumericId } from "../services/shopify-ids";
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
const NEGATIVE_TTL_MS = 60 * 1000;
const SKUS_PER_QUERY = 25;

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
  { pattern: "GOVDE-960-2304-640-*", price: "6425.00" },
  { pattern: "KAPAK-477-2237-*", price: "1069.43" },
  { pattern: "RAF-960-640-*", price: "573.28" },
  { pattern: "ASKI-960", price: "396.00" },
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

const VARIANTS_BY_SKU_QUERY = `#graphql
  query KoshoyVariantsBySku($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      nodes {
        id
        sku
        price
      }
    }
  }
`;

type CacheEntry = { value: SkuPrice | null; expiresAt: number };
const sharedCache = new Map<string, CacheEntry>();

export function createShopifySkuResolver(
  admin: KoshoyAdminGraphql,
  shop: string,
  options: { cache?: Map<string, CacheEntry>; now?: () => number } = {},
): SkuResolver {
  const cache = options.cache ?? sharedCache;
  const now = options.now ?? Date.now;

  return async (skus) => {
    const out = new Map<string, SkuPrice>();
    const missing: string[] = [];
    for (const sku of skus) {
      const hit = cache.get(`${shop}|${sku}`);
      if (hit && hit.expiresAt > now()) {
        if (hit.value) out.set(sku, hit.value);
        continue;
      }
      missing.push(sku);
    }

    for (let offset = 0; offset < missing.length; offset += SKUS_PER_QUERY) {
      const batch = missing.slice(offset, offset + SKUS_PER_QUERY);
      const query = batch.map((sku) => `sku:"${sku.replace(/["\\]/g, "")}"`).join(" OR ");
      const response = await admin.graphql(VARIANTS_BY_SKU_QUERY, {
        variables: { query, first: Math.min(250, batch.length * 4) },
      });
      const json = (await response.json()) as {
        data?: { productVariants?: { nodes?: Array<{ id?: string; sku?: string | null; price?: unknown }> } };
        errors?: unknown;
      };
      if (json.errors || !json.data?.productVariants) {
        throw new Error("Variant lookup failed");
      }
      const found = new Map<string, SkuPrice>();
      for (const node of json.data.productVariants.nodes ?? []) {
        const sku = String(node?.sku ?? "");
        if (!batch.includes(sku) || found.has(sku)) continue;
        const variantId = variantGidToNumber(String(node?.id ?? ""));
        const priceCents = moneyToCents(node?.price);
        if (variantId && priceCents !== null) found.set(sku, { variantId, priceCents });
      }
      for (const sku of batch) {
        const value = found.get(sku) ?? null;
        cache.set(`${shop}|${sku}`, {
          value,
          expiresAt: now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
        });
        if (value) out.set(sku, value);
      }
    }
    return out;
  };
}

/**
 * Resolver for a shop: the spike price table when KOSHOY_PRICE_MOCK=1 (no
 * Shopify calls), otherwise Admin GraphQL productVariants by SKU.
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
