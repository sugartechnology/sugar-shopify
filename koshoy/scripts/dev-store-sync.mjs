/**
 * Copies what Koshoy Studio needs from the LIVE store into the DEV store:
 *   1. Part products (every product except our cart bundles, tag koshoy-tasarim):
 *      title, status, vendor, type, tags, description, options, variants + prices,
 *      and the `koshoy` metafields (koshoy.parca).
 *   2. Akın's data documents (data API: rooms, kinds, levels, …) that live has saved.
 *
 * The live side is READ ONLY: live Shopify gets GraphQL queries only (a mutation is
 * refused in code, see liveShopify), the live data API gets GET only.
 *
 *   node scripts/dev-store-sync.mjs            show what would change, write nothing
 *   node scripts/dev-store-sync.mjs --apply    write the changes into the dev store
 *   … --only products | --only data            one half only
 *
 * Products are matched by handle: missing ones are created, different ones updated,
 * equal ones left alone. Dev products that live does not have are listed, never deleted.
 * Run it again whenever the live catalog or Akın's data changes.
 *
 * Settings come from the environment (scripts/dev-store-sync.sh fills them from Coolify):
 *   LIVE_SHOP, LIVE_CLIENT_ID, LIVE_CLIENT_SECRET      Koshoy Studio on the live store
 *   DEV_SHOP,  DEV_CLIENT_ID,  DEV_CLIENT_SECRET       Koshoy Dev on the dev store
 *   LIVE_DATA_URL, LIVE_DATA_KEY                       e.g. https://koshoy.sugartech.io/api/koshoy
 *   DEV_DATA_URL,  DEV_DATA_KEY                        e.g. https://koshoy-dev.sugartech.io/api/koshoy
 * Secrets are never printed.
 */

const API_VERSION = "2026-10";
const LIVE_STORE = "21tn4m-us.myshopify.com";
const BUNDLE_TAG = "koshoy-tasarim";

const APPLY = process.argv.includes("--apply");
const onlyIndex = process.argv.indexOf("--only");
const ONLY = onlyIndex > 0 ? process.argv[onlyIndex + 1] : "";

function env(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`missing setting ${name}`);
  return value;
}

/* ---------------- Shopify access ---------------- */

/** Admin API token for an app installed on the shop (client credentials grant). */
async function accessToken(shop, clientId, clientSecret) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`token for ${shop} refused (${response.status}): ${body.error_description ?? body.error ?? ""}`);
  }
  return body.access_token;
}

function graphqlClient(shop, token) {
  return async function graphql(query, variables = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
      });
      const body = await response.json().catch(() => ({}));
      const throttled =
        response.status === 429 || (body.errors ?? []).some((e) => e?.extensions?.code === "THROTTLED");
      if (throttled && attempt < 8) {
        await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
        continue;
      }
      if (!response.ok || body.errors) {
        throw new Error(`${shop} GraphQL failed (${response.status}): ${JSON.stringify(body.errors ?? body).slice(0, 400)}`);
      }
      return body.data;
    }
  };
}

/** The live store: queries only. Anything else is refused before it leaves this process. */
function liveShopify(graphql) {
  return (query, variables) => {
    if (/\bmutation\b/i.test(query) || !/^\s*(#graphql\s*)?query\b/.test(query)) {
      throw new Error("refused: only GraphQL queries may be sent to the live store");
    }
    return graphql(query, variables);
  };
}

/* ---------------- products ---------------- */

const PRODUCTS_QUERY = `query KoshoyDevSyncProducts($after: String) {
  products(first: 50, after: $after, query: "-tag:${BUNDLE_TAG}") {
    pageInfo { hasNextPage endCursor }
    nodes {
      handle title status vendor productType tags descriptionHtml
      options { name optionValues { name } }
      metafields(first: 25, namespace: "koshoy") { nodes { namespace key type value } }
      variants(first: 100) { nodes { sku price compareAtPrice selectedOptions { name value } } }
    }
  }
}`;

const PRODUCT_SET = `mutation KoshoyDevSyncSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id }
    userErrors { field message }
  }
}`;

async function readProducts(query) {
  const out = new Map();
  let after = null;
  do {
    const data = await query(PRODUCTS_QUERY, { after });
    for (const product of data.products.nodes) {
      if (!product.tags.includes(BUNDLE_TAG)) out.set(product.handle, product);
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

/** The product as productSet input; also used to compare live and dev. */
function toSetInput(product) {
  return {
    handle: product.handle,
    title: product.title,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    tags: [...product.tags].sort(),
    descriptionHtml: product.descriptionHtml ?? "",
    productOptions: product.options.map((option) => ({
      name: option.name,
      values: option.optionValues.map((value) => ({ name: value.name })),
    })),
    variants: product.variants.nodes.map((variant) => ({
      optionValues: variant.selectedOptions.map((o) => ({ optionName: o.name, name: o.value })),
      price: String(variant.price),
      compareAtPrice: variant.compareAtPrice === null ? null : String(variant.compareAtPrice),
      sku: variant.sku || undefined,
      // The dev store keeps no stock; an untracked part can always go into a bundle.
      inventoryItem: { tracked: false },
    })),
    metafields: product.metafields.nodes.map((m) => ({
      namespace: m.namespace,
      key: m.key,
      type: m.type,
      value: m.value,
    })),
  };
}

function sameProduct(live, dev) {
  const strip = (input) => ({ ...input, variants: input.variants.map(({ inventoryItem, ...v }) => v) });
  return JSON.stringify(strip(toSetInput(live))) === JSON.stringify(strip(toSetInput(dev)));
}

async function syncProducts(liveQuery, devGraphql) {
  const live = await readProducts(liveQuery);
  const dev = await readProducts(devGraphql);
  const create = [...live.keys()].filter((handle) => !dev.has(handle));
  const update = [...live.keys()].filter((handle) => dev.has(handle) && !sameProduct(live.get(handle), dev.get(handle)));
  const devOnly = [...dev.keys()].filter((handle) => !live.has(handle));

  console.log(`products: live ${live.size}, dev ${dev.size} → create ${create.length}, update ${update.length}, equal ${live.size - create.length - update.length}`);
  for (const handle of [...create, ...update].slice(0, 15)) {
    console.log(`  ${create.includes(handle) ? "+" : "~"} ${live.get(handle).title}`);
  }
  if (create.length + update.length > 15) console.log(`  … and ${create.length + update.length - 15} more`);
  if (devOnly.length) console.log(`  dev-only (left alone): ${devOnly.slice(0, 10).join(", ")}${devOnly.length > 10 ? " …" : ""}`);
  if (!APPLY) return;

  let failed = 0;
  for (const [index, handle] of [...create, ...update].entries()) {
    const data = await devGraphql(PRODUCT_SET, { input: toSetInput(live.get(handle)), identifier: { handle } });
    const errors = data.productSet.userErrors;
    if (errors.length) {
      failed += 1;
      console.error(`  ! ${handle}: ${errors.map((e) => e.message).join("; ")}`);
    }
    if ((index + 1) % 50 === 0) console.log(`  … ${index + 1} written`);
  }
  console.log(`products written: ${create.length + update.length - failed}, failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

/* ---------------- Akın's data (data API) ---------------- */

async function dataRequest(base, key, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${base}${path} → ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function syncData() {
  const liveBase = env("LIVE_DATA_URL");
  const devBase = env("DEV_DATA_URL");
  // Live: GET only.
  const live = (await dataRequest(liveBase, env("LIVE_DATA_KEY"), "/data")).docs;
  const dev = (await dataRequest(devBase, env("DEV_DATA_KEY"), "/data")).docs;
  for (const [key, entry] of Object.entries(live)) {
    if (entry.source !== "db") {
      console.log(`data ${key}: live uses the built-in default, skipped`);
      continue;
    }
    if (JSON.stringify(dev[key]?.value) === JSON.stringify(entry.value)) {
      console.log(`data ${key}: equal`);
      continue;
    }
    console.log(`data ${key}: ${APPLY ? "writing" : "would write"} live version ${entry.version}`);
    if (APPLY) {
      await dataRequest(devBase, env("DEV_DATA_KEY"), `/data/${key}`, { method: "PUT", body: JSON.stringify(entry.value) });
    }
  }
}

/* ---------------- main ---------------- */

async function main() {
  const liveShop = env("LIVE_SHOP");
  const devShop = env("DEV_SHOP");
  if (devShop === liveShop || devShop === LIVE_STORE) throw new Error("refused: DEV_SHOP is the live store");
  console.log(`${APPLY ? "APPLY" : "DRY RUN (add --apply to write)"} — live ${liveShop} → dev ${devShop}`);

  if (ONLY !== "data") {
    const liveToken = await accessToken(liveShop, env("LIVE_CLIENT_ID"), env("LIVE_CLIENT_SECRET"));
    const devToken = await accessToken(devShop, env("DEV_CLIENT_ID"), env("DEV_CLIENT_SECRET"));
    await syncProducts(liveShopify(graphqlClient(liveShop, liveToken)), graphqlClient(devShop, devToken));
  }
  if (ONLY !== "products") await syncData();
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
