import { test } from "node:test";
import assert from "node:assert/strict";
import { getCabinetEngine } from "./engine";
import { auditSkus, requiredTemplateSkus, type ShopVariant } from "./sku-audit.server";

test("requiredTemplateSkus covers every template part, unique and sorted", () => {
  const rows = requiredTemplateSkus(getCabinetEngine());
  assert.ok(rows.length > 0);
  const skus = rows.map((row) => row.sku);
  assert.deepEqual(skus, [...new Set(skus)].sort((a, b) => a.localeCompare(b)));
  assert.ok(rows.every((row) => row.usedBy.length > 0));
  assert.ok(rows.some((row) => row.line.part === "GOVDE"));
});

const variant = (id: number, productTitle: string, extra: Partial<ShopVariant> = {}): ShopVariant => ({
  variantId: `gid://shopify/ProductVariant/${id}`,
  productTitle,
  productStatus: "ACTIVE",
  variantTitle: "Default Title",
  sku: "",
  price: "10.00",
  partField: "",
  ...extra,
});

test("auditSkus matches by structure, marks missing parts and lists two candidates", () => {
  const [first, second, third] = requiredTemplateSkus(getCabinetEngine());
  const audit = auditSkus([first, second, third], [
    variant(1, first.sku.toLocaleUpperCase("tr-TR").replace(/ /g, "  ")),
    variant(2, third.sku),
    variant(3, third.sku),
  ]);
  assert.equal(audit[0].found?.variantId, "gid://shopify/ProductVariant/1");
  assert.equal(audit[1].found, null);
  assert.deepEqual(audit[1].candidates, []);
  assert.equal(audit[2].found, null, "two products for one part: no guess");
  assert.equal(audit[2].candidates.length, 2);
});

test("auditSkus reads the koshoy.parca metafield before the title", () => {
  const [first] = requiredTemplateSkus(getCabinetEngine());
  const audit = auditSkus([first], [variant(1, "Ürün 123", { partField: first.sku })]);
  assert.equal(audit[0].found?.variantId, "gid://shopify/ProductVariant/1");
});
