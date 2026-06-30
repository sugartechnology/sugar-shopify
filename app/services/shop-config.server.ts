import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import {
  DEFAULT_SHOP_CONFIG,
  SHOP_CONFIG_NAMESPACE,
  THEME_PRESET_CLASSES,
  type ShopConfig,
  type ThemePreset,
} from "../types/sugar";

const METAFIELD_KEYS = Object.keys(DEFAULT_SHOP_CONFIG) as (keyof ShopConfig)[];
/** Shopify metafieldsSet mutation limit per request */
const METAFIELDS_BATCH_SIZE = 25;

function parseMetafieldValue(key: keyof ShopConfig, value: string): unknown {
  if (key === "skipProductSelection") {
    return value === "true";
  }
  if (key === "modalRadius" || key === "fontScale") {
    const parsed = Number(value);
    const fallback =
      key === "modalRadius"
        ? DEFAULT_SHOP_CONFIG.modalRadius
        : DEFAULT_SHOP_CONFIG.fontScale;
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (key === "maxUploadSizeMb" || key === "maxAdditionalProducts") {
    const parsed = Number(value);
    const fallback =
      key === "maxUploadSizeMb"
        ? DEFAULT_SHOP_CONFIG.maxUploadSizeMb
        : DEFAULT_SHOP_CONFIG.maxAdditionalProducts;
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return value;
}

export async function getShopConfig(
  admin: AdminApiContext["admin"],
): Promise<ShopConfig> {
  // sugarApiKey vb. Shopify shop metafield'da (namespace: sugar_shopify)
  // SQLite Session tablosunda DEĞİL
  const response = await admin.graphql(
    `#graphql
      query ShopSugarConfig($namespace: String!) {
        shop {
          metafields(namespace: $namespace, first: 50) {
            nodes {
              key
              value
            }
          }
        }
      }
    `,
    { variables: { namespace: SHOP_CONFIG_NAMESPACE } },
  );

  const json = await response.json();
  const nodes = json.data?.shop?.metafields?.nodes ?? [];
  const config: ShopConfig = { ...DEFAULT_SHOP_CONFIG };

  for (const node of nodes) {
    const key = node.key as keyof ShopConfig;
    if (!METAFIELD_KEYS.includes(key)) continue;
    (config as Record<string, unknown>)[key] = parseMetafieldValue(
      key,
      node.value ?? "",
    );
  }

  return config;
}

async function getShopId(admin: AdminApiContext["admin"]): Promise<string> {
  const shopResponse = await admin.graphql(
    `#graphql
      query ShopId {
        shop {
          id
        }
      }
    `,
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data?.shop?.id as string | undefined;
  if (!shopId) {
    throw new Error("Shop ID not found");
  }
  return shopId;
}

async function setShopMetafields(
  admin: AdminApiContext["admin"],
  shopId: string,
  fields: Array<{ key: keyof ShopConfig; value: string }>,
): Promise<void> {
  for (let offset = 0; offset < fields.length; offset += METAFIELDS_BATCH_SIZE) {
    const batch = fields.slice(offset, offset + METAFIELDS_BATCH_SIZE);
    const response = await admin.graphql(
      `#graphql
        mutation SaveShopSugarConfig($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          metafields: batch.map(({ key, value }) => ({
            namespace: SHOP_CONFIG_NAMESPACE,
            key,
            type: "single_line_text_field",
            value,
            ownerId: shopId,
          })),
        },
      },
    );

    const result = await response.json();
    const errors = result.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
    }
  }
}

export async function saveShopConfigFields(
  admin: AdminApiContext["admin"],
  config: ShopConfig,
  keys: (keyof ShopConfig)[],
): Promise<void> {
  const shopId = await getShopId(admin);
  const fields = keys.map((key) => ({
    key,
    value: String(config[key] ?? ""),
  }));
  await setShopMetafields(admin, shopId, fields);
}

export async function saveShopConfig(
  admin: AdminApiContext["admin"],
  config: ShopConfig,
): Promise<void> {
  const shopId = await getShopId(admin);
  const fields = METAFIELD_KEYS.map((key) => ({
    key,
    value: String(config[key] ?? ""),
  }));
  await setShopMetafields(admin, shopId, fields);
}

export function resolveThemeClasses(
  config: ShopConfig,
  blockOverrides: Partial<ShopConfig> = {},
): Pick<
  ShopConfig,
  | "aiButtonClasses"
  | "secondaryButtonClasses"
  | "primaryButtonClasses"
  | "modalPanelClasses"
  | "formFieldClasses"
> {
  const preset = (blockOverrides.themePreset ??
    config.themePreset) as ThemePreset;

  if (preset !== "custom" && THEME_PRESET_CLASSES[preset]) {
    return {
      ...THEME_PRESET_CLASSES[preset],
      ...blockOverrides,
    };
  }

  return {
    aiButtonClasses:
      blockOverrides.aiButtonClasses || config.aiButtonClasses,
    primaryButtonClasses:
      blockOverrides.primaryButtonClasses || config.primaryButtonClasses,
    secondaryButtonClasses:
      blockOverrides.secondaryButtonClasses || config.secondaryButtonClasses,
    modalPanelClasses:
      blockOverrides.modalPanelClasses || config.modalPanelClasses,
    formFieldClasses:
      blockOverrides.formFieldClasses || config.formFieldClasses,
  };
}

export function getPublicShopConfig(config: ShopConfig) {
  return {
    buttonLabel: config.buttonLabel,
    modalTitle: config.modalTitle,
    modalDescription: config.modalDescription,
    imagePropertyKey: config.imagePropertyKey,
    maxUploadSizeMb: config.maxUploadSizeMb,
    customCss: config.customCss,
  };
}
