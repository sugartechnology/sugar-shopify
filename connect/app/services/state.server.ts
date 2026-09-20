import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "sugar_connect_state";

export function verifyConnectState(state: string | null): string {
  const secret = process.env.SHOPIFY_SERVICE_SECRET || "";
  if (!secret) {
    throw new Error("Shopify Connect is not configured");
  }
  if (!state || !state.includes(".")) {
    throw new Error("Connect state is invalid");
  }
  const separator = state.lastIndexOf(".");
  const payload = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Connect state is invalid");
  }
  return payload;
}

function cookieFlags(maxAge: number) {
  const secure = (process.env.SHOPIFY_APP_URL || "").startsWith("https://");
  // Embedded admin iframe üçüncü taraf isteği; Lax cookie gitmez.
  return `Path=/; HttpOnly; Max-Age=${maxAge}; SameSite=None${secure ? "; Secure" : ""}`;
}

export function stateCookie(state: string) {
  return `${COOKIE_NAME}=${encodeURIComponent(state)}; ${cookieFlags(900)}`;
}

export function clearStateCookie() {
  return `${COOKIE_NAME}=; ${cookieFlags(0)}`;
}

export function readStateCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) {
    return null;
  }
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
}
