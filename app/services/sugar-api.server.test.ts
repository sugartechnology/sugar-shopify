import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  generateProductImage,
  getSugarApiBaseUrl,
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
