import { test } from "node:test";
import assert from "node:assert/strict";
import { getCabinetEngine } from "./engine";
import { auditCsv, auditSkus, requiredCatalogSkus, requiredTemplateSkus, type ShopVariant } from "./sku-audit.server";

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

test("requiredCatalogSkus covers every part × size × colour, not only the templates", () => {
  const engine = getCabinetEngine();
  const rows = requiredCatalogSkus(engine, ["lake-beyaz"], ["SİYAH"]);
  const skus = rows.map((row) => row.sku);
  assert.deepEqual(skus, [...new Set(skus)].sort((a, b) => a.localeCompare(b)));
  const count = (part: string) => rows.filter((row) => row.line.part === part).length;
  // 4 widths × 12 heights × 3 depths bodies; a shelf and a crown per width × depth.
  assert.equal(count("GOVDE"), 4 * 12 * 3);
  assert.equal(count("RAF"), 4 * 3);
  assert.equal(count("TAC"), 4 * 3);
  assert.equal(count("ASKI"), 4);
  assert.equal(count("KULP"), 1);
  // Both front series, and every template part is in it.
  assert.ok(rows.some((row) => row.line.part === "KAPAK" && row.line.series === "kapak-18"));
  const all = new Set(skus);
  for (const row of requiredTemplateSkus(engine, ["lake-beyaz"])) {
    if (row.line.part !== "KULP") assert.ok(all.has(row.sku), row.sku);
  }
});

test("auditSkus says why a part is not priced: colour, size, part or twins", () => {
  const engine = getCabinetEngine();
  const rows = requiredCatalogSkus(engine, ["lake-beyaz", "kumtasi"], []);
  const raf = rows.filter((row) => row.line.part === "RAF");
  const [white, cream] = ["lake-beyaz", "kumtasi"].map((color) => raf.filter((row) => row.line.color === color));
  // White shelves: all but one size sold; cream: none sold.
  const sold = white.slice(1).map((row, index) => variant(100 + index, row.sku));
  const audit = auditSkus([...white, ...cream], sold);
  const of = (sku: string) => audit.find((row) => row.sku === sku)?.problem;
  assert.equal(of(white[1].sku), "");
  assert.equal(of(white[0].sku), "size");
  assert.equal(of(cream[1].sku), "colour");
  assert.equal(of(cream[0].sku), "part");
  const csv = auditCsv(audit);
  assert.ok(csv.startsWith("beklenen ad,parça,ölçü (mm),renk,neden"));
  assert.equal(csv.trim().split("\n").length, 1 + 1 + cream.length);
});
