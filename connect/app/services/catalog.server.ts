import { unauthenticated } from "../shopify.server";

export type CatalogOption = { name: string; value: string };
export type CatalogVariant = {
  crmVariantProductId: string;
  sku?: string | null;
  price?: string | null;
  currency?: string | null;
  weight?: number | null;
  shopifyVariantGid?: string | null;
  options?: CatalogOption[] | null;
};
export type CatalogProduct = {
  crmProductId: string;
  title: string;
  description?: string | null;
  handle?: string | null;
  status?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  images?: string[] | null;
  rrProductId?: number | null;
  shopifyProductGid?: string | null;
  variants: CatalogVariant[];
};
export type CatalogUpsertRequest = {
  shopDomain: string;
  crmCompanyId: string;
  product: CatalogProduct;
};
export type CatalogUpsertResponse = {
  status: "CREATED" | "UPDATED" | "CONFLICT" | "FAILED";
  shopifyProductGid?: string;
  handle?: string;
  conflictSku?: string;
  existingProductGid?: string;
  message?: string;
  variants?: Array<{ crmVariantProductId: string; shopifyVariantGid: string }>;
};

type AdminClient = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];

const SHOP_QUERY = `#graphql
  query ConnectShop {
    shop {
      id
      myshopifyDomain
    }
  }
`;

const VARIANT_SKU_QUERY = `#graphql
  query ConnectVariantsBySku($query: String!) {
    productVariants(first: 20, query: $query) {
      nodes {
        id
        sku
        product {
          id
          title
        }
      }
    }
  }
`;

const PRODUCT_SET_MUTATION = `#graphql
  mutation ConnectProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $input) {
      product {
        id
        handle
        variants(first: 250) {
          nodes {
            id
            sku
            selectedOptions {
              name
              value
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation ConnectMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

export async function upsertCatalog(request: CatalogUpsertRequest): Promise<CatalogUpsertResponse> {
  const shop = normalizeShop(request.shopDomain);
  const admin = await adminForShop(shop);
  const product = request.product;
  const existingProductGid = product.shopifyProductGid || undefined;

  const conflict = await findSkuConflict(admin, product, existingProductGid);
  if (conflict) {
    return conflict;
  }

  const input = toProductSetInput(product);
  const response = await admin.graphql(PRODUCT_SET_MUTATION, {
    variables: { input, synchronous: true },
  });
  const body = await response.json();
  const payload = body.data?.productSet;
  const errors = payload?.userErrors || [];
  if (errors.length > 0 || !payload?.product?.id) {
    return {
      status: "FAILED",
      message: errors.map((error: { message: string }) => error.message).join("; ") || "productSet failed",
    };
  }

  const shopifyProductGid = payload.product.id as string;
  const shopifyVariants = payload.product.variants?.nodes || [];
  const mappedVariants = mapVariants(product.variants || [], shopifyVariants);

  await writeMetafields(admin, request.crmCompanyId, product, shopifyProductGid, mappedVariants);

  return {
    status: existingProductGid ? "UPDATED" : "CREATED",
    shopifyProductGid,
    handle: payload.product.handle,
    variants: mappedVariants,
  };
}

export async function loadShopIdentity(shopDomain: string) {
  const admin = await adminForShop(normalizeShop(shopDomain));
  const response = await admin.graphql(SHOP_QUERY);
  const body = await response.json();
  return {
    shopGid: body.data?.shop?.id as string | undefined,
    shopDomain: (body.data?.shop?.myshopifyDomain as string | undefined) || normalizeShop(shopDomain),
  };
}

async function adminForShop(shop: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  } catch {
    const error = new Error("APP_NOT_INSTALLED");
    (error as Error & { code?: string }).code = "APP_NOT_INSTALLED";
    throw error;
  }
}

async function findSkuConflict(
  admin: AdminClient,
  product: CatalogProduct,
  existingProductGid?: string,
): Promise<CatalogUpsertResponse | null> {
  const skus = (product.variants || [])
    .map((variant) => variant.sku?.trim())
    .filter((sku): sku is string => Boolean(sku));
  if (skus.length === 0) {
    return null;
  }
  const query = skus.map((sku) => `sku:${escapeSku(sku)}`).join(" OR ");
  const response = await admin.graphql(VARIANT_SKU_QUERY, { variables: { query } });
  const body = await response.json();
  const nodes = body.data?.productVariants?.nodes || [];
  for (const node of nodes) {
    const productId = node.product?.id as string | undefined;
    if (productId && productId !== existingProductGid) {
      return {
        status: "CONFLICT",
        conflictSku: node.sku,
        existingProductGid: productId,
        message: `SKU ${node.sku} already exists on another Shopify product`,
      };
    }
  }
  return null;
}

function toProductSetInput(product: CatalogProduct) {
  const variants = product.variants || [];
  const optionNames = uniqueOptionNames(variants);
  const productOptions = optionNames.length > 0
    ? optionNames.map((name, index) => ({
        name,
        position: index + 1,
        values: uniqueOptionValues(variants, name).map((value) => ({ name: value })),
      }))
    : [{ name: "Title", values: [{ name: "Default Title" }] }];

  return {
    id: product.shopifyProductGid || undefined,
    title: product.title,
    descriptionHtml: product.description || "",
    handle: product.handle || undefined,
    status: product.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
    productType: product.productType || undefined,
    ...(product.tags && product.tags.length > 0 ? { tags: product.tags } : {}),
    productOptions,
    variants: variants.map((variant) => ({
      id: variant.shopifyVariantGid || undefined,
      sku: variant.sku || undefined,
      price: variant.price || "0.00",
      optionValues: (variant.options || []).length > 0
        ? (variant.options || []).map((option) => ({
            optionName: option.name,
            name: option.value,
          }))
        : [{ optionName: "Title", name: "Default Title" }],
      inventoryItem: variant.weight
        ? {
            sku: variant.sku || undefined,
            measurement: {
              weight: {
                value: variant.weight,
                unit: "KILOGRAMS",
              },
            },
          }
        : variant.sku
          ? { sku: variant.sku }
          : undefined,
    })),
    ...((product.images || []).length > 0
      ? {
          files: (product.images || []).map((url, index) => ({
            originalSource: url,
            contentType: "IMAGE",
            alt: `${product.title} ${index + 1}`,
            filename: filenameFromUrl(url, index),
          })),
        }
      : {}),
  };
}

async function writeMetafields(
  admin: AdminClient,
  companyId: string,
  product: CatalogProduct,
  productGid: string,
  variants: Array<{ crmVariantProductId: string; shopifyVariantGid: string }>,
) {
  const metafields = [
    metafield(productGid, "crm_product_id", product.crmProductId),
    metafield(productGid, "crm_company_id", companyId),
  ];
  if (product.rrProductId != null) {
    metafields.push(metafield(productGid, "rr_product_id", String(product.rrProductId)));
  }
  for (const variant of variants) {
    metafields.push(metafield(variant.shopifyVariantGid, "crm_variant_id", variant.crmVariantProductId));
    metafields.push(metafield(variant.shopifyVariantGid, "crm_product_id", product.crmProductId));
    metafields.push(metafield(variant.shopifyVariantGid, "crm_company_id", companyId));
  }
  await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields } });
}

function mapVariants(
  requested: CatalogVariant[],
  shopifyVariants: Array<{ id: string; sku?: string | null; selectedOptions?: Array<{ name: string; value: string }> }>,
) {
  const remaining = [...shopifyVariants];
  const mapped: Array<{ crmVariantProductId: string; shopifyVariantGid: string }> = [];
  for (const variant of requested) {
    const skuMatchIndex = variant.sku
      ? remaining.findIndex((item) => item.sku && item.sku === variant.sku)
      : -1;
    const optionKey = optionSignature(variant.options || []);
    const optionMatchIndex = skuMatchIndex < 0
      ? remaining.findIndex((item) => optionSignature(item.selectedOptions || []) === optionKey)
      : skuMatchIndex;
    const match = optionMatchIndex >= 0 ? remaining.splice(optionMatchIndex, 1)[0] : remaining.shift();
    if (match) {
      mapped.push({
        crmVariantProductId: variant.crmVariantProductId,
        shopifyVariantGid: match.id,
      });
    }
  }
  return mapped;
}

function metafield(ownerId: string, key: string, value: string) {
  return {
    ownerId,
    namespace: "sugar",
    key,
    type: "single_line_text_field",
    value,
  };
}

function uniqueOptionNames(variants: CatalogVariant[]) {
  const names: string[] = [];
  for (const variant of variants) {
    for (const option of variant.options || []) {
      if (option.name && !names.includes(option.name)) {
        names.push(option.name);
      }
    }
  }
  return names;
}

function uniqueOptionValues(variants: CatalogVariant[], name: string) {
  const values: string[] = [];
  for (const variant of variants) {
    for (const option of variant.options || []) {
      if (option.name === name && option.value && !values.includes(option.value)) {
        values.push(option.value);
      }
    }
  }
  return values;
}

function optionSignature(options: Array<{ name?: string; value?: string }>) {
  return options
    .map((option) => `${option.name || ""}=${option.value || ""}`)
    .sort()
    .join("|");
}

function filenameFromUrl(url: string, index: number) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    return name && name.includes(".") ? name : `image-${index + 1}.jpg`;
  } catch {
    return `image-${index + 1}.jpg`;
  }
}

function escapeSku(sku: string) {
  return `"${sku.replaceAll('"', '\\"')}"`;
}

function normalizeShop(shop: string) {
  const normalized = shop.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return normalized.includes(".") ? normalized : `${normalized}.myshopify.com`;
}
