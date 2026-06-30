import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/node";
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
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getShopConfig, saveShopConfig } from "../services/shop-config.server";
import { isSugarApiMockMode } from "../services/sugar-api.server";
import type { ShopConfig, ThemePreset } from "../types/sugar";
import { DEFAULT_SHOP_CONFIG } from "../types/sugar";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const config = await getShopConfig(admin);
  return json({
    config,
    apiMockMode: isSugarApiMockMode(config),
    sugarApiMockEnv: process.env.SUGAR_API_MOCK !== "false",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const config: ShopConfig = {
    sugarApiBaseUrl: String(formData.get("sugarApiBaseUrl") ?? ""),
    sugarCompanyId: String(formData.get("sugarCompanyId") ?? ""),
    sugarApiKey: String(formData.get("sugarApiKey") ?? ""),
    buttonLabel: String(formData.get("buttonLabel") ?? DEFAULT_SHOP_CONFIG.buttonLabel),
    buttonHelperText: String(formData.get("buttonHelperText") ?? DEFAULT_SHOP_CONFIG.buttonHelperText),
    modalTitle: String(formData.get("modalTitle") ?? DEFAULT_SHOP_CONFIG.modalTitle),
    modalSubtitle: String(formData.get("modalSubtitle") ?? DEFAULT_SHOP_CONFIG.modalSubtitle),
    modalDescription: String(formData.get("modalDescription") ?? DEFAULT_SHOP_CONFIG.modalDescription),
    instructionTemplate: String(formData.get("instructionTemplate") ?? DEFAULT_SHOP_CONFIG.instructionTemplate),
    addDesignToCartLabel: String(formData.get("addDesignToCartLabel") ?? DEFAULT_SHOP_CONFIG.addDesignToCartLabel),
    loadingTitle: String(formData.get("loadingTitle") ?? DEFAULT_SHOP_CONFIG.loadingTitle),
    loadingSubtitle: String(formData.get("loadingSubtitle") ?? DEFAULT_SHOP_CONFIG.loadingSubtitle),
    productCollectionHandle: String(formData.get("productCollectionHandle") ?? ""),
    maxAdditionalProducts: Number(formData.get("maxAdditionalProducts") ?? 4),
    themePreset: String(formData.get("themePreset") ?? "custom") as ThemePreset,
    triggerButtonClasses: String(formData.get("triggerButtonClasses") ?? ""),
    aiButtonClasses: String(formData.get("aiButtonClasses") ?? DEFAULT_SHOP_CONFIG.aiButtonClasses),
    secondaryButtonClasses: String(formData.get("secondaryButtonClasses") ?? DEFAULT_SHOP_CONFIG.secondaryButtonClasses),
    primaryButtonClasses: String(formData.get("primaryButtonClasses") ?? DEFAULT_SHOP_CONFIG.primaryButtonClasses),
    modalPanelClasses: String(formData.get("modalPanelClasses") ?? ""),
    formFieldClasses: String(formData.get("formFieldClasses") ?? DEFAULT_SHOP_CONFIG.formFieldClasses),
    imagePropertyKey: String(formData.get("imagePropertyKey") ?? DEFAULT_SHOP_CONFIG.imagePropertyKey),
    generationIdPropertyKey: String(formData.get("generationIdPropertyKey") ?? DEFAULT_SHOP_CONFIG.generationIdPropertyKey),
    maxUploadSizeMb: Number(formData.get("maxUploadSizeMb") ?? 10),
    customCss: String(formData.get("customCss") ?? ""),
    heroImageUrl: String(formData.get("heroImageUrl") ?? ""),
    headerIconUrl: String(formData.get("headerIconUrl") ?? ""),
    skipProductSelection: formData.get("skipProductSelection") === "on",
    modalBgColor: String(formData.get("modalBgColor") ?? DEFAULT_SHOP_CONFIG.modalBgColor),
    modalTextColor: String(formData.get("modalTextColor") ?? DEFAULT_SHOP_CONFIG.modalTextColor),
    accentColor: String(formData.get("accentColor") ?? DEFAULT_SHOP_CONFIG.accentColor),
    overlayColor: String(formData.get("overlayColor") ?? DEFAULT_SHOP_CONFIG.overlayColor),
    modalRadius: Number(formData.get("modalRadius") ?? DEFAULT_SHOP_CONFIG.modalRadius),
    fontScale: Number(formData.get("fontScale") ?? DEFAULT_SHOP_CONFIG.fontScale),
  };

  try {
    await saveShopConfig(admin, config);
    return json({ config, success: true, error: null });
  } catch (error) {
    return json({
      config,
      success: false,
      error: error instanceof Error ? error.message : "Kayıt başarısız",
    });
  }
};

export default function SettingsPage() {
  const { config, apiMockMode, sugarApiMockEnv } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [form, setForm] = useState<ShopConfig>(config);

  const update = (key: keyof ShopConfig, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Page>
      <TitleBar title="Sugar PDP Ayarları" />
      <Layout>
        <Layout.Section>
          {actionData?.success && (
            <Banner tone="success" title="Ayarlar kaydedildi" />
          )}
          {actionData?.error && (
            <Banner tone="critical" title={actionData.error} />
          )}
          {apiMockMode ? (
            <Banner tone="info" title="Demo mod aktif">
              <p>
                AI üretimi mock olarak çalışıyor. Gerçek API için admin&apos;de
                Sugar API Base URL doldurun ve sunucu `.env` dosyasında{" "}
                <code>SUGAR_API_MOCK=false</code> ayarlayın.
                {sugarApiMockEnv
                  ? " (SUGAR_API_MOCK env değişkeni mock'u zorluyor.)"
                  : !form.sugarApiBaseUrl.trim()
                    ? " (API Base URL boş.)"
                    : ""}
              </p>
            </Banner>
          ) : (
            <Banner tone="success" title="Sugar API bağlı">
              <p>
                Gerçek AI üretimi aktif: {form.sugarApiBaseUrl}
              </p>
            </Banner>
          )}
          <Form method="post">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Sugar API
                  </Text>
                  <FormLayout>
                    <TextField
                      label="API Base URL"
                      name="sugarApiBaseUrl"
                      value={form.sugarApiBaseUrl}
                      onChange={(value) => update("sugarApiBaseUrl", value)}
                      autoComplete="off"
                      helpText="Örn: https://api.sugartech.io"
                    />
                    <TextField
                      label="Company ID"
                      name="sugarCompanyId"
                      value={form.sugarCompanyId}
                      onChange={(value) => update("sugarCompanyId", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="API Key"
                      name="sugarApiKey"
                      type="password"
                      value={form.sugarApiKey}
                      onChange={(value) => update("sugarApiKey", value)}
                      autoComplete="off"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Popup metinleri
                  </Text>
                  <FormLayout>
                    <TextField
                      label="Buton metni"
                      name="buttonLabel"
                      value={form.buttonLabel}
                      onChange={(value) => update("buttonLabel", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Popup başlık"
                      name="modalTitle"
                      value={form.modalTitle}
                      onChange={(value) => update("modalTitle", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Buton alt metni"
                      name="buttonHelperText"
                      value={form.buttonHelperText}
                      onChange={(value) => update("buttonHelperText", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Popup alt başlık"
                      name="modalSubtitle"
                      value={form.modalSubtitle}
                      onChange={(value) => update("modalSubtitle", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Upload adımı açıklama ({productTitle} kullanılabilir)"
                      name="modalDescription"
                      value={form.modalDescription}
                      onChange={(value) => update("modalDescription", value)}
                      autoComplete="off"
                      multiline={2}
                    />
                    <TextField
                      label="Ürün seçim adımı açıklama"
                      name="instructionTemplate"
                      value={form.instructionTemplate}
                      onChange={(value) => update("instructionTemplate", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Tasarımı sepete ekle butonu"
                      name="addDesignToCartLabel"
                      value={form.addDesignToCartLabel}
                      onChange={(value) => update("addDesignToCartLabel", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Loading başlık"
                      name="loadingTitle"
                      value={form.loadingTitle}
                      onChange={(value) => update("loadingTitle", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Loading alt metin"
                      name="loadingSubtitle"
                      value={form.loadingSubtitle}
                      onChange={(value) => update("loadingSubtitle", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Ek ürün collection handle"
                      name="productCollectionHandle"
                      value={form.productCollectionHandle}
                      onChange={(value) => update("productCollectionHandle", value)}
                      autoComplete="off"
                      helpText="Popup'ta seçilebilir ek ürünler"
                    />
                    <TextField
                      label="Max ek ürün"
                      name="maxAdditionalProducts"
                      type="number"
                      value={String(form.maxAdditionalProducts)}
                      onChange={(value) => update("maxAdditionalProducts", Number(value) || 4)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Design image property"
                      name="imagePropertyKey"
                      value={form.imagePropertyKey}
                      onChange={(value) => update("imagePropertyKey", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Generation ID property"
                      name="generationIdPropertyKey"
                      value={form.generationIdPropertyKey}
                      onChange={(value) => update("generationIdPropertyKey", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Max upload (MB)"
                      name="maxUploadSizeMb"
                      type="number"
                      value={String(form.maxUploadSizeMb)}
                      onChange={(value) =>
                        update("maxUploadSizeMb", Number(value) || 10)
                      }
                      autoComplete="off"
                    />
                    <Checkbox
                      label="Ürün seçim adımını atla (tüm PDP blokları için varsayılan)"
                      checked={form.skipProductSelection}
                      onChange={(checked) =>
                        update("skipProductSelection", checked)
                      }
                    />
                    <input
                      type="hidden"
                      name="skipProductSelection"
                      value={form.skipProductSelection ? "on" : ""}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Tema renk varsayılanları
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Block ayarı boş bırakıldığında veya custom preset seçildiğinde
                    kullanılır. Dawn/Normod preset tema değişkenlerini önceler.
                  </Text>
                  <FormLayout>
                    <TextField
                      label="Modal arka plan"
                      name="modalBgColor"
                      value={form.modalBgColor}
                      onChange={(value) => update("modalBgColor", value)}
                      autoComplete="off"
                      placeholder="#ffffff"
                    />
                    <TextField
                      label="Modal metin rengi"
                      name="modalTextColor"
                      value={form.modalTextColor}
                      onChange={(value) => update("modalTextColor", value)}
                      autoComplete="off"
                      placeholder="#121212"
                    />
                    <TextField
                      label="Accent rengi"
                      name="accentColor"
                      value={form.accentColor}
                      onChange={(value) => update("accentColor", value)}
                      autoComplete="off"
                      placeholder="#c4a574"
                    />
                    <TextField
                      label="Overlay (rgba destekler)"
                      name="overlayColor"
                      value={form.overlayColor}
                      onChange={(value) => update("overlayColor", value)}
                      autoComplete="off"
                      placeholder="rgba(0, 0, 0, 0.55)"
                    />
                    <TextField
                      label="Modal radius (px)"
                      name="modalRadius"
                      type="number"
                      value={String(form.modalRadius)}
                      onChange={(value) =>
                        update("modalRadius", Number(value) || DEFAULT_SHOP_CONFIG.modalRadius)
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Font ölçeği (%)"
                      name="fontScale"
                      type="number"
                      value={String(form.fontScale)}
                      onChange={(value) =>
                        update(
                          "fontScale",
                          Math.min(150, Math.max(75, Number(value) || DEFAULT_SHOP_CONFIG.fontScale)),
                        )
                      }
                      autoComplete="off"
                      helpText="100 = tema boyutu. Küçük görünüyorsa 110–125 deneyin. Block ayarı varsa block önceliklidir."
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Tema CSS uyumu
                  </Text>
                  <FormLayout>
                    <input type="hidden" name="themePreset" value={form.themePreset} />
                    <Select
                      label="Tema preset"
                      options={[
                        { label: "Custom", value: "custom" },
                        { label: "Dawn", value: "dawn" },
                        { label: "Normod", value: "normod" },
                      ]}
                      value={form.themePreset}
                      onChange={(value) =>
                        update("themePreset", value as ThemePreset)
                      }
                    />
                    <TextField
                      label="AI button classes"
                      name="aiButtonClasses"
                      value={form.aiButtonClasses}
                      onChange={(value) => update("aiButtonClasses", value)}
                      autoComplete="off"
                      helpText="Outline AI butonu — boş bırakılırsa sugar-ai-btn"
                    />
                    <TextField
                      label="Primary button classes (Tasarla / Sepete Ekle)"
                      name="primaryButtonClasses"
                      value={form.primaryButtonClasses}
                      onChange={(value) => update("primaryButtonClasses", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Hero görsel URL"
                      name="heroImageUrl"
                      value={form.heroImageUrl}
                      onChange={(value) => update("heroImageUrl", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Header ikon URL"
                      name="headerIconUrl"
                      value={form.headerIconUrl}
                      onChange={(value) => update("headerIconUrl", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Secondary button classes"
                      name="secondaryButtonClasses"
                      value={form.secondaryButtonClasses}
                      onChange={(value) =>
                        update("secondaryButtonClasses", value)
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Modal panel classes"
                      name="modalPanelClasses"
                      value={form.modalPanelClasses}
                      onChange={(value) => update("modalPanelClasses", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Form field classes"
                      name="formFieldClasses"
                      value={form.formFieldClasses}
                      onChange={(value) => update("formFieldClasses", value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Özel CSS"
                      name="customCss"
                      value={form.customCss}
                      onChange={(value) => update("customCss", value)}
                      autoComplete="off"
                      multiline={6}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <Button submit variant="primary">
                Kaydet
              </Button>
            </BlockStack>
          </Form>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
