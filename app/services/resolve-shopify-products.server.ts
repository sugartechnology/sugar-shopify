import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { MAX_PRODUCT_IMAGES } from "./sugar-api.server";
import type { DesignProductInput, DesignProductSelection } from "../types/sugar";

type VariantNode = {
  id?: string;
  title?: string;
  price?: string;
  image?: { url?: string | null } | null;
  product?: {
    id?: string;
    title?: string;
    handle?: string;
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

  return urls.slice(0, MAX_PRODUCT_IMAGES);
}

export async function resolveDesignProductsFromShopify(
  admin: AdminApiContext["admin"],
  selections: DesignProductSelection[],
): Promise<DesignProductInput[]> {
  if (selections.length === 0) {
    return [];
  }

  const ids = selections.map((s) => toVariantGid(s.variantId));
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
    });
  }

  return resolved;
}
