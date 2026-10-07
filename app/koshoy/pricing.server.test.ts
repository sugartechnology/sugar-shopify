import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { cabinetEngine, type CabinComposition } from "./engine";
import {
  buildKoshoyCartLines,
  createKoshoyPricer,
  createKoshoySkuResolver,
  createMockSkuResolver,
  createShopifySkuResolver,
  formatTl,
  variantGidToNumber,
  type KoshoyAdminGraphql,
} from "./pricing.server";

const GOLDEN: CabinComposition = {
  units: [
    {
      id: "cabin-1",
      widthMm: 960,
      heightMm: 2304,
      fittings: [
        { id: "fit-1", kind: "shelf" },
        { id: "fit-2", kind: "hanger" },
      ],
      hasDoor: true,
      color: "wood",
    },
    { id: "cabin-2", widthMm: 960, heightMm: 2304, fittings: [], hasDoor: false, color: "wood" },
  ],
  depthMm: 640,
  hasPlinth: true,
};

function fakeAdmin(nodes: Array<{ id: string; sku: string; price: string }>) {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const admin: KoshoyAdminGraphql = {
    async graphql(_query, options) {
      calls.push(options?.variables);
      return new Response(JSON.stringify({ data: { productVariants: { nodes } } }));
    },
  };
  return { admin, calls };
}

describe("koshoy pricing", () => {
  let errors: ReturnType<typeof mock.method>;
  const priceMockEnv = process.env.KOSHOY_PRICE_MOCK;
  beforeEach(() => {
    errors = mock.method(console, "error", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
    if (priceMockEnv === undefined) delete process.env.KOSHOY_PRICE_MOCK;
    else process.env.KOSHOY_PRICE_MOCK = priceMockEnv;
  });

  it("formats tr-TR money", () => {
    assert.equal(formatTl(1595814), "15.958,14 TL");
    assert.equal(formatTl(39600), "396,00 TL");
    assert.equal(formatTl(5), "0,05 TL");
  });

  it("prices the golden design from the spike mock table", async () => {
    const pricer = createKoshoyPricer(cabinetEngine, createMockSkuResolver());
    const quote = await pricer.quote(GOLDEN);
    assert.equal(quote.display, "15.958,14 TL");
    assert.equal(quote.totalCents, 1595814);
    assert.deepEqual(quote.unresolved, []);
    assert.ok(quote.lines.every((line) => Number.isSafeInteger(line.variantId)));
  });

  it("uses the spike table without calling Shopify when KOSHOY_PRICE_MOCK=1", async () => {
    const { admin, calls } = fakeAdmin([]);
    process.env.KOSHOY_PRICE_MOCK = "1";
    const quote = await createKoshoyPricer(
      cabinetEngine,
      createKoshoySkuResolver(admin, "koshoy.myshopify.com"),
    ).quote(GOLDEN);
    assert.equal(quote.display, "15.958,14 TL");
    assert.deepEqual(
      quote.lines.map((line) => [line.sku, line.qty, line.unitCents]),
      [
        ["GOVDE-960-2304-640-WOOD", 2, 642500],
        ["KAPAK-477-2237-WOOD", 2, 106943],
        ["RAF-960-640-WOOD", 1, 57328],
        ["ASKI-960", 1, 39600],
      ],
    );
    assert.equal(calls.length, 0);

    delete process.env.KOSHOY_PRICE_MOCK;
    await createKoshoyPricer(cabinetEngine, createKoshoySkuResolver(admin, "koshoy.myshopify.com")).quote(GOLDEN);
    assert.equal(calls.length, 1, "without the flag prices come from Shopify");
  });

  it("never guesses: an unresolved SKU makes the price [FİYAT]", async () => {
    const pricer = createKoshoyPricer(
      cabinetEngine,
      createMockSkuResolver([{ pattern: "GOVDE-*", price: "10.00" }]),
    );
    const quote = await pricer.quote(GOLDEN);
    assert.equal(quote.display, "[FİYAT]");
    assert.equal(quote.totalCents, null);
    assert.deepEqual(quote.unresolved.sort(), ["ASKI-960", "KAPAK-477-2237-WOOD", "RAF-960-640-WOOD"]);
    assert.ok(
      errors.mock.calls.some(
        (call) => call.arguments[0] === "[koshoy] unresolved sku" && Array.isArray(call.arguments[1]),
      ),
      "unresolved SKUs are logged server-side",
    );
    assert.equal(buildKoshoyCartLines(quote, "design1"), null, "no partial cart");
  });

  it("prices parts the spike table does not know as [FİYAT] (mock mode)", async () => {
    // Default gardırop: drawers and shorter doors have no spike price yet.
    const plan = cabinetEngine.planCabinet({ kind: "gardirop" });
    const quote = await createKoshoyPricer(cabinetEngine, createMockSkuResolver()).quote(plan.composition);
    assert.equal(quote.display, "[FİYAT]");
    assert.ok(quote.unresolved.includes("KAPAK-477-1597-WOOD"));
  });

  it("builds /cart/add.js lines grouped under the design id", async () => {
    const quote = await createKoshoyPricer(cabinetEngine, createMockSkuResolver()).quote(GOLDEN);
    const lines = buildKoshoyCartLines(quote, "d_123");
    assert.ok(lines);
    assert.deepEqual(
      lines.map((line) => [line.quantity, line.properties]),
      [
        [2, { _tasarim: "d_123" }],
        [2, { _tasarim: "d_123" }],
        [1, { _tasarim: "d_123" }],
        [1, { _tasarim: "d_123" }],
      ],
    );
    assert.ok(lines.every((line) => Number.isSafeInteger(line.variantId) && line.variantId > 0));
  });

  it("reads numeric variant ids from Shopify gids", () => {
    assert.equal(variantGidToNumber("gid://shopify/ProductVariant/4242"), 4242);
    assert.equal(variantGidToNumber("4242"), 4242);
    assert.equal(variantGidToNumber("gid://shopify/ProductVariant/"), null);
    assert.equal(variantGidToNumber("gid://shopify/ProductVariant/abc"), null);
  });

  it("resolves SKUs from Shopify with exact match and caches them", async () => {
    let now = 1_000;
    const { admin, calls } = fakeAdmin([
      { id: "gid://shopify/ProductVariant/11", sku: "GOVDE-960-2304-640-WOOD", price: "6425.00" },
      { id: "gid://shopify/ProductVariant/12", sku: "KAPAK-477-2237-WOOD", price: "1069.43" },
      { id: "gid://shopify/ProductVariant/13", sku: "RAF-960-640-WOOD", price: "573.28" },
      { id: "gid://shopify/ProductVariant/14", sku: "ASKI-960", price: "396.00" },
      // fuzzy search noise must be ignored
      { id: "gid://shopify/ProductVariant/99", sku: "ASKI-9600", price: "1.00" },
    ]);
    const resolver = createShopifySkuResolver(admin, "koshoy.myshopify.com", {
      cache: new Map(),
      now: () => now,
    });
    const pricer = createKoshoyPricer(cabinetEngine, resolver);
    const first = await pricer.quote(GOLDEN);
    assert.equal(first.display, "15.958,14 TL");
    assert.deepEqual(
      first.lines.map((line) => line.variantId),
      [11, 12, 13, 14],
    );
    assert.match(String(calls[0]?.query), /sku:"ASKI-960"/);

    await pricer.quote(GOLDEN);
    assert.equal(calls.length, 1, "second quote is served from cache");
    now += 6 * 60 * 1000;
    await pricer.quote(GOLDEN);
    assert.equal(calls.length, 2, "cache expires");
  });

  it("turns a failing Shopify lookup into [FİYAT] instead of throwing", async () => {
    const admin: KoshoyAdminGraphql = {
      async graphql() {
        return new Response(JSON.stringify({ errors: [{ message: "Throttled" }] }));
      },
    };
    const pricer = createKoshoyPricer(
      cabinetEngine,
      createShopifySkuResolver(admin, "koshoy.myshopify.com", { cache: new Map() }),
    );
    const quote = await pricer.quote(GOLDEN);
    assert.equal(quote.display, "[FİYAT]");
  });
});
