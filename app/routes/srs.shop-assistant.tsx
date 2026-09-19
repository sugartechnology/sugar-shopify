import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getShopConfig, saveShopConfigFields } from "../services/shop-config.server";
import type { ShopConfig } from "../types/sugar";

const ASSISTANT_KEYS = [
  "shopAssistantEnabled",
  "shopAssistantCollectionIds",
  "shopAssistantInStockOnly",
  "shopAssistantMinPrice",
  "shopAssistantMaxPrice",
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const config = await getShopConfig(admin);
  return json({
    shopAssistantEnabled: config.shopAssistantEnabled,
    shopAssistantCollectionIds: config.shopAssistantCollectionIds,
    shopAssistantInStockOnly: config.shopAssistantInStockOnly,
    shopAssistantMinPrice: config.shopAssistantMinPrice,
    shopAssistantMaxPrice: config.shopAssistantMaxPrice,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const existing = await getShopConfig(admin);
  const formData = await request.formData();
  const config: ShopConfig = {
    ...existing,
    shopAssistantEnabled: formData.get("shopAssistantEnabled") === "on",
    shopAssistantCollectionIds: String(
      formData.get("shopAssistantCollectionIds") ?? "",
    ),
    shopAssistantInStockOnly: formData.get("shopAssistantInStockOnly") === "on",
    shopAssistantMinPrice: String(formData.get("shopAssistantMinPrice") ?? ""),
    shopAssistantMaxPrice: String(formData.get("shopAssistantMaxPrice") ?? ""),
  };
  try {
    await saveShopConfigFields(admin, config, [...ASSISTANT_KEYS]);
    return json({ success: true, error: null, config });
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Kayıt başarısız",
      config,
    });
  }
};

export default function ShopAssistantSettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [form, setForm] = useState({
    shopAssistantEnabled:
      actionData?.config?.shopAssistantEnabled ?? loaderData.shopAssistantEnabled,
    shopAssistantCollectionIds:
      actionData?.config?.shopAssistantCollectionIds ??
      loaderData.shopAssistantCollectionIds,
    shopAssistantInStockOnly:
      actionData?.config?.shopAssistantInStockOnly ??
      loaderData.shopAssistantInStockOnly,
    shopAssistantMinPrice:
      actionData?.config?.shopAssistantMinPrice ?? loaderData.shopAssistantMinPrice,
    shopAssistantMaxPrice:
      actionData?.config?.shopAssistantMaxPrice ?? loaderData.shopAssistantMaxPrice,
  });

  return (
    <Page>
      <TitleBar title="Shop Assistant" />
      <Layout>
        <Layout.Section>
          {actionData?.success ? (
            <Banner tone="success" title="Ayarlar kaydedildi" />
          ) : null}
          {actionData?.error ? (
            <Banner tone="critical" title={actionData.error} />
          ) : null}
          <Form method="post">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Alışveriş asistanı
                </Text>
                <Text as="p" variant="bodyMd">
                  Storefront App embed üzerinden sohbet eder. Katalog tüm
                  ürünlerdir; aşağıdaki filtreler her aramada uygulanır.
                </Text>
                <FormLayout>
                  <Checkbox
                    label="Asistanı aç"
                    checked={form.shopAssistantEnabled}
                    onChange={(checked) =>
                      setForm((prev) => ({ ...prev, shopAssistantEnabled: checked }))
                    }
                  />
                  <input
                    type="hidden"
                    name="shopAssistantEnabled"
                    value={form.shopAssistantEnabled ? "on" : ""}
                  />
                  <Checkbox
                    label="Yalnızca stokta olanlar"
                    checked={form.shopAssistantInStockOnly}
                    onChange={(checked) =>
                      setForm((prev) => ({
                        ...prev,
                        shopAssistantInStockOnly: checked,
                      }))
                    }
                  />
                  <input
                    type="hidden"
                    name="shopAssistantInStockOnly"
                    value={form.shopAssistantInStockOnly ? "on" : ""}
                  />
                  <TextField
                    label="Collection ID allowlist"
                    name="shopAssistantCollectionIds"
                    value={form.shopAssistantCollectionIds}
                    onChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        shopAssistantCollectionIds: value,
                      }))
                    }
                    autoComplete="off"
                    helpText="Boş = tüm katalog. Virgülle numeric collection id veya GID."
                  />
                  <TextField
                    label="Minimum fiyat"
                    name="shopAssistantMinPrice"
                    value={form.shopAssistantMinPrice}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, shopAssistantMinPrice: value }))
                    }
                    autoComplete="off"
                    helpText="Mağaza para biriminde. Boş = alt limit yok."
                  />
                  <TextField
                    label="Maksimum fiyat"
                    name="shopAssistantMaxPrice"
                    value={form.shopAssistantMaxPrice}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, shopAssistantMaxPrice: value }))
                    }
                    autoComplete="off"
                    helpText="Mağaza para biriminde. Boş = üst limit yok."
                  />
                </FormLayout>
                <Button submit variant="primary">
                  Kaydet
                </Button>
              </BlockStack>
            </Card>
          </Form>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
