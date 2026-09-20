import { unauthenticated } from "../shopify.server";
import { normalizeShop } from "./shop.server";

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

const PRODUCT_HANDLE_QUERY = `#graphql
  query ConnectProductByHandle($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        handle
      }
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
  const product: CatalogProduct = {
    ...request.product,
    shopifyProductGid: request.product.shopifyProductGid || (await findExistingProductGid(admin, request.product)),
  };

  const conflict = await findSkuConflict(admin, product, product.shopifyProductGid || undefined);
  if (conflict) {
    return conflict;
  }

  const created = await runProductSet(admin, product, true);
  const result = created.ok || !created.inputHadFiles
    ? created
    : await runProductSet(admin, product, false);
  if (!result.ok || !result.product?.id) {
    return {
      status: "FAILED",
      message: result.message || "productSet failed",
    };
  }

  const shopifyProductGid = result.product.id;
  const mappedVariants = mapVariants(product.variants || [], result.product.variants?.nodes || []);
  try {
    await writeMetafields(admin, request.crmCompanyId, product, shopifyProductGid, mappedVariants);
  } catch (error) {
    console.error("Connect metafields failed", shop, error instanceof Error ? error.message : error);
  }

  return {
    status: product.shopifyProductGid ? "UPDATED" : "CREATED",
    shopifyProductGid,
    handle: result.product.handle,
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

type ProductSetResult = {
  ok: boolean;
  message?: string;
  inputHadFiles: boolean;
  product?: {
    id: string;
    handle?: string;
    variants?: { nodes: Array<{ id: string; sku?: string | null; selectedOptions?: Array<{ name: string; value: string }> }> };
  };
};

async function runProductSet(
  admin: AdminClient,
  product: CatalogProduct,
  includeFiles: boolean,
): Promise<ProductSetResult> {
  const input = toProductSetInput(product, includeFiles);
  const inputHadFiles = Array.isArray(input.files) && input.files.length > 0;
  const response = await admin.graphql(PRODUCT_SET_MUTATION, {
    variables: { input, synchronous: true },
  });
  const body = await response.json();
  const payload = body.data?.productSet;
  const message = collectGraphErrors(body, payload?.userErrors);
  if (message || !payload?.product?.id) {
    return { ok: false, message: message || "productSet failed", inputHadFiles, product: payload?.product };
  }
  return { ok: true, inputHadFiles, product: payload.product };
}

function collectGraphErrors(
  body: { errors?: Array<{ message?: string }> },
  userErrors?: Array<{ message?: string }>,
) {
  return [
    ...(userErrors || []).map((error) => error.message),
    ...(body.errors || []).map((error) => error.message),
  ].filter((message): message is string => Boolean(message)).join("; ");
}

async function findExistingProductGid(admin: AdminClient, product: CatalogProduct) {
  if (product.handle) {
    const response = await admin.graphql(PRODUCT_HANDLE_QUERY, {
      variables: { query: `handle:${escapeSku(product.handle)}` },
    });
    const body = await response.json();
    const id = body.data?.products?.nodes?.[0]?.id as string | undefined;
    if (id) {
      return id;
    }
  }
  const skuHits = await findSkuNodes(admin, product);
  const productIds = [...new Set(skuHits.map((node) => node.product?.id).filter((id): id is string => Boolean(id)))];
  return productIds.length === 1 ? productIds[0] : undefined;
}

async function findSkuNodes(admin: AdminClient, product: CatalogProduct) {
  const skus = (product.variants || [])
    .map((variant) => variant.sku?.trim())
    .filter((sku): sku is string => Boolean(sku));
  if (skus.length === 0) {
    return [];
  }
  const query = skus.map((sku) => `sku:${escapeSku(sku)}`).join(" OR ");
  const response = await admin.graphql(VARIANT_SKU_QUERY, { variables: { query } });
  const body = await response.json();
  return body.data?.productVariants?.nodes || [];
}

async function findSkuConflict(
  admin: AdminClient,
  product: CatalogProduct,
  existingProductGid?: string,
): Promise<CatalogUpsertResponse | null> {
  const nodes = await findSkuNodes(admin, product);
  if (nodes.length === 0) {
    return null;
  }
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

function toProductSetInput(product: CatalogProduct, includeFiles: boolean) {
  const variants = (product.variants || []).length > 0
    ? product.variants
    : [{ crmVariantProductId: product.crmProductId, price: "0.00", options: [] }];
  const optionNames = uniqueOptionNames(variants);
  const productOptions = optionNames.length > 0
    ? optionNames.map((name, index) => ({
        name,
        position: index + 1,
        values: uniqueOptionValues(variants, name).map((value) => ({ name: value })),
      }))
    : [{ name: "Title", values: [{ name: "Default Title" }] }];
  const files = includeFiles ? publicImageFiles(product) : [];

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
      inventoryItem: inventoryItemInput(variant),
    })),
    ...(files.length > 0 ? { files } : {}),
  };
}

function inventoryItemInput(variant: CatalogVariant) {
  const weight = Number(variant.weight);
  const hasWeight = Number.isFinite(weight) && weight > 0 && weight < 100000;
  if (!hasWeight && !variant.sku) {
    return undefined;
  }
  return {
    sku: variant.sku || undefined,
    ...(hasWeight
      ? {
          measurement: {
            weight: {
              value: weight,
              unit: "KILOGRAMS",
            },
          },
        }
      : {}),
  };
}

function publicImageFiles(product: CatalogProduct) {
  return (product.images || [])
    .filter((url) => isPublicImageUrl(url))
    .map((url, index) => ({
      originalSource: url,
      contentType: "IMAGE" as const,
      alt: `${product.title} ${index + 1}`,
      filename: filenameFromUrl(url, index),
    }));
}

function isPublicImageUrl(url: string) {
  if (!url || url.includes(";")) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
