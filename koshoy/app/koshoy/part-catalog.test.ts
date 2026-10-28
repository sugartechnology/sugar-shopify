import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { partKeyOfTitle, readPartCatalog, readPartTitle, type ShopVariant } from "./part-catalog";

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

describe("koshoy part catalog", () => {
  it("reads a part title as part, series, colour and size", () => {
    assert.deepEqual(readPartTitle("Bakay LAKE BEYAZ 960x2304x640 mm"), {
      part: "GOVDE", series: "", color: "LAKE BEYAZ", size: "960x2304x640", plinth: true,
    });
    assert.deepEqual(readPartTitle("Aruuke Çekmece KUMTAŞI 480x160x0 mm"), {
      part: "CEKMECE_ON", series: "kapak-18", color: "KUMTAŞI", size: "480x160x0", plinth: true,
    });
    assert.deepEqual(readPartTitle("Acıbay LAKE BEYAZ 477x2237x0 mm")?.series, "kapak-16");
    assert.deepEqual(readPartTitle("Gardırop Askısı 960"), {
      part: "ASKI", series: "", color: "", size: "960", plinth: true,
    });
    assert.equal(readPartTitle("Bakay LAKE BEYAZ 480x544x480 mm (bazasız)")?.plinth, false);
    assert.equal(readPartTitle("Test"), null);
    // The shop's handles (28 Oct): model name + size + colour.
    assert.deepEqual(readPartTitle("Serek Kulp 128 Siyah"), {
      part: "KULP", series: "", color: "SİYAH", size: "", plinth: true,
    });
    assert.equal(partKeyOfTitle("Serek Kulp 128 Beyaz"), partKeyOfTitle("Serek Kulp BEYAZ"));
  });

  it("gives the same key however the title is written", () => {
    const key = partKeyOfTitle("Bakay LAKE BEYAZ 960x2304x640 mm");
    for (const title of [
      "bakay lake beyaz 960x2304x640 mm",
      "LAKE BEYAZ Bakay 960 x 2304 x 640mm",
      "  Bakay   LAKE  BEYAZ 960x2304x640 ",
      "Bakay - LAKE BEYAZ - 960x2304x640 mm",
    ]) {
      assert.equal(partKeyOfTitle(title), key, title);
    }
    assert.notEqual(partKeyOfTitle("Bakay KUMTAŞI 960x2304x640 mm"), key, "colour matters");
    assert.notEqual(partKeyOfTitle("Bakay LAKE BEYAZ 960x2304x480 mm"), key, "size matters");
    assert.notEqual(partKeyOfTitle("Acıbay Çekmece LAKE BEYAZ 480x160x0 mm"), partKeyOfTitle("Acıbay LAKE BEYAZ 480x160x0 mm"));
    assert.notEqual(partKeyOfTitle("Gardırop Askısı 9600"), partKeyOfTitle("Gardırop Askısı 960"));
  });

  it("reads the colour from a variant option when the title has none", () => {
    const catalog = readPartCatalog([variant(1, "Tekçe 960x0x640 mm", { variantTitle: "KUMTAŞI" })]);
    assert.equal(catalog.byKey.get(partKeyOfTitle("Tekçe KUMTAŞI 960x0x640 mm") ?? "")?.variantId, "gid://shopify/ProductVariant/1");
  });

  it("keeps twins aside, skips draft and archived products, lists unknown titles", () => {
    const catalog = readPartCatalog([
      variant(1, "Tekçe LAKE BEYAZ 960x0x640 mm"),
      variant(2, "Tekçe LAKE BEYAZ 960x0x640 mm"),
      variant(3, "Tündük LAKE BEYAZ 960x25x640 mm", { productStatus: "DRAFT" }),
      variant(4, "Test", { productStatus: "UNLISTED" }),
    ]);
    assert.equal(catalog.byKey.size, 0);
    assert.equal(catalog.ambiguous.get(partKeyOfTitle("Tekçe LAKE BEYAZ 960x0x640 mm") ?? "")?.length, 2);
    assert.deepEqual(catalog.unread.map((item) => item.productTitle), ["Test"]);
  });
});
