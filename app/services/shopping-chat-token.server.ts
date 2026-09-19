import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export interface ShoppingStreamClaims {
  sessionId: string;
  shop: string;
  exp: number;
}

function secret(): string {
  const value = (process.env.SHOPIFY_API_SECRET ?? "").trim();
  if (!value) {
    throw new Error("SHOPIFY_API_SECRET is not configured");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueShoppingStreamToken(
  sessionId: string,
  shop: string,
  now = Date.now(),
): string {
  const claims: ShoppingStreamClaims = {
    sessionId,
    shop,
    exp: now + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyShoppingStreamToken(
  token: string,
  now = Date.now(),
): ShoppingStreamClaims {
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) {
    throw new Error("Invalid stream token");
  }
  const body = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("Invalid stream token");
  }
  const claims = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as ShoppingStreamClaims;
  if (!claims.sessionId || !claims.shop || !claims.exp) {
    throw new Error("Invalid stream token");
  }
  if (claims.exp < now) {
    throw new Error("Stream token expired");
  }
  return claims;
}

export function readBearerToken(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}
