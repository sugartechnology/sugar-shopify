/**
 * Cart bundles: at add-to-cart time a design becomes one Shopify product whose
 * single variant is a fixed bundle of the part variants (variant-level bundle,
 * productVariantRelationshipBulkUpdate). Koshoy Studio owns these products.
 *
 * - Name follows the store content guide §4.1:
 *   `[özellik] Tür Genişlik cm, Sayılı özellik – Renk`.
 * - Shopify never recomputes a bundle price; we write Σ part prices once.
 *   The handle hashes name + parts + price, so a bundle is immutable: a
 *   changed design or price gets a new product, an identical one is reused.
 * - Status UNLISTED + Online Store publication: buyable by link/cart, hidden
 *   from search and collections.
 */
import { createHash } from "node:crypto";
import { CABIN_COLORS, DESIGN_KIND_LABELS, normalizeCabinColor } from "./cabinet-core";
import type { CabinComposition, DesignKind } from "./engine";
import type { KoshoyAdminGraphql, KoshoyQuote } from "./pricing.server";
import { variantGidToNumber } from "./pricing.server";

export const BUNDLE_TAG = "koshoy-tasarim";
const NAME_MAX = 70;

/** Product type names from the content guide's fixed list. */
const BUNDLE_TYPES: Record<DesignKind, string> = {
  ...DESIGN_KIND_LABELS,
  tv_unitesi: "TV Ünitesi",
};

/** Kinds whose name already implies drawers: no "Çekmeceli" prefix. */
const DRAWER_KINDS: ReadonlySet<DesignKind> = new Set(["komodin", "sifonyer"]);

function cmText(mm: number): string {
  return String(Math.round(mm) / 10).replace(".", ",");
}

function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word) => word.charAt(0).toLocaleUpperCase("tr-TR") + word.slice(1))
    .join(" ");
}

function partCount(quote: KoshoyQuote, part: string): number {
  return quote.lines.filter((line) => line.part === part).reduce((sum, line) => sum + line.qty, 0);
}

export function bundleTitle(kind: DesignKind, composition: CabinComposition, quote: KoshoyQuote): string {
  const type = BUNDLE_TYPES[kind] ?? "Dolap";
  const widthMm = composition.units.reduce((sum, unit) => sum + unit.widthMm, 0);
  const doors = partCount(quote, "KAPAK");
  const drawers = partCount(quote, "CEKMECE_ON");
  const shelves = partCount(quote, "RAF");

  const features: string[] = [];
  if (doors > 0) features.push(`${doors} Kapaklı`);
  else if (drawers > 0) features.push(`${drawers} Çekmeceli`);
  if (doors === 0 && shelves > 0) features.push("Açık Raflı");

  const prefix = doors > 0 && drawers > 0 && !DRAWER_KINDS.has(kind) ? "Çekmeceli " : "";
  const colorId = normalizeCabinColor(composition.color);
  const color = titleCase(CABIN_COLORS.find((option) => option.id === colorId)?.label ?? "");

  let title = `${prefix}${type} ${cmText(widthMm)} cm`;
  if (features.length) title += `, ${features.join(" ")}`;
  if (color) title += ` – ${color}`;
  return title.length > NAME_MAX ? title.slice(0, NAME_MAX).trimEnd() : title;
}

export interface BundleComponent {
  variantId: number;
  quantity: number;
}

export interface BundleSpec {
  title: string;
  productType: string;
  components: BundleComponent[];
  priceCents: number;
}

export function bundleHandle(spec: BundleSpec): string {
  const parts = [...spec.components]
    .sort((a, b) => a.variantId - b.variantId)
    .map((c) => `${c.variantId}x${c.quantity}`)
    .join(",");
  const hash = createHash("sha256")
    .update(`${spec.title}|${parts}|${spec.priceCents}`)
    .digest("hex")
    .slice(0, 16);
  return `${BUNDLE_TAG}-${hash}`;
}

export function bundleSpec(
  kind: DesignKind,
  composition: CabinComposition,
  quote: KoshoyQuote,
): BundleSpec | null {
  if (quote.totalCents === null || quote.unresolved.length || !quote.lines.length) return null;
  const merged = new Map<number, number>();
  for (const line of quote.lines) {
    if (line.variantId === null || !Number.isSafeInteger(line.qty) || line.qty < 1) return null;
    merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.qty);
  }
  // Shopify: at most 30 components per bundle.
  if (merged.size > 30) return null;
  return {
    title: bundleTitle(kind, composition, quote),
    productType: BUNDLE_TYPES[kind] ?? "Dolap",
    components: [...merged].map(([variantId, quantity]) => ({ variantId, quantity })),
    priceCents: quote.totalCents,
  };
}

export interface KoshoyBundler {
  /** Returns the numeric bundle variant id for /cart/add.js. */
  ensure(spec: BundleSpec): Promise<number>;
}

const variantGid = (id: number) => `gid://shopify/ProductVariant/${id}`;
const centsToMoney = (cents: number) => (cents / 100).toFixed(2);

async function gql<T>(
  admin: KoshoyAdminGraphql,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) {
    throw new Error(`Shopify bundle call failed: ${JSON.stringify(json.errors ?? "no data")}`);
  }
  return json.data;
}

function assertNoUserErrors(step: string, errors: Array<{ message?: string }> | undefined) {
  if (errors?.length) {
    throw new Error(`Shopify ${step}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

const FIND_QUERY = `#graphql
  query KoshoyBundleFind($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      variants(first: 1) { nodes { id price requiresComponents } }
    }
  }`;

const CREATE_MUTATION = `#graphql
  mutation KoshoyBundleCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id variants(first: 1) { nodes { id } } }
      userErrors { field message }
    }
  }`;

const PRICE_MUTATION = `#graphql
  mutation KoshoyBundlePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`;

const RELATION_MUTATION = `#graphql
  mutation KoshoyBundleComponents($input: [ProductVariantRelationshipUpdateInput!]!) {
    productVariantRelationshipBulkUpdate(input: $input) {
      userErrors { code field message }
    }
  }`;

const PUBLICATIONS_QUERY = `#graphql
  query KoshoyPublications {
    publications(first: 25) { nodes { id name } }
  }`;

const PUBLISH_MUTATION = `#graphql
  mutation KoshoyBundlePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

const onlineStoreByShop = new Map<string, string>();
const inflight = new Map<string, Promise<number>>();

async function onlineStorePublicationId(admin: KoshoyAdminGraphql, shop: string): Promise<string> {
  const cached = onlineStoreByShop.get(shop);
  if (cached) return cached;
  const data = await gql<{ publications: { nodes: Array<{ id: string; name: string }> } }>(
    admin,
    PUBLICATIONS_QUERY,
    {},
  );
  const found = data.publications.nodes.find((p) => /online store|çevrimiçi mağaza/i.test(p.name));
  if (!found) throw new Error("Online Store publication not found");
  onlineStoreByShop.set(shop, found.id);
  return found.id;
}

async function createProduct(
  admin: KoshoyAdminGraphql,
  spec: BundleSpec,
  handle: string,
): Promise<{ productId: string; variantId: string }> {
  const base = {
    title: spec.title,
    handle,
    productType: spec.productType,
    vendor: "Koshoy",
    tags: [BUNDLE_TAG],
  };
  type CreateData = {
    productCreate: {
      product: { id: string; variants: { nodes: Array<{ id: string }> } } | null;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  };
  let data = await gql<CreateData>(admin, CREATE_MUTATION, { product: { ...base, status: "UNLISTED" } });
  if (data.productCreate.userErrors.length) {
    // Shops without the UNLISTED status: fall back to ACTIVE.
    console.warn("[koshoy] bundle UNLISTED refused", data.productCreate.userErrors);
    data = await gql<CreateData>(admin, CREATE_MUTATION, { product: { ...base, status: "ACTIVE" } });
  }
  assertNoUserErrors("productCreate", data.productCreate.userErrors);
  const product = data.productCreate.product;
  const variantId = product?.variants.nodes[0]?.id;
  if (!product || !variantId) throw new Error("Shopify productCreate returned no variant");
  return { productId: product.id, variantId };
}

async function completeBundle(
  admin: KoshoyAdminGraphql,
  shop: string,
  spec: BundleSpec,
  productId: string,
  variantId: string,
  hasComponents: boolean,
) {
  const price = await gql<{ productVariantsBulkUpdate: { userErrors: Array<{ message?: string }> } }>(
    admin,
    PRICE_MUTATION,
    {
      productId,
      variants: [{ id: variantId, price: centsToMoney(spec.priceCents), inventoryItem: { tracked: false } }],
    },
  );
  assertNoUserErrors("productVariantsBulkUpdate", price.productVariantsBulkUpdate.userErrors);

  if (!hasComponents) {
    const relation = await gql<{
      productVariantRelationshipBulkUpdate: { userErrors: Array<{ message?: string }> };
    }>(admin, RELATION_MUTATION, {
      input: [
        {
          parentProductVariantId: variantId,
          productVariantRelationshipsToCreate: spec.components.map((c) => ({
            id: variantGid(c.variantId),
            quantity: c.quantity,
          })),
        },
      ],
    });
    assertNoUserErrors(
      "productVariantRelationshipBulkUpdate",
      relation.productVariantRelationshipBulkUpdate.userErrors,
    );
  }

  const publicationId = await onlineStorePublicationId(admin, shop);
  const publish = await gql<{ publishablePublish: { userErrors: Array<{ message?: string }> } }>(
    admin,
    PUBLISH_MUTATION,
    { id: productId, input: [{ publicationId }] },
  );
  assertNoUserErrors("publishablePublish", publish.publishablePublish.userErrors);
}

async function ensureBundle(admin: KoshoyAdminGraphql, shop: string, spec: BundleSpec): Promise<number> {
  const handle = bundleHandle(spec);
  const found = await gql<{
    productByIdentifier: {
      id: string;
      variants: { nodes: Array<{ id: string; price: string; requiresComponents: boolean }> };
    } | null;
  }>(admin, FIND_QUERY, { handle });

  const existing = found.productByIdentifier;
  const existingVariant = existing?.variants.nodes[0];
  if (existing && existingVariant) {
    const priced = Math.round(Number(existingVariant.price) * 100) === spec.priceCents;
    if (!priced || !existingVariant.requiresComponents) {
      // A previous attempt stopped half way: finish it.
      await completeBundle(admin, shop, spec, existing.id, existingVariant.id, existingVariant.requiresComponents);
    }
    const id = variantGidToNumber(existingVariant.id);
    if (id === null) throw new Error("bad bundle variant id");
    return id;
  }

  const created = await createProduct(admin, spec, handle);
  await completeBundle(admin, shop, spec, created.productId, created.variantId, false);
  const id = variantGidToNumber(created.variantId);
  if (id === null) throw new Error("bad bundle variant id");
  return id;
}

export function createKoshoyBundler(admin: KoshoyAdminGraphql, shop: string): KoshoyBundler {
  return {
    ensure(spec) {
      // One build per bundle at a time; a double click reuses the same promise.
      const key = `${shop}|${bundleHandle(spec)}`;
      const running = inflight.get(key);
      if (running) return running;
      const job = ensureBundle(admin, shop, spec).finally(() => inflight.delete(key));
      inflight.set(key, job);
      return job;
    },
  };
}
