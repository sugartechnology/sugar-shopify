/**
 * Builds the Koshoy request context from an App Proxy request
 * (/apps/koshoy/studio/* on the storefront → /apps/koshoy/studio/* here).
 * The only Koshoy module that touches Shopify auth, Prisma and shop config.
 */
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { isLlmGatewayConfigured } from "../services/llm-gateway.server";
import { getShopApiKey } from "../services/shop-credentials.server";
import { getCabinetEngine } from "./engine";
import { createKoshoyBundler } from "./bundle.server";
import type { KoshoyRequestContext } from "./handlers.server";
import {
  createKoshoyPricer,
  createKoshoySkuResolver,
  isKoshoyPriceMock,
  type KoshoyAdminGraphql,
} from "./pricing.server";
import { createBusyLock, createRateLimiter, KOSHOY_LIMITS } from "./rate-limit.server";
import { createKoshoyStore, type KoshoyDb } from "./store.server";

const store = createKoshoyStore(prisma as unknown as KoshoyDb);
const limits = {
  turn: createRateLimiter(KOSHOY_LIMITS.turn),
  edit: createRateLimiter(KOSHOY_LIMITS.edit),
  cart: createRateLimiter(KOSHOY_LIMITS.cart),
  session: createRateLimiter(KOSHOY_LIMITS.session),
  client: createRateLimiter(KOSHOY_LIMITS.client),
  shop: createRateLimiter(KOSHOY_LIMITS.shop),
  shopSession: createRateLimiter(KOSHOY_LIMITS.shopSession),
};
const busy = createBusyLock();

function envFlag(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * KOSHOY_SHOPS (comma list of myshopify domains) enables the studio per shop.
 * Unset: enabled outside production only, so other merchants of this app
 * never get the endpoints by accident.
 */
export function isKoshoyEnabledForShop(shop: string): boolean {
  const list = (process.env.KOSHOY_SHOPS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (list.length) return list.includes(shop.toLowerCase());
  return process.env.NODE_ENV !== "production";
}

export async function koshoyContextFromProxy(
  request: Request,
): Promise<KoshoyRequestContext | null> {
  let shop = "";
  let admin: KoshoyAdminGraphql | undefined;
  try {
    const proxy = await authenticate.public.appProxy(request);
    shop = proxy.session?.shop ?? "";
    admin = proxy.admin;
  } catch (error) {
    console.error(
      "[koshoy] app proxy auth failed",
      error instanceof Response ? error.status : error,
    );
    return null;
  }
  if (!shop || !admin) return null;

  const shopAdmin = admin;
  const engine = getCabinetEngine();
  const resolver = createKoshoySkuResolver(shopAdmin, shop);

  return {
    shop,
    enabled: isKoshoyEnabledForShop(shop),
    store,
    engine,
    pricer: createKoshoyPricer(engine, resolver),
    // Mock prices must never become real products.
    bundler: isKoshoyPriceMock() ? undefined : createKoshoyBundler(shopAdmin, shop),
    limits,
    busy,
    async chatConfig() {
      if (envFlag("KOSHOY_CHAT_MOCK") || !isLlmGatewayConfigured()) {
        return { apiKey: "", mock: true };
      }
      // Local/dev override (never in production): skips the ShopCredential lookup.
      const devKey = (process.env.KOSHOY_DEV_SUGAR_API_KEY ?? "").trim();
      if (devKey && process.env.NODE_ENV !== "production") {
        return { apiKey: devKey, mock: false };
      }
      const apiKey = await getShopApiKey(shop);
      if (!apiKey) throw new Error("Shop API key is not configured");
      return { apiKey, mock: false };
    },
  };
}
