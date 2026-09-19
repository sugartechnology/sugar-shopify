import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  issueShoppingStreamToken,
  verifyShoppingStreamToken,
} from "./shopping-chat-token.server";

describe("shopping stream token", () => {
  it("round-trips a valid token", () => {
    process.env.SHOPIFY_API_SECRET = "test-secret";
    const token = issueShoppingStreamToken("sid-1", "demo.myshopify.com", 1_000);
    const claims = verifyShoppingStreamToken(token, 2_000);
    assert.equal(claims.sessionId, "sid-1");
    assert.equal(claims.shop, "demo.myshopify.com");
  });

  it("rejects a tampered token", () => {
    process.env.SHOPIFY_API_SECRET = "test-secret";
    const token = issueShoppingStreamToken("sid-1", "demo.myshopify.com");
    assert.throws(() => verifyShoppingStreamToken(token + "x"));
  });
});
