import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { MAX_PRODUCT_IMAGES } from "./sugar-api.server";
import type {
  DesignProductInput,
  DesignProductSelection,
  ProductDetailMetafieldRef,
  ProductMetafieldDetail,
} from "../types/sugar";

export const DEFAULT_METAFIELD_DISCOVERY_NAMESPACE = "custom";
export const MAX_PRODUCT_DETAILS = 6;

export const METAFIELD_HINT_GROUPS: ReadonlyArray<{
  label: string;
  hints: readonly string[];
}> = [
  { label: "Malzeme", hints: ["material", "malzeme", "fabric", "kumas", "kumaş", "textile"] },
  { label: "Ölçü", hints: ["dimension", "dimensions", "olcu", "ölçü", "size", "boyut", "measure"] },
  { label: "Renk", hints: ["color", "colour", "renk", "finish", "tone"] },
  { label: "Stil", hints: ["style", "stil", "theme", "look"] },
  { label: "Ağırlık", hints: ["weight", "agirlik", "ağırlık"] },
];

export const METAFIELD_DISCOVERY_BLOCKLIST = new Set([
  "sku",
  "barcode",
  "upc",
  "ean",
  "price",
  "cost",
  "compare_at_price",
  "related_products",
  "relatedproducts",
  "google_product_category",
  "seo",
  "hidden",
  "internal",
]);

type MetafieldNode = {
  namespace?: string;
  key?: string;
  value?: string | null;
  type?: string | null;
};

type VariantNode = {
  id?: string;
  title?: string;
  price?: string;
  image?: { url?: string | null } | null;
  product?: {
    id?: string;
    title?: string;
    handle?: string;
    media?: {
      nodes?: Array<{
        image?: { url?: string | null } | null;
      } | null>;
    } | null;
    metafields?: {
      nodes?: Array<MetafieldNode | null>;
    } | null;
  } | null;
  media?: {
    nodes?: Array<{
      image?: { url?: string | null } | null;
    } | null>;
  } | null;
};

export function toVariantGid(variantId: string): string {
  const trimmed = variantId.trim();
  if (trimmed.startsWith("gid://")) {
    return trimmed;
  }
  return `gid://shopify/ProductVariant/${trimmed}`;
}

export function gidToNumericId(gid: string | undefined): string {
  if (!gid) return "";
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}

export function collectVariantImageUrls(variant: VariantNode): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  const push = (raw: string | null | undefined) => {
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    urls.push(raw);
  };

  for (const node of variant.media?.nodes ?? []) {
    push(node?.image?.url ?? undefined);
  }
  push(variant.image?.url ?? undefined);
  for (const node of variant.product?.media?.nodes ?? []) {
    push(node?.image?.url ?? undefined);
  }

  return urls.slice(0, MAX_PRODUCT_IMAGES);
}

function normalizeQuantity(raw: unknown): number {
  const qty = Number(raw);
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return Math.min(99, Math.floor(qty));
}

export function normalizeMetafieldKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function isBlockedMetafieldKey(key: string): boolean {
  const normalized = normalizeMetafieldKey(key);
  if (!normalized) return true;
  if (METAFIELD_DISCOVERY_BLOCKLIST.has(normalized)) return true;
  return normalized.includes("sku") || normalized.includes("barcode");
}

export function keyMatchesHint(key: string, hints: readonly string[]): boolean {
  const normalizedKey = normalizeMetafieldKey(key);
  if (!normalizedKey) return false;
  return hints.some((hint) => {
    const normalizedHint = normalizeMetafieldKey(hint);
    if (!normalizedHint) return false;
    return (
      normalizedKey === normalizedHint ||
      normalizedKey.includes(normalizedHint) ||
      normalizedHint.includes(normalizedKey)
    );
  });
}

export function getProductMetafieldNodes(variant: VariantNode): MetafieldNode[] {
  const nodes = variant.product?.metafields?.nodes ?? [];
  return nodes.filter((node): node is MetafieldNode => !!node?.namespace && !!node?.key);
}

function metafieldDedupeKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

function isTextLikeMetafieldValue(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("{") || value.startsWith("[")) return false;
  return value.length <= 500;
}

function pushDetail(
  details: ProductMetafieldDetail[],
  used: Set<string>,
  detail: ProductMetafieldDetail,
): void {
  const dedupe = metafieldDedupeKey(detail.namespace, detail.key);
  if (used.has(dedupe) || details.length >= MAX_PRODUCT_DETAILS) return;
  used.add(dedupe);
  details.push(detail);
}

export function resolveProductDetails(
  variant: VariantNode,
  explicitRefs: ProductDetailMetafieldRef[],
  discoveryNamespace: string = DEFAULT_METAFIELD_DISCOVERY_NAMESPACE,
): ProductMetafieldDetail[] {
  const nodes = getProductMetafieldNodes(variant);
  const details: ProductMetafieldDetail[] = [];
  const used = new Set<string>();
  const namespaceFilter = discoveryNamespace.trim() || DEFAULT_METAFIELD_DISCOVERY_NAMESPACE;

  const labelByExactKey = new Map<string, string>();
  for (const ref of explicitRefs) {
    const namespace = String(ref.namespace ?? "").trim();
    const key = String(ref.key ?? "").trim();
    if (!namespace || !key) continue;
    if (ref.label) {
      labelByExactKey.set(metafieldDedupeKey(namespace, key), ref.label);
    }
  }

  for (const ref of explicitRefs) {
    const namespace = String(ref.namespace ?? "").trim();
    const key = String(ref.key ?? "").trim();
    if (!namespace || !key) continue;

    const match = nodes.find(
      (node) => node.namespace === namespace && node.key === key,
    );
    const value = String(match?.value ?? "").trim();
    if (!value || !isTextLikeMetafieldValue(value)) continue;

    pushDetail(details, used, {
      namespace,
      key,
      label: ref.label || labelByExactKey.get(metafieldDedupeKey(namespace, key)),
      value,
    });
  }

  const discoveryCandidates = nodes.filter((node) => {
    const namespace = String(node.namespace ?? "").trim();
    const key = String(node.key ?? "").trim();
    const value = String(node.value ?? "").trim();
    if (!namespace || !key || !value) return false;
    if (namespace !== namespaceFilter) return false;
    if (isBlockedMetafieldKey(key)) return false;
    if (!isTextLikeMetafieldValue(value)) return false;
    if (used.has(metafieldDedupeKey(namespace, key))) return false;
    return true;
  });

  for (const group of METAFIELD_HINT_GROUPS) {
    if (details.length >= MAX_PRODUCT_DETAILS) break;

    const alreadyCovered = details.some((detail) =>
      keyMatchesHint(detail.key, group.hints),
    );
    if (alreadyCovered) continue;

    const match = discoveryCandidates.find((node) =>
      keyMatchesHint(String(node.key), group.hints),
    );
    if (!match?.namespace || !match.key) continue;

    pushDetail(details, used, {
      namespace: match.namespace,
      key: match.key,
      label: group.label,
      value: String(match.value ?? "").trim(),
    });
  }

  return details;
}

export async function resolveDesignProductsFromShopify(
  admin: AdminApiContext["admin"],
  selections: DesignProductSelection[],
  metafieldRefs: ProductDetailMetafieldRef[] = [],
  discoveryNamespace: string = DEFAULT_METAFIELD_DISCOVERY_NAMESPACE,
): Promise<DesignProductInput[]> {
  if (selections.length === 0) {
    return [];
  }

  const ids = selections.map((s) => toVariantGid(s.variantId));
  const namespace =
    discoveryNamespace.trim() || DEFAULT_METAFIELD_DISCOVERY_NAMESPACE;

  const response = await admin.graphql(
    `#graphql
      query ResolveProductVariantsForAi($ids: [ID!]!) {
        shop {
          currencyCode
        }
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            price
            image {
              url
            }
            product {
              id
              title
              handle
              media(first: 10) {
                nodes {
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }
              metafields(first: 50) {
                nodes {
                  namespace
                  key
                  value
                  type
                }
              }
            }
            media(first: 10) {
              nodes {
                ... on MediaImage {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }
    `,
    { variables: { ids } },
  );

  const json = await response.json();
  const currency = (json.data?.shop?.currencyCode as string | undefined) ?? "TRY";
  const nodes = (json.data?.nodes ?? []) as Array<VariantNode | null>;

  const byVariantId = new Map<string, VariantNode>();
  for (const node of nodes) {
    if (!node?.id) continue;
    byVariantId.set(gidToNumericId(node.id), node);
  }

  const resolved: DesignProductInput[] = [];

  for (const selection of selections) {
    const variant = byVariantId.get(String(selection.variantId));
    if (!variant) {
      throw new Error(`Variant not found: ${selection.variantId}`);
    }

    const images = collectVariantImageUrls(variant);
    const productId =
      selection.productId ||
      gidToNumericId(variant.product?.id) ||
      "";

    resolved.push({
      productId,
      variantId: gidToNumericId(variant.id) || String(selection.variantId),
      title: variant.product?.title || variant.title || "Product",
      handle: variant.product?.handle || "",
      price: String(variant.price ?? "0"),
      currency,
      imageUrl: images[0] ?? "",
      images,
      isPrimary: selection.isPrimary === true,
      quantity: normalizeQuantity(selection.quantity),
      productDetails: resolveProductDetails(variant, metafieldRefs, namespace),
      position: selection.position ?? null,
    });
  }

  return resolved;
}
