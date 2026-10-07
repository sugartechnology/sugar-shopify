/**
 * Per-shop LLM gateway credentials (ShopCredential table).
 * A random key is generated on install, registered with the gateway
 * (`/api/shopify/credentials/register`, X-Service-Secret) and stored here.
 */
import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { getLlmGatewayUrl } from "./llm-gateway.server";

export interface ShopAdminGraphql {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

function generateShopApiKey(): string {
  return `sk_${randomBytes(24).toString("hex")}`;
}

export async function getShopApiKey(shop: string): Promise<string> {
  const row = await prisma.shopCredential.findUnique({ where: { shop } });
  return (row?.apiKey ?? "").trim();
}

export async function getShopCredentialInfo(
  shop: string,
): Promise<{ keyPrefix: string; createdAt: Date } | null> {
  const row = await prisma.shopCredential.findUnique({ where: { shop } });
  return row ? { keyPrefix: row.keyPrefix, createdAt: row.createdAt } : null;
}

export async function deleteShopCredential(shop: string): Promise<void> {
  await prisma.shopCredential.deleteMany({ where: { shop } });
}

async function readShopGid(admin: ShopAdminGraphql): Promise<string | null> {
  try {
    const response = await admin.graphql(`#graphql
      query ShopIdForKey { shop { id } }
    `);
    const json = (await response.json()) as { data?: { shop?: { id?: string } } };
    return json.data?.shop?.id ?? null;
  } catch {
    return null;
  }
}

/** Registers a new key with the gateway and stores it. */
export async function provisionShopApiKey(
  admin: ShopAdminGraphql,
  shopDomain: string,
): Promise<{ keyPrefix: string }> {
  const baseUrl = getLlmGatewayUrl();
  const serviceSecret = (process.env.SHOPIFY_SERVICE_SECRET ?? "").trim();
  if (!baseUrl || !serviceSecret) {
    throw new Error("LLM_GATEWAY_URL and SHOPIFY_SERVICE_SECRET are required");
  }

  const apiKey = generateShopApiKey();
  const shopGid = await readShopGid(admin);
  const response = await fetch(`${baseUrl}/api/shopify/credentials/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Secret": serviceSecret },
    body: JSON.stringify({ shopDomain, shopGid, apiKey }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API key registration failed (${response.status}): ${text}`);
  }
  const result = (await response.json().catch(() => ({}))) as { keyPrefix?: string };
  const keyPrefix = result.keyPrefix ?? apiKey.slice(-4);

  await prisma.shopCredential.upsert({
    where: { shop: shopDomain },
    create: { shop: shopDomain, apiKey, keyPrefix },
    update: { apiKey, keyPrefix },
  });
  return { keyPrefix };
}

/** afterAuth: provision once; failures are logged, never block the install. */
export async function ensureShopApiKey(admin: ShopAdminGraphql, shop: string): Promise<void> {
  if (await getShopApiKey(shop)) return;
  try {
    const { keyPrefix } = await provisionShopApiKey(admin, shop);
    console.log(`[koshoy] API key provisioned for ${shop} (…${keyPrefix})`);
  } catch (error) {
    console.error(`[koshoy] API key provisioning failed for ${shop}:`, error);
  }
}
