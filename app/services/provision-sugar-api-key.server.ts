import { randomBytes } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { getShopConfig, saveShopConfigFields } from "./shop-config.server";
import type { ShopConfig } from "../types/sugar";

function generateShopApiKey(): string {
  return `sk_${randomBytes(24).toString("hex")}`;
}

export async function provisionSugarApiKey(
  admin: AdminApiContext["admin"],
  shopDomain: string,
): Promise<{ keyPrefix: string }> {
  const shopResponse = await admin.graphql(
    `#graphql
      query ShopIdForKey {
        shop {
          id
        }
      }
    `,
  );
  const shopJson = await shopResponse.json();
  const shopGid = shopJson.data?.shop?.id as string | undefined;

  const apiKey = generateShopApiKey();
  const baseUrl = (process.env.SUGAR_API_BASE_URL ?? "").replace(/\/$/, "");
  const serviceSecret = process.env.SHOPIFY_SERVICE_SECRET ?? "";

  if (!baseUrl || !serviceSecret) {
    throw new Error(
      "SUGAR_API_BASE_URL ve SHOPIFY_SERVICE_SECRET ortam değişkenleri gerekli",
    );
  }

  const response = await fetch(`${baseUrl}/api/shopify/credentials/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Secret": serviceSecret,
    },
    body: JSON.stringify({
      shopDomain,
      shopGid: shopGid ?? null,
      apiKey,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API key kaydı başarısız (${response.status}): ${text}`);
  }

  const result = (await response.json()) as { keyPrefix?: string };
  const existing = await getShopConfig(admin);
  const config: ShopConfig = {
    ...existing,
    sugarApiKey: apiKey,
    sugarApiKeyPrefix: result.keyPrefix ?? apiKey.slice(-4),
  };
  await saveShopConfigFields(admin, config, ["sugarApiKey", "sugarApiKeyPrefix"]);

  return { keyPrefix: config.sugarApiKeyPrefix };
}
