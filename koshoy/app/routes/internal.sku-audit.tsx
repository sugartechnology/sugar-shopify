/**
 * Internal catalog audit (no UI): shop variants of every status vs. every part
 * × size × colour the configurator can produce (`?scope=templates`: only the
 * templates). `?format=csv` gives the problem rows (parça, ölçü, renk, neden).
 * Guarded by SHOPIFY_SERVICE_SECRET (X-Service-Secret); re-run after every
 * price / stock update.
 */
import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { getCabinetEngine } from "../koshoy/engine";
import {
  auditCsv,
  auditSkus,
  fetchShopVariants,
  requiredCatalogSkus,
  requiredTemplateSkus,
} from "../koshoy/sku-audit.server";

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
  const params = new URL(request.url).searchParams;
  const shop = params.get("shop") ?? "";
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) return json({ error: "shop required" }, { status: 400 });
  const { admin } = await unauthenticated.admin(shop);
  const variants = await fetchShopVariants(admin);
  const engine = getCabinetEngine();
  const required = params.get("scope") === "templates" ? requiredTemplateSkus(engine) : requiredCatalogSkus(engine);
  const audit = auditSkus(required, variants);
  if (params.get("format") === "csv") {
    return new Response(auditCsv(audit), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  }
  return json({ shop, variants, audit });
};
