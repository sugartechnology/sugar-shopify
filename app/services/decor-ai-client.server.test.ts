import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packShopifyPdpPipeline } from "./decor-ai-client.server";
import type { GenerateImageRequest } from "../types/sugar";

const request: GenerateImageRequest = {
  shopDomain: "test.myshopify.com",
  roomImageBase64: "dGVzdA==",
  roomImageName: "room.png",
  mockupImageBytes: Buffer.from("mock"),
  mockupImageName: "mockup.jpg",
  products: [
    {
      productId: "1",
      variantId: "2",
      title: "Chair",
      handle: "chair",
      price: "1000",
      currency: "TRY",
      imageUrl: "//cdn.shopify.com/chair.jpg",
      images: ["//cdn.shopify.com/chair.jpg", "//cdn.shopify.com/chair-2.jpg"],
      quantity: 2,
      description: "Oak chair",
      productDetails: [
        { namespace: "custom", key: "color", label: "Color", value: "oak" },
      ],
      position: { x: 0.2, y: 0.8, scale: 0.3 },
    },
  ],
};

describe("packShopifyPdpPipeline", () => {
  it("packs room, mockup, and product urls without downloading images", () => {
    const packed = packShopifyPdpPipeline(request, "shopify-job-1");

    assert.equal(packed.jobId, "shopify-job-1");
    assert.equal(packed.shopDomain, "test.myshopify.com");
    assert.equal(packed.input.jobId, "shopify-job-1");
    assert.equal(packed.input.platform, "GOOGLE");
    assert.equal(packed.input.prompt, "");
    assert.deepEqual(packed.input.roomImage, {
      contentBase64: "dGVzdA==",
      mimeType: "image/png",
      name: "room.png",
    });
    assert.equal(typeof packed.input.mockupImage, "object");
    if (packed.input.mockupImage) {
      assert.equal(packed.input.mockupImage.mimeType, "image/jpeg");
      assert.equal(packed.input.mockupImage.contentBase64, Buffer.from("mock").toString("base64"));
    }
    assert.equal(packed.input.products[0]?.imageUrl, "https://cdn.shopify.com/chair.jpg");
    assert.deepEqual(packed.input.products[0]?.images, [
      "https://cdn.shopify.com/chair.jpg",
      "https://cdn.shopify.com/chair-2.jpg",
    ]);
    assert.equal(packed.input.products[0]?.quantity, 2);
    assert.deepEqual(packed.input.products[0]?.position, { x: 0.2, y: 0.8, scale: 0.3 });
    assert.equal(packed.products[0]?.title, "Chair");
    assert.equal(packed.products[0]?.selectedByDefault, true);
  });
});
