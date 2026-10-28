/**
 * Embedded admin home: install status, LLM gateway key, and the catalog health
 * (template parts vs. the shop's part products, matched by structure).
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getShopCredentialInfo } from "../services/shop-credentials.server";
import { getCabinetEngine } from "../koshoy/engine";
import { koshoyData } from "../koshoy/data.server";
import { readPartCatalog } from "../koshoy/part-catalog";
import { shopColorKey } from "../koshoy/shop-colors";
import {
  auditSkus,
  fetchShopVariants,
  offeredShopColors,
  requiredTemplateSkus,
  type ShopVariant,
} from "../koshoy/sku-audit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const credential = await getShopCredentialInfo(session.shop);
  let variants: ShopVariant[] = [];
  let variantsError = "";
  try {
    variants = await fetchShopVariants(admin);
  } catch (error) {
    console.error("[koshoy] sku audit: product read failed", error);
    variantsError = "Ürünler okunamadı.";
  }
  const audit = auditSkus(requiredTemplateSkus(getCabinetEngine()), variants);
  const catalog = readPartCatalog(variants);
  const unread = catalog.unread.map((variant) => variant.productTitle);
  // Colours: which look is offered, and shop colours that have no look yet.
  const looks = (await koshoyData().snapshot()).colors;
  const offered = offeredShopColors(getCabinetEngine(), catalog, looks);
  const colors = looks.map((look) => ({
    label: look.label,
    use: look.use,
    offered: (look.use === "body" ? offered.body : offered.handles).has(shopColorKey(look.shopColor)),
  }));
  const lookless = [...catalog.bodyColors].filter(
    (color) => !looks.some((look) => shopColorKey(look.shopColor) === color),
  );
  return json({
    shop: session.shop,
    keyPrefix: credential?.keyPrefix ?? null,
    audit,
    unread,
    colors,
    lookless,
    variants,
    variantsError,
  });
};

const cell = { borderBottom: "1px solid #e3e3e3", padding: "6px 8px", textAlign: "left" as const, verticalAlign: "top" as const };

export default function Index() {
  const { shop, keyPrefix, audit, unread, colors, lookless, variants, variantsError } = useLoaderData<typeof loader>();
  const found = audit.filter((row) => row.found).length;
  const twins = audit.filter((row) => row.candidates.length > 1).length;
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, lineHeight: 1.5, fontSize: 14 }}>
      <h1 style={{ fontSize: 20 }}>Koshoy Studio kurulu</h1>
      <p>Mağaza: {shop}</p>
      <p>
        API anahtarı:{" "}
        {keyPrefix ? `tanımlı (…${keyPrefix})` : "henüz tanımlı değil (uygulamayı yeniden açın)"}
      </p>

      <h2 style={{ fontSize: 17, marginTop: 32 }}>
        Katalog sağlığı: {found}/{audit.length} parça bulundu, {audit.length - found - twins} eksik, {twins} iki ürünlü
      </h2>
      <p>
        Tasarım şablonlarının kullandığı parçalar. Mağazadaki ürün adı yapısına göre okunur (parça, seri, renk, ölçü);
        ad sırası, boşluk ve büyük/küçük harf önemli değildir. Eksik ya da iki ürünlü parçada fiyat "[FİYAT]" görünür.
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Beklenen parça</th>
            <th style={cell}>Parça</th>
            <th style={cell}>Durum</th>
            <th style={cell}>Kullanan şablonlar</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((row) => (
            <tr key={row.sku}>
              <td style={{ ...cell, fontFamily: "monospace" }}>{row.sku}</td>
              <td style={cell}>
                {row.line.part} {row.line.widthMm}×{row.line.heightMm}×{row.line.depthMm} {row.line.color}
              </td>
              <td style={cell}>
                {row.found
                  ? `✅ ${row.found.productTitle} · ${row.found.price}`
                  : row.candidates.length > 1
                    ? `⚠️ iki ürün: ${row.candidates.map((item) => item.productTitle).join(" | ")}`
                    : "❌ yok"}
              </td>
              <td style={cell}>{row.usedBy.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        Renkler:{" "}
        {colors
          .map((color) => `${color.label} (${color.use === "body" ? "dolap" : "kulp"}) ${color.offered ? "✅ sunuluyor" : "❌ mağazada eksik"}`)
          .join(" · ")}
      </p>
      {lookless.length ? (
        <p>Mağazada olup görünüşü girilmemiş renkler (stüdyoda çıkmaz, veri API'si "colors"): {lookless.join(", ")}</p>
      ) : null}
      {unread.length ? (
        <p>Parça olarak okunamayan ürünler (fiyatta kullanılmaz): {unread.join(", ")}</p>
      ) : null}

      <h2 style={{ fontSize: 17, marginTop: 32 }}>Mağazadaki ürünler ve SKU'lar ({variants.length} varyant)</h2>
      {variantsError ? <p>{variantsError}</p> : null}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Ürün</th>
            <th style={cell}>Durum</th>
            <th style={cell}>Varyant</th>
            <th style={cell}>SKU</th>
            <th style={cell}>Fiyat</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant, index) => (
            <tr key={`${variant.sku}-${index}`}>
              <td style={cell}>{variant.productTitle}</td>
              <td style={cell}>{variant.productStatus}</td>
              <td style={cell}>{variant.variantTitle}</td>
              <td style={{ ...cell, fontFamily: "monospace" }}>{variant.sku || "—"}</td>
              <td style={cell}>{variant.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
