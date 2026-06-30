/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SHOPIFY_API_KEY: string;
  readonly SHOPIFY_API_SECRET: string;
  readonly SCOPES: string;
  readonly SHOPIFY_APP_URL: string;
  readonly SUGAR_API_MOCK: string;
  readonly SUGAR_API_BASE_URL: string;
  readonly SHOPIFY_SERVICE_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
