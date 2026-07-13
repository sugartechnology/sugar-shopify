import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendQuantityToProductDetails,
  collectVariantImageUrls,
  gidToNumericId,
  keyMatchesHint,
  resolveProductDetails,
  toVariantGid,
} from "./resolve-shopify-products.server";

describe("appendQuantityToProductDetails", () => {
  it("adds quantity to productDetails for the AI prompt", () => {
    const enriched = appendQuantityToProductDetails({
      productId: "1",
      variantId: "2",
      title: "Klem Sofa",
      handle: "klem",
      price: "100",
      currency: "TRY",
      images: [],
      quantity: 3,
      productDetails: [
        { namespace: "custom", key: "renk", label: "Renk", value: "Antrasit" },
      ],
    });

    assert.equal(enriched.quantity, 3);
    assert.equal(enriched.productDetails?.[0]?.label, "Adet");
    assert.equal(enriched.productDetails?.[0]?.value, "3");
    assert.ok(
      enriched.productDetails?.some(
        (detail) => detail.key === "renk" && detail.value === "Antrasit",
      ),
    );
  });

  it("defaults missing quantity to 1", () => {
    const enriched = appendQuantityToProductDetails({
      productId: "1",
      variantId: "2",
      title: "Klem Sofa",
      handle: "klem",
      price: "100",
      currency: "TRY",
      images: [],
    });

    assert.equal(enriched.quantity, 1);
    assert.equal(enriched.productDetails?.[0]?.value, "1");
  });

  it("replaces an existing sugar quantity detail", () => {
    const enriched = appendQuantityToProductDetails({
      productId: "1",
      variantId: "2",
      title: "Klem Sofa",
      handle: "klem",
      price: "100",
      currency: "TRY",
      images: [],
      quantity: 5,
      productDetails: [
        {
          namespace: "sugar",
          key: "quantity",
          label: "Adet",
          value: "2",
        },
      ],
    });

    assert.equal(enriched.quantity, 5);
    assert.equal(
      enriched.productDetails?.filter((detail) => detail.key === "quantity")
        .length,
      1,
    );
    assert.equal(enriched.productDetails?.[0]?.value, "5");
  });
});

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

describe("keyMatchesHint", () => {
  it("matches localized and underscored keys", () => {
    assert.equal(keyMatchesHint("product_renk", ["renk", "color"]), true);
    assert.equal(keyMatchesHint("dimensions_cm", ["dimension", "ölçü"]), true);
    assert.equal(keyMatchesHint("related_products", ["color"]), false);
  });
});

describe("resolveProductDetails", () => {
  const variant = {
    product: {
      metafields: {
        nodes: [
          { namespace: "custom", key: "renk", value: "Antrasit" },
          { namespace: "custom", key: "boyut", value: "220x90 cm" },
          { namespace: "custom", key: "sku_internal", value: "ABC-1" },
          { namespace: "other", key: "color", value: "Ignored" },
        ],
      },
    },
  };

  it("uses explicit refs first and fills remaining hints", () => {
    const details = resolveProductDetails(variant, [
      { namespace: "custom", key: "material", label: "Malzeme" },
      { namespace: "custom", key: "renk", label: "Renk" },
    ]);

    assert.ok(details.some((detail) => detail.key === "renk" && detail.label === "Renk"));
    assert.ok(details.some((detail) => detail.key === "boyut"));
    assert.equal(details.some((detail) => detail.key === "material"), false);
  });

  it("falls back to hint discovery when explicit keys are missing", () => {
    const details = resolveProductDetails(
      variant,
      [{ namespace: "custom", key: "color", label: "Renk" }],
      "custom",
    );

    assert.ok(details.some((detail) => detail.key === "renk"));
    assert.ok(details.some((detail) => detail.key === "boyut"));
    assert.equal(details.some((detail) => detail.key === "sku_internal"), false);
  });

  it("discovers by hint when explicit config is empty", () => {
    const details = resolveProductDetails(variant, [], "custom");
    assert.ok(details.length >= 2);
    assert.equal(details.some((detail) => detail.key === "renk"), true);
  });
});
