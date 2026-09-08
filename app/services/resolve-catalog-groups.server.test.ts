import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_GROUPS_TTL_MS,
  catalogGroupsCacheKey,
} from "./resolve-catalog-groups.server";

describe("catalog groups cache", () => {
  it("uses a 2 minute TTL", () => {
    assert.equal(CATALOG_GROUPS_TTL_MS, 2 * 60 * 1000);
  });

  it("keys cache by shop and collection ids", () => {
    assert.equal(
      catalogGroupsCacheKey("decurateuruk.myshopify.com", [
        "gid://shopify/Collection/1",
        "gid://shopify/Collection/2",
      ]),
      "decurateuruk.myshopify.com|gid://shopify/Collection/1,gid://shopify/Collection/2",
    );
  });
});
