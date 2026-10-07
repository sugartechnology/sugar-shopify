/**
 * Opaque session tokens: 256-bit random, base64url. Only the sha256 hash is
 * stored; the browser never gets anything it could decode.
 */
import { createHash, randomBytes } from "node:crypto";

const COOKIE_NAME = "ks_sid";
const COOKIE_PATH = "/apps/koshoy";
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const KOSHOY_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A session nobody has used yet (page view only) expires much sooner. */
export const KOSHOY_FRESH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function issueKoshoyToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashKoshoyToken(token) };
}

export function hashKoshoyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedKoshoyToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Short random id for designs and internal rows (96-bit, base64url). */
export function randomOpaqueId(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function cookie(request: Request): string {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey?.trim() === COOKIE_NAME) {
      try {
        return decodeURIComponent(rest.join("=").trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

/** Bearer first (App Proxy strips cookies), cookie as fallback. */
export function readKoshoyToken(request: Request): string {
  const token = bearer(request) || cookie(request);
  return isWellFormedKoshoyToken(token) ? token : "";
}

export function koshoySessionCookie(
  token: string,
  maxAgeMs = KOSHOY_SESSION_TTL_MS,
): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=${COOKIE_PATH}; Max-Age=${Math.floor(
    maxAgeMs / 1000,
  )}; HttpOnly; Secure; SameSite=Lax`;
}
