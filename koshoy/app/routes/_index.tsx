/**
 * Embedded admin home: install status, LLM gateway key, and the SKU audit
 * (template part SKUs vs. the shop's variants, any product status).
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getShopCredentialInfo } from "../services/shop-credentials.server";
import { getCabinetEngine } from "../koshoy/engine";
import {
  auditSkus,
  fetchShopVariants,
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
  return json({
    shop: session.shop,
    keyPrefix: credential?.keyPrefix ?? null,
    audit,
    variants,
    variantsError,
  });
};

const cell = { borderBottom: "1px solid #e3e3e3", padding: "6px 8px", textAlign: "left" as const, verticalAlign: "top" as const };

export default function Index() {
  const { shop, keyPrefix, audit, variants, variantsError } = useLoaderData<typeof loader>();
  const found = audit.filter((row) => row.found).length;
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, lineHeight: 1.5, fontSize: 14 }}>
      <h1 style={{ fontSize: 20 }}>Koshoy Studio kurulu</h1>
      <p>Mağaza: {shop}</p>
      <p>
        API anahtarı:{" "}
        {keyPrefix ? `tanımlı (…${keyPrefix})` : "henüz tanımlı değil (uygulamayı yeniden açın)"}
      </p>

      <h2 style={{ fontSize: 17, marginTop: 32 }}>
        Şablon parçaları ↔ Shopify SKU ({found}/{audit.length} bulundu)
      </h2>
      <p>Tasarım şablonlarının ihtiyaç duyduğu parça SKU'ları. Bulunamayanlarda fiyat "[FİYAT]" görünür.</p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Beklenen SKU</th>
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
                {row.found ? `✅ ${row.found.productTitle} · ${row.found.price}` : "❌ yok"}
              </td>
              <td style={cell}>{row.usedBy.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
