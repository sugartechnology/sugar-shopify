/**
 * Shopify 3-tier API contract smoke checks (offline).
 * Run: node scripts/verify-shopify-api-contract.mjs
 */

const endpoints = {
  register: "/api/shopify/credentials/register",
  generate: "/api/shopify/pdp/generate",
  decorAi: "/api/ai/commands/with-files",
};

const requiredEnv = [
  "SUGAR_API_BASE_URL",
  "SHOPIFY_SERVICE_SECRET",
  "DECOR_AI_INTERNAL_TOKEN",
];

let failed = false;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`verify-shopify-api-contract: ${key} not set (expected in production)`);
  }
}

if (!process.env.SUGAR_API_BASE_URL?.includes("api.sugartech.io")) {
  console.warn(
    "verify-shopify-api-contract: SUGAR_API_BASE_URL should point to api.sugartech.io in production",
  );
}

for (const [name, path] of Object.entries(endpoints)) {
  if (!path.startsWith("/api/")) {
    console.error(`Invalid endpoint path for ${name}: ${path}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("verify-shopify-api-contract: contract paths OK");
