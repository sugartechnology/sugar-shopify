import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRateLimiter, hitAll, koshoyClientKey } from "./rate-limit.server";

const SHOP = "koshoy.myshopify.com";

function request(forwardedFor?: string): Request {
  const headers: Record<string, string> = {};
  if (forwardedFor !== undefined) headers["X-Forwarded-For"] = forwardedFor;
  return new Request("https://app.test/apps/koshoy/studio/session", { method: "POST", headers });
}

describe("koshoy rate limits", () => {
  it("reads the visitor address from the right of X-Forwarded-For", () => {
    assert.equal(koshoyClientKey(SHOP, request("198.51.100.7, 23.227.38.1")), `${SHOP}|198.51.100.7`);
    assert.equal(koshoyClientKey(SHOP, request("1.1.1.1, 198.51.100.7, 23.227.38.1")), `${SHOP}|198.51.100.7`);
    assert.equal(koshoyClientKey(SHOP, request("198.51.100.7")), `${SHOP}|198.51.100.7`);
    // One more trusted ingress in front of the app.
    assert.equal(
      koshoyClientKey(SHOP, request("1.1.1.1, 198.51.100.7, 23.227.38.1, 10.0.0.2"), 2),
      `${SHOP}|198.51.100.7`,
    );
    assert.equal(koshoyClientKey(SHOP, request()), `${SHOP}|unknown`);
  });

  it("spends no budget and adds no key for a refused request", () => {
    const shop = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const visitor = createRateLimiter({ limit: 1, windowMs: 60_000 });
    assert.equal(hitAll([[shop, "s"], [visitor, "a"]], 0), true);
    // Visitor over its budget: the shop budget is left alone.
    assert.equal(hitAll([[shop, "s"], [visitor, "a"]], 1), false);
    assert.equal(hitAll([[shop, "s"], [visitor, "b"]], 2), true);
    // Shop budget spent: a new visitor key is not recorded.
    assert.equal(hitAll([[shop, "s"], [visitor, "c"]], 3), false);
    assert.equal(visitor.allows("c", 3), true);
    assert.equal(shop.allows("s", 60_001), true, "window slides");
  });
});
