/**
 * Internal SKU audit (no UI): shop variants of every status vs. the part SKUs
 * our templates need. Guarded by SHOPIFY_SERVICE_SECRET (X-Service-Secret);
 * used by the team to settle the real Shopify SKU convention.
 */
import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { getCabinetEngine } from "../koshoy/engine";
import { auditSkus, fetchShopVariants, requiredTemplateSkus } from "../koshoy/sku-audit.server";

function secretOk(given: string | null): boolean {
  const expected = (process.env.SHOPIFY_SERVICE_SECRET ?? "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!secretOk(request.headers.get("x-service-secret"))) {
    return new Response("Not found", { status: 404 });
  }
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) return json({ error: "shop required" }, { status: 400 });
  const { admin } = await unauthenticated.admin(shop);
  const variants = await fetchShopVariants(admin);
  const audit = auditSkus(requiredTemplateSkus(getCabinetEngine()), variants);
  return json({ shop, variants, audit });
};
