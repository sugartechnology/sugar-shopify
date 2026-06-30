import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  generateProductImage,
  isSugarApiMockMode,
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

  afterEach(() => {
    if (originalMock === undefined) {
      delete process.env.SUGAR_API_MOCK;
    } else {
      process.env.SUGAR_API_MOCK = originalMock;
    }
  });

  it("returns true when SUGAR_API_MOCK is not false", () => {
    process.env.SUGAR_API_MOCK = "true";
    const config: ShopConfig = {
      ...DEFAULT_SHOP_CONFIG,
      sugarApiBaseUrl: "https://api.example.com",
    };
    assert.equal(isSugarApiMockMode(config), true);
  });

  it("returns true when API base URL is empty even if mock env is false", () => {
    process.env.SUGAR_API_MOCK = "false";
    const config: ShopConfig = { ...DEFAULT_SHOP_CONFIG, sugarApiBaseUrl: "" };
    assert.equal(isSugarApiMockMode(config), true);
  });

  it("returns false when mock env is false and base URL is set", () => {
    process.env.SUGAR_API_MOCK = "false";
    const config: ShopConfig = {
      ...DEFAULT_SHOP_CONFIG,
      sugarApiBaseUrl: "https://api.example.com",
    };
    assert.equal(isSugarApiMockMode(config), false);
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
