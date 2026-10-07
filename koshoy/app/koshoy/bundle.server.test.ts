import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bundleHandle, bundleSpec, bundleTitle, createKoshoyBundler, type BundleSpec } from "./bundle.server";
import { cabinetEngine, type CabinComposition } from "./engine";
import {
  createKoshoyPricer,
  createMockSkuResolver,
  type KoshoyAdminGraphql,
  type KoshoyQuote,
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
  color: "ivory",
};

function quoteOf(parts: Record<string, number>): KoshoyQuote {
  return {
    display: "1,00 TL",
    totalCents: 100,
    unresolved: [],
    lines: Object.entries(parts).map(([part, qty], index) => ({
      sku: part,
      part: part as KoshoyQuote["lines"][number]["part"],
      qty,
      variantId: index + 1,
      unitCents: 1,
    })),
  };
}

describe("bundle names (store content guide §4.1)", () => {
  const twoUnits = GOLDEN;
  const oneUnit: CabinComposition = { ...GOLDEN, units: [{ ...GOLDEN.units[0], widthMm: 480 }], color: "blue" };

  it("doors + drawers on a wardrobe: Çekmeceli prefix, door count", () => {
    assert.equal(
      bundleTitle("gardirop", twoUnits, quoteOf({ GOVDE: 2, KAPAK: 4, CEKMECE_ON: 4 })),
      "Çekmeceli Gardırop 192 cm, 4 Kapaklı – Kırık Beyaz",
    );
  });

  it("no doors: drawer count, open shelves", () => {
    assert.equal(
      bundleTitle("sifonyer", oneUnit, quoteOf({ GOVDE: 1, CEKMECE_ON: 1, RAF: 2 })),
      "Şifonyer 48 cm, 1 Çekmeceli Açık Raflı – Mavi",
    );
    assert.equal(bundleTitle("kitaplik", oneUnit, quoteOf({ GOVDE: 1, RAF: 4 })), "Kitaplık 48 cm, Açık Raflı – Mavi");
    assert.equal(
      bundleTitle("tv_unitesi", twoUnits, quoteOf({ GOVDE: 2, KAPAK: 2 })),
      "TV Ünitesi 192 cm, 2 Kapaklı – Kırık Beyaz",
    );
  });

  it("never names internal parts and stays within 70 characters", () => {
    const title = bundleTitle("gardirop", twoUnits, quoteOf({ GOVDE: 2, KAPAK: 4, CEKMECE_ON: 4, RAF: 6 }));
    assert.ok(title.length <= 70);
    assert.ok(!/Bakay|Acıbay|Sırgak|Tekçe|Tündük|Koshoy/.test(title));
  });
});

describe("bundle spec", () => {
  it("builds from the real quote: one component per part variant, Σ price", async () => {
    const quote = await createKoshoyPricer(cabinetEngine, createMockSkuResolver()).quote(GOLDEN);
    const spec = bundleSpec("gardirop", GOLDEN, quote);
    assert.ok(spec);
    assert.equal(spec.priceCents, quote.totalCents);
    assert.equal(spec.title, "Gardırop 192 cm, 2 Kapaklı – Kırık Beyaz");
    assert.equal(
      spec.components.reduce((sum, c) => sum + c.quantity, 0),
      quote.lines.reduce((sum, l) => sum + l.qty, 0),
    );
    // Same design + price → same handle; any change → a new bundle.
    assert.equal(bundleHandle(spec), bundleHandle({ ...spec, components: [...spec.components].reverse() }));
    assert.notEqual(bundleHandle(spec), bundleHandle({ ...spec, priceCents: spec.priceCents + 1 }));
    assert.match(bundleHandle(spec), /^koshoy-tasarim-[0-9a-f]{16}$/);
  });

  it("refuses unresolved quotes", () => {
    assert.equal(bundleSpec("gardirop", GOLDEN, { ...quoteOf({ GOVDE: 2 }), unresolved: ["x"] }), null);
    assert.equal(bundleSpec("gardirop", GOLDEN, { ...quoteOf({ GOVDE: 2 }), totalCents: null }), null);
  });
});

describe("bundler", () => {
  const spec: BundleSpec = {
    title: "Gardırop 96 cm, 2 Kapaklı – Ahşap",
    productType: "Gardırop",
    components: [
      { variantId: 11, quantity: 1 },
      { variantId: 12, quantity: 2 },
    ],
    priceCents: 1234550,
  };

  function fakeAdmin(existing: boolean) {
    const ops: string[] = [];
    const vars: Record<string, unknown>[] = [];
    const admin: KoshoyAdminGraphql = {
      async graphql(query, options) {
        const op = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? "?";
        ops.push(op);
        vars.push(options?.variables ?? {});
        const data: unknown = ({
          KoshoyBundleFind: {
            productByIdentifier: existing
              ? {
                  id: "gid://shopify/Product/9",
                  variants: { nodes: [{ id: "gid://shopify/ProductVariant/99", price: "12345.50", requiresComponents: true }] },
                }
              : null,
          },
          KoshoyBundleCreate: {
            productCreate: {
              product: { id: "gid://shopify/Product/9", variants: { nodes: [{ id: "gid://shopify/ProductVariant/99" }] } },
              userErrors: [],
            },
          },
          KoshoyBundlePrice: { productVariantsBulkUpdate: { userErrors: [] } },
          KoshoyBundleComponents: { productVariantRelationshipBulkUpdate: { userErrors: [] } },
          KoshoyPublications: {
            publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store" }] },
          },
          KoshoyBundlePublish: { publishablePublish: { userErrors: [] } },
        } as Record<string, unknown>)[op];
        return new Response(JSON.stringify({ data }));
      },
    };
    return { admin, ops, vars };
  }

  it("creates, prices, links components and publishes a new bundle", async () => {
    const { admin, ops, vars } = fakeAdmin(false);
    const id = await createKoshoyBundler(admin, "a.myshopify.com").ensure(spec);
    assert.equal(id, 99);
    assert.deepEqual(ops, [
      "KoshoyBundleFind",
      "KoshoyBundleCreate",
      "KoshoyBundlePrice",
      "KoshoyBundleComponents",
      "KoshoyPublications",
      "KoshoyBundlePublish",
    ]);
    const product = (vars[1] as { product: Record<string, unknown> }).product;
    assert.equal(product.title, spec.title);
    assert.equal(product.status, "UNLISTED");
    assert.equal(product.handle, bundleHandle(spec));
    assert.deepEqual((vars[2] as { variants: Array<{ price: string }> }).variants[0].price, "12345.50");
    const rel = (vars[3] as { input: Array<{ productVariantRelationshipsToCreate: unknown }> }).input[0];
    assert.deepEqual(rel.productVariantRelationshipsToCreate, [
      { id: "gid://shopify/ProductVariant/11", quantity: 1 },
      { id: "gid://shopify/ProductVariant/12", quantity: 2 },
    ]);
  });

  it("reuses a finished bundle, only re-publishing it", async () => {
    const { admin, ops } = fakeAdmin(true);
    assert.equal(await createKoshoyBundler(admin, "b.myshopify.com").ensure(spec), 99);
    assert.deepEqual(ops, ["KoshoyBundleFind", "KoshoyPublications", "KoshoyBundlePublish"]);
  });
});
