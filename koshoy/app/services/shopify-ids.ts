/** gid://shopify/ProductVariant/123 → "123" */
export function gidToNumericId(gid: string | undefined): string {
  if (!gid) return "";
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}
