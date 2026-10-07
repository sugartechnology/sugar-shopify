import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  hashKoshoyToken,
  issueKoshoyToken,
  koshoySessionCookie,
  readKoshoyToken,
} from "./token.server";

describe("koshoy opaque token", () => {
  it("is 256-bit random base64url and only its sha256 is kept", () => {
    const { token, hash } = issueKoshoyToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(hash, createHash("sha256").update(token).digest("hex"));
    assert.equal(hashKoshoyToken(token), hash);
    assert.notEqual(issueKoshoyToken().token, token);
    // nothing decodable: not JSON, no shop name
    assert.throws(() => JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
  });

  it("reads the bearer header first, then the cookie, and rejects malformed values", () => {
    const { token } = issueKoshoyToken();
    const other = issueKoshoyToken().token;
    const both = new Request("https://x.test", {
      headers: { Authorization: `Bearer ${token}`, Cookie: `a=1; ks_sid=${other}` },
    });
    assert.equal(readKoshoyToken(both), token);
    const cookieOnly = new Request("https://x.test", { headers: { Cookie: `ks_sid=${other}` } });
    assert.equal(readKoshoyToken(cookieOnly), other);
    const bad = new Request("https://x.test", { headers: { Authorization: "Bearer eyJzaG9wIjoieCJ9.sig" } });
    assert.equal(readKoshoyToken(bad), "");
  });

  it("sets an HttpOnly, Secure, SameSite cookie scoped to the proxy path", () => {
    const header = koshoySessionCookie("abc", 60_000);
    assert.equal(header, "ks_sid=abc; Path=/apps/koshoy; Max-Age=60; HttpOnly; Secure; SameSite=Lax");
  });
});
