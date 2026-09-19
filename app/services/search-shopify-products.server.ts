import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type {
  ShoppingAssistantFilters,
  ShoppingProductCard,
} from "../types/shopping-chat";
import { gidToNumericId } from "./resolve-shopify-products.server";

const MAX_QUERIES = 8;
const MAX_PER_QUERY = 10;

export function moneyAmount(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object" && "amount" in raw) {
    return moneyAmount((raw as { amount?: unknown }).amount);
  }
  return "";
}

export function priceToCents(raw: unknown): number {
  const value =
    typeof raw === "number" ? raw : Number.parseFloat(moneyAmount(raw));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export function centsToPrice(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

export function parseCollectionIds(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("gid://")) return gidToNumericId(trimmed);
      return trimmed.replace(/[^\d]/g, "");
    })
    .filter(Boolean);
}

export function filtersFromShopConfig(config: {
  shopAssistantCollectionIds: string;
  shopAssistantInStockOnly: boolean;
  shopAssistantMinPrice: string;
  shopAssistantMaxPrice: string;
}): ShoppingAssistantFilters {
  const min = Number.parseFloat(config.shopAssistantMinPrice);
  const max = Number.parseFloat(config.shopAssistantMaxPrice);
  return {
    collectionIds: parseCollectionIds(config.shopAssistantCollectionIds),
    inStockOnly: config.shopAssistantInStockOnly,
    minPriceCents: Number.isFinite(min) && min > 0 ? priceToCents(min) : null,
    maxPriceCents: Number.isFinite(max) && max > 0 ? priceToCents(max) : null,
  };
}

export function buildProductSearchQuery(
  term: string,
  filters: ShoppingAssistantFilters,
): string {
  const parts: string[] = [];
  const cleaned = term.replace(/"/g, "").trim();
  if (cleaned) parts.push(cleaned);
  if (filters.inStockOnly) parts.push("available_for_sale:true");
  if (filters.collectionIds.length) {
    parts.push(
      `(${filters.collectionIds.map((id) => `collection_id:${id}`).join(" OR ")})`,
    );
  }
  return parts.join(" ");
}

function passesPriceFilter(
  priceCents: number,
  filters: ShoppingAssistantFilters,
): boolean {
  if (filters.minPriceCents != null && priceCents < filters.minPriceCents) {
    return false;
  }
  if (filters.maxPriceCents != null && priceCents > filters.maxPriceCents) {
    return false;
  }
  return true;
}

type SearchNode = {
  id?: string;
  title?: string;
  handle?: string;
  featuredImage?: { url?: string | null } | null;
  variants?: {
    nodes?: Array<{
      id?: string;
      title?: string;
      price?: string;
      availableForSale?: boolean;
      image?: { url?: string | null } | null;
    } | null>;
  } | null;
};

function pickVariant(product: SearchNode, inStockOnly: boolean) {
  const variants = (product.variants?.nodes ?? []).filter(Boolean);
  const available = variants.find((variant) => variant?.availableForSale);
  if (inStockOnly) return available ?? null;
  return available ?? variants[0] ?? null;
}

function toCard(
  product: SearchNode,
  currency: string,
  filters: ShoppingAssistantFilters,
): ShoppingProductCard | null {
  const variant = pickVariant(product, filters.inStockOnly);
  if (!variant?.id) return null;
  const priceCents = priceToCents(variant.price);
  if (!passesPriceFilter(priceCents, filters)) return null;
  if (filters.inStockOnly && variant.availableForSale === false) return null;
  return {
    productId: gidToNumericId(product.id),
    variantId: gidToNumericId(variant.id),
    title: String(product.title ?? "").trim() || "Product",
    handle: String(product.handle ?? "").trim(),
    imageUrl: variant.image?.url || product.featuredImage?.url || "",
    price: centsToPrice(priceCents),
    priceCents,
    currency,
    available: variant.availableForSale !== false,
  };
}

export async function searchShopifyProducts(
  admin: AdminApiContext["admin"],
  queries: string[],
  filters: ShoppingAssistantFilters,
): Promise<{ currency: string; products: ShoppingProductCard[] }> {
  const terms = queries
    .map((query) => String(query ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_QUERIES);
  const seen = new Set<string>();
  const products: ShoppingProductCard[] = [];
  let currency = "";

  if (terms.length === 0) {
    terms.push("");
  }

  for (const term of terms) {
    const response = await admin.graphql(
      `#graphql
        query ShoppingProductSearch($query: String!, $first: Int!) {
          shop {
            currencyCode
          }
          products(first: $first, query: $query) {
            nodes {
              id
              title
              handle
              featuredImage {
                url
              }
              variants(first: 8) {
                nodes {
                  id
                  title
                  price
                  availableForSale
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: buildProductSearchQuery(term, filters),
          first: MAX_PER_QUERY,
        },
      },
    );
    const json = await response.json();
    currency = String(json.data?.shop?.currencyCode ?? currency);
    const nodes = (json.data?.products?.nodes ?? []) as SearchNode[];
    for (const node of nodes) {
      const card = toCard(node, currency || "TRY", filters);
      if (!card || seen.has(card.variantId)) continue;
      seen.add(card.variantId);
      products.push(card);
    }
  }

  return { currency: currency || "TRY", products };
}
