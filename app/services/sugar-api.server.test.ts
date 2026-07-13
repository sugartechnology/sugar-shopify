import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  generateProductImage,
  getSugarApiBaseUrl,
  isSugarApiMockMode,
  normalizeCdnUrl,
  normalizeProductsForApi,
} from "./sugar-api.server";
import type { GenerateImageRequest, ShopConfig } from "../types/sugar";
import { DEFAULT_SHOP_CONFIG } from "../types/sugar";

const sampleRequest: GenerateImageRequest = {
  shopDomain: "test.myshopify.com",
  roomImageBase64: "dGVzdA==",
  roomImageName: "room.jpg",
  products: [
    {
      productId: "123",
      variantId: "456",
      title: "Test Ürün",
      handle: "test-urun",
      price: "19900",
      currency: "TRY",
      imageUrl: "https://cdn.shopify.com/product.jpg",
      images: ["https://cdn.shopify.com/product.jpg"],
      isPrimary: true,
    },
  ],
};

describe("isSugarApiMockMode", () => {
  const originalMock = process.env.SUGAR_API_MOCK;
  const originalBaseUrl = process.env.SUGAR_API_BASE_URL;

  afterEach(() => {
    if (originalMock === undefined) {
      delete process.env.SUGAR_API_MOCK;
    } else {
      process.env.SUGAR_API_MOCK = originalMock;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.SUGAR_API_BASE_URL;
    } else {
      process.env.SUGAR_API_BASE_URL = originalBaseUrl;
    }
  });

  it("returns true when SUGAR_API_MOCK is true", () => {
    process.env.SUGAR_API_MOCK = "true";
    process.env.SUGAR_API_BASE_URL = "https://api.example.com";
    const config: ShopConfig = {
      ...DEFAULT_SHOP_CONFIG,
      sugarApiKey: "secret-key",
    };
    assert.equal(isSugarApiMockMode(config), true);
  });

  it("returns true when API key is empty even if mock env is false", () => {
    process.env.SUGAR_API_MOCK = "false";
    process.env.SUGAR_API_BASE_URL = "https://api.example.com";
    const config: ShopConfig = { ...DEFAULT_SHOP_CONFIG, sugarApiKey: "" };
    assert.equal(isSugarApiMockMode(config), true);
  });

  it("returns true when SUGAR_API_BASE_URL is empty even if mock env is false", () => {
    process.env.SUGAR_API_MOCK = "false";
    delete process.env.SUGAR_API_BASE_URL;
    const config: ShopConfig = {
      ...DEFAULT_SHOP_CONFIG,
      sugarApiKey: "secret-key",
    };
    assert.equal(isSugarApiMockMode(config), true);
    assert.equal(getSugarApiBaseUrl(), "");
  });

  it("returns false when mock env is false, base URL and API key are set", () => {
    process.env.SUGAR_API_MOCK = "false";
    process.env.SUGAR_API_BASE_URL = "https://api.example.com";
    const config: ShopConfig = {
      ...DEFAULT_SHOP_CONFIG,
      sugarApiKey: "secret-key",
    };
    assert.equal(isSugarApiMockMode(config), false);
  });

  it("returns false when mock env is unset but base URL and API key are set", () => {
    delete process.env.SUGAR_API_MOCK;
    process.env.SUGAR_API_BASE_URL = "https://api.example.com";
    const config: ShopConfig = {
      ...DEFAULT_SHOP_CONFIG,
      sugarApiKey: "secret-key",
    };
    assert.equal(isSugarApiMockMode(config), false);
  });
});

describe("normalizeProductsForApi", () => {
  it("normalizes protocol-relative urls and keeps up to 3 images on one product row", () => {
    const rows = normalizeProductsForApi([
      {
        productId: "1",
        variantId: "2",
        title: "Klem Sofa",
        handle: "klem",
        price: "100",
        currency: "TRY",
        imageUrl: "//cdn.shopify.com/a.webp",
        images: [
          "//cdn.shopify.com/a.webp",
          "//cdn.shopify.com/b.webp",
          "//cdn.shopify.com/c.webp",
          "//cdn.shopify.com/d.webp",
        ],
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.imageUrl, "https://cdn.shopify.com/a.webp");
    assert.deepEqual(rows[0]?.images, [
      "https://cdn.shopify.com/a.webp",
      "https://cdn.shopify.com/b.webp",
      "https://cdn.shopify.com/c.webp",
    ]);
  });

  it("dedupes identical urls", () => {
    const rows = normalizeProductsForApi([
      {
        productId: "1",
        variantId: "2",
        title: "Test",
        handle: "test",
        price: "100",
        currency: "TRY",
        imageUrl: "https://cdn.shopify.com/same.jpg",
        images: ["https://cdn.shopify.com/same.jpg"],
      },
    ]);

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.images, ["https://cdn.shopify.com/same.jpg"]);
  });

  it("preserves quantity on each product row", () => {
    const rows = normalizeProductsForApi([
      {
        productId: "1",
        variantId: "2",
        title: "Test",
        handle: "test",
        price: "100",
        currency: "TRY",
        imageUrl: "https://cdn.shopify.com/a.jpg",
        images: ["https://cdn.shopify.com/a.jpg"],
        quantity: 4,
        productDetails: [
          {
            namespace: "sugar",
            key: "quantity",
            label: "Adet",
            value: "4",
          },
        ],
      },
    ]);

    assert.equal(rows[0]?.quantity, 4);
    assert.equal(rows[0]?.productDetails?.[0]?.value, "4");
  });
});

describe("normalizeCdnUrl", () => {
  it("adds https to protocol-relative shopify cdn urls", () => {
    assert.equal(
      normalizeCdnUrl("//cdn.shopify.com/x.jpg"),
      "https://cdn.shopify.com/x.jpg",
    );
  });
});

describe("generateProductImage (mock)", () => {
  beforeEach(() => {
    process.env.SUGAR_API_MOCK = "true";
  });

  it("returns completed mock response with room image echo", async () => {
    const result = await generateProductImage(DEFAULT_SHOP_CONFIG, sampleRequest);

    assert.equal(result.status, "completed");
    assert.match(result.generationId, /^mock-/);
    assert.equal(result.imageUrl, "data:image/jpeg;base64,dGVzdA==");
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0]?.title, "Test Ürün");
    assert.equal(result.products[0]?.selectedByDefault, true);
  });

  it("includes demo message in mock response", async () => {
    const result = await generateProductImage(DEFAULT_SHOP_CONFIG, sampleRequest);
    assert.match(result.message ?? "", /Demo mod/);
  });
});
