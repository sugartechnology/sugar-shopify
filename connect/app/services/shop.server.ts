export function normalizeShop(shop: string) {
  const normalized = shop.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return normalized.includes(".") ? normalized : `${normalized}.myshopify.com`;
}
