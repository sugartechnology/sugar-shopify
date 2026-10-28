import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCabinColor } from "./cabinet-core";
import { validateColors } from "./data.server";
import { getCabinetEngine, koshoyPartTitle } from "./engine";
import { readPartCatalog, type ShopVariant } from "./part-catalog";
import {
  bodyColorIds,
  colorIdInText,
  colorIdOf,
  DEFAULT_COLOR_LOOKS,
  handleColorIds,
  koshoyColors,
  shopColorOf,
  toKoshoyColors,
  useKoshoyColors,
} from "./shop-colors";
import { offeredShopColors, requiredTemplateSkus } from "./sku-audit.server";

const variant = (id: number, productTitle: string): ShopVariant => ({
  variantId: `gid://shopify/ProductVariant/${id}`,
  productTitle,
  productStatus: "ACTIVE",
  variantTitle: "Default Title",
  sku: "",
  price: "10.00",
  partField: "",
});

/** Every template part in the given shop colours, plus the given extra titles. */
function shopWith(colors: string[], extra: string[] = []): ShopVariant[] {
  const lines = requiredTemplateSkus(getCabinetEngine(), ["lake-beyaz"]).map((row) => ({ ...row.line, qty: 1 }));
  const titles = new Set(colors.flatMap((color) => lines.map((line) => koshoyPartTitle(line, color))));
  return [...titles, ...extra].map((title, index) => variant(index + 1, title));
}

describe("koshoy shop colours", () => {
  it("makes stable ids from shop colour names", () => {
    assert.equal(colorIdOf("LAKE BEYAZ"), "lake-beyaz");
    assert.equal(colorIdOf("KUMTAŞI"), "kumtasi");
    assert.equal(colorIdOf("SİYAH"), "siyah");
  });

  it("offers a body colour only when the shop sells every template part in it, handles only when sold", () => {
    const engine = getCabinetEngine();
    const complete = readPartCatalog(shopWith(["LAKE BEYAZ"], ["Kulp SİYAH 128 mm"]));
    const offered = offeredShopColors(engine, complete, DEFAULT_COLOR_LOOKS);
    assert.deepEqual([...offered.body], ["LAKE BEYAZ"]);
    assert.deepEqual([...offered.handles], ["SİYAH"]);

    const colors = toKoshoyColors(DEFAULT_COLOR_LOOKS, offered);
    assert.deepEqual(colors.body.map((color) => color.id), ["lake-beyaz"]);
    assert.deepEqual(colors.handles.map((color) => color.id), ["siyah"]);
    assert.deepEqual(colors.all.map((color) => color.id), ["lake-beyaz", "kumtasi", "siyah", "beyaz"], "every look stays known");
  });

  it("keeps every body look when the shop sells none completely, and no handles without a catalog", () => {
    const none = toKoshoyColors(DEFAULT_COLOR_LOOKS, { body: new Set(), handles: new Set() });
    assert.deepEqual(none.body.map((color) => color.id), ["lake-beyaz", "kumtasi"]);
    assert.deepEqual(toKoshoyColors(DEFAULT_COLOR_LOOKS).handles, []);
  });

  it("drives the core palette: old colours fall back to the default, titles carry the shop colour", () => {
    const before = koshoyColors();
    try {
      useKoshoyColors(toKoshoyColors(DEFAULT_COLOR_LOOKS, { body: new Set(["KUMTAŞI", "LAKE BEYAZ"]), handles: new Set() }));
      assert.deepEqual(bodyColorIds(), ["lake-beyaz", "kumtasi"]);
      assert.deepEqual(handleColorIds(), []);
      assert.equal(normalizeCabinColor("wood"), "lake-beyaz");
      assert.equal(shopColorOf("kumtasi"), "KUMTAŞI");
      assert.equal(colorIdInText("Kumtaşı olsun."), "kumtasi");
      assert.equal(colorIdInText("mor olsun"), undefined);
    } finally {
      useKoshoyColors(before);
    }
  });

  it("validates the colors document", () => {
    assert.ok(validateColors(DEFAULT_COLOR_LOOKS).ok);
    const bad = validateColors([
      { shopColor: "kumtaşı", label: "Kumtaşı", css: "#abc", use: "body" },
      { shopColor: "KUMTAŞI", label: "Kumtaşı", css: "#aabbcc", use: "body" },
    ]);
    assert.equal(bad.ok, false);
    assert.equal(bad.ok ? 0 : bad.errors.length, 2, "short css and the same colour twice");
    assert.equal(validateColors([{ shopColor: "SİYAH", label: "Siyah", css: "#222222", use: "handle" }]).ok, false, "needs a body colour");
  });
});
