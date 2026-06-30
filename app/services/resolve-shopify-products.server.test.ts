import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectVariantImageUrls,
  gidToNumericId,
  toVariantGid,
} from "./resolve-shopify-products.server";

describe("toVariantGid", () => {
  it("wraps numeric variant id in Shopify GID", () => {
    assert.equal(
      toVariantGid("47101481681155"),
      "gid://shopify/ProductVariant/47101481681155",
    );
  });

  it("leaves existing GID unchanged", () => {
    const gid = "gid://shopify/ProductVariant/47101481681155";
    assert.equal(toVariantGid(gid), gid);
  });
});

describe("gidToNumericId", () => {
  it("extracts trailing numeric id", () => {
    assert.equal(
      gidToNumericId("gid://shopify/ProductVariant/47101481681155"),
      "47101481681155",
    );
  });
});

describe("collectVariantImageUrls", () => {
  it("prefers media nodes and caps at MAX_PRODUCT_IMAGES", () => {
    const urls = collectVariantImageUrls({
      media: {
        nodes: [
          { image: { url: "//cdn.shopify.com/a.jpg" } },
          { image: { url: "//cdn.shopify.com/b.jpg" } },
          { image: { url: "//cdn.shopify.com/c.jpg" } },
          { image: { url: "//cdn.shopify.com/d.jpg" } },
        ],
      },
      image: { url: "//cdn.shopify.com/fallback.jpg" },
    });

    assert.equal(urls.length, 3);
    assert.equal(urls[0], "//cdn.shopify.com/a.jpg");
    assert.equal(urls[2], "//cdn.shopify.com/c.jpg");
  });

  it("falls back to variant.image when media is empty", () => {
    const urls = collectVariantImageUrls({
      image: { url: "https://cdn.shopify.com/only.jpg" },
    });
    assert.deepEqual(urls, ["https://cdn.shopify.com/only.jpg"]);
  });
});
