/**
 * Builds the Koshoy request context from an App Proxy request
 * (/apps/koshoy/studio/* on the storefront → /apps/koshoy/studio/* here).
 * The only Koshoy module that touches Shopify auth, Prisma and shop config.
 */
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { isLlmGatewayConfigured } from "../services/llm-gateway.server";
import { getShopApiKey } from "../services/shop-credentials.server";
import { createKoshoyS3 } from "../services/s3.server";
import { createTagService, downloadResultFile } from "../services/tag-service.server";
import { getCabinetEngine } from "./engine";
import { createKoshoyBundler } from "./bundle.server";
import type { KoshoyRequestContext } from "./handlers.server";
import {
  createKoshoyPricer,
  createKoshoySkuResolver,
  isKoshoyPriceMock,
  type KoshoyAdminGraphql,
} from "./pricing.server";
import type { KoshoyPhoneDeps, KoshoyPhoneLinkDb } from "./phone-link.server";
import { createBusyLock, createRateLimiter, KOSHOY_LIMITS } from "./rate-limit.server";
import type { KoshoyRoomDb, KoshoyRoomDeps } from "./room.server";
import type { KoshoyRoomSessionsDb } from "./room-sessions.server";
import { createKoshoyStore, type KoshoyDb } from "./store.server";
import { koshoyData } from "./data.server";
import { deviceFromUserAgent, recordKoshoyEvent, type KoshoyEventDb } from "./journey-events.server";

const store = createKoshoyStore(prisma as unknown as KoshoyDb);
const limits = {
  turn: createRateLimiter(KOSHOY_LIMITS.turn),
  edit: createRateLimiter(KOSHOY_LIMITS.edit),
  cart: createRateLimiter(KOSHOY_LIMITS.cart),
  session: createRateLimiter(KOSHOY_LIMITS.session),
  client: createRateLimiter(KOSHOY_LIMITS.client),
  shop: createRateLimiter(KOSHOY_LIMITS.shop),
  shopSession: createRateLimiter(KOSHOY_LIMITS.shopSession),
  room: createRateLimiter(KOSHOY_LIMITS.room),
  render: createRateLimiter(KOSHOY_LIMITS.render),
  roomClean: createRateLimiter(KOSHOY_LIMITS.roomClean),
  roomRead: createRateLimiter(KOSHOY_LIMITS.roomRead),
  layout: createRateLimiter(KOSHOY_LIMITS.layout),
  rooms: createRateLimiter(KOSHOY_LIMITS.rooms),
};
const phoneLimits: KoshoyPhoneDeps["limits"] = {
  create: createRateLimiter(KOSHOY_LIMITS.phoneLink),
  check: createRateLimiter(KOSHOY_LIMITS.phoneCheck),
};
const busy = createBusyLock();
const files = createKoshoyS3();

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

/**
 * Gateway key of the shop. KOSHOY_DEV_SUGAR_API_KEY is a local/dev override
 * (never in production) that skips the ShopCredential lookup.
 */
async function shopApiKey(shop: string): Promise<string> {
  const devKey = (process.env.KOSHOY_DEV_SUGAR_API_KEY ?? "").trim();
  if (devKey && process.env.NODE_ENV !== "production") return devKey;
  const apiKey = await getShopApiKey(shop);
  if (!apiKey) throw new Error("Shop API key is not configured");
  return apiKey;
}

/** Room photo + render services; unset until Sugar S3 and the gateway are configured. */
function roomDeps(shop: string): KoshoyRoomDeps | undefined {
  if (!files || !isLlmGatewayConfigured()) return undefined;
  return {
    db: prisma as unknown as KoshoyRoomDb,
    files,
    tagService: async () => createTagService(await shopApiKey(shop)),
    download: (url) => downloadResultFile(url),
  };
}

const STOREFRONT_CACHE_MS = 60 * 60 * 1000;
const storefronts = new Map<string, { origin: string; expiresAt: number }>();

/**
 * The shop's primary domain (e.g. https://koshoy.com) for the QR link, so the
 * phone shows the store's own address. Falls back to the myshopify domain,
 * which redirects there.
 */
async function storefrontOrigin(admin: KoshoyAdminGraphql, shop: string): Promise<string> {
  // Local/dev override (never in production): the devenv storefront, e.g. http://localhost:8080.
  const devUrl = (process.env.KOSHOY_DEV_STOREFRONT_URL ?? "").trim().replace(/\/+$/, "");
  if (devUrl && process.env.NODE_ENV !== "production") return devUrl;
  const hit = storefronts.get(shop);
  if (hit && hit.expiresAt > Date.now()) return hit.origin;
  try {
    const response = await admin.graphql(`{ shop { primaryDomain { url } } }`);
    const body = (await response.json()) as { data?: { shop?: { primaryDomain?: { url?: unknown } } } };
    const url = body.data?.shop?.primaryDomain?.url;
    if (typeof url === "string" && /^https:\/\/[a-z0-9.-]+$/i.test(url)) {
      storefronts.set(shop, { origin: url, expiresAt: Date.now() + STOREFRONT_CACHE_MS });
      return url;
    }
  } catch (error) {
    console.error("[koshoy] primary domain lookup failed", error);
  }
  return `https://${shop}`;
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
  // Shopify adds the signed-in customer to every App Proxy request (signed with the query).
  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id")?.trim() || null;
  const device = deviceFromUserAgent(request.headers.get("user-agent"));
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
    room: roomDeps(shop),
    phone: {
      db: prisma as unknown as KoshoyPhoneLinkDb,
      storefrontOrigin: () => storefrontOrigin(shopAdmin, shop),
      limits: phoneLimits,
    },
    journeyData: () => koshoyData().snapshot(),
    customerId,
    roomSessions: prisma as unknown as KoshoyRoomSessionsDb,
    track(sessionId, name, props) {
      void recordKoshoyEvent(prisma as unknown as KoshoyEventDb, { sessionId, name, device, props });
    },
    async chatConfig() {
      if (envFlag("KOSHOY_CHAT_MOCK") || !isLlmGatewayConfigured()) {
        return { apiKey: "", mock: true };
      }
      return { apiKey: await shopApiKey(shop), mock: false };
    },
  };
}
