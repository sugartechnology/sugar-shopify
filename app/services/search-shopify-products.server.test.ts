import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProductSearchQuery,
  filtersFromShopConfig,
  parseCollectionIds,
  priceToCents,
} from "./search-shopify-products.server";

describe("search query helpers", () => {
  it("parses collection ids from gids and numbers", () => {
    assert.deepEqual(
      parseCollectionIds("gid://shopify/Collection/12, 34, x"),
      ["12", "34"],
    );
  });

  it("builds merchant filters into the search query", () => {
    const filters = filtersFromShopConfig({
      shopAssistantCollectionIds: "12,34",
      shopAssistantInStockOnly: true,
      shopAssistantMinPrice: "100",
      shopAssistantMaxPrice: "500",
    });
    assert.equal(filters.minPriceCents, 10000);
    assert.equal(filters.maxPriceCents, 50000);
    assert.equal(
      buildProductSearchQuery("sofa", filters),
      "sofa available_for_sale:true (collection_id:12 OR collection_id:34)",
    );
  });

  it("converts major units to cents", () => {
    assert.equal(priceToCents("19.99"), 1999);
    assert.equal(priceToCents(10), 1000);
    assert.equal(priceToCents({ amount: "19.99" }), 1999);
  });
});
