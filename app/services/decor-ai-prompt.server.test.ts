import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlaceProductsPrompt, toOutputProducts } from "./decor-ai-prompt.server";
import type { DesignProductInput } from "../types/sugar";

const chair: DesignProductInput = {
  productId: "1",
  variantId: "2",
  title: "Chair",
  handle: "chair",
  price: "1000",
  currency: "TRY",
  imageUrl: "https://cdn.example/chair.jpg",
  images: ["https://cdn.example/chair.jpg"],
  quantity: 2,
  productDetails: [{ namespace: "custom", key: "color", label: "Color", value: "oak" }],
  position: { x: 0.2, y: 0.8, scale: 0.3 },
};

describe("buildPlaceProductsPrompt", () => {
  it("labels room, mockup, and product cutouts", () => {
    const prompt = buildPlaceProductsPrompt([chair], {
      hasMockup: true,
      loadedImageCounts: [1],
    });
    assert.match(prompt, /Image 1: ROOM/);
    assert.match(prompt, /Image 2: MOCKUP/);
    assert.match(prompt, /Image 3: PRODUCT CUTOUT — Item 1 "Chair"/);
    assert.match(prompt, /Qty=2/);
    assert.match(prompt, /Color=oak/);
    assert.match(prompt, /center at x=0.200/);
    assert.match(prompt, /render exactly 2 identical units/);
  });

  it("notes missing mockup", () => {
    const prompt = buildPlaceProductsPrompt([chair], {
      hasMockup: false,
      loadedImageCounts: [0],
    });
    assert.match(prompt, /No MOCKUP image/);
    assert.doesNotMatch(prompt, /Image 2: MOCKUP/);
  });
});

describe("toOutputProducts", () => {
  it("maps shopify products to generate output rows", () => {
    const [row] = toOutputProducts([chair]);
    assert.equal(row.productId, "1");
    assert.equal(row.variantId, "2");
    assert.equal(row.selectedByDefault, true);
    assert.equal(row.imageUrl, "https://cdn.example/chair.jpg");
  });
});
