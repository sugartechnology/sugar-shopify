/**
 * Embedded admin home: install status + whether the LLM gateway key exists.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getShopCredentialInfo } from "../services/shop-credentials.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const credential = await getShopCredentialInfo(session.shop);
  return json({
    appBridgeApiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    keyPrefix: credential?.keyPrefix ?? null,
  });
};

export default function Index() {
  const { shop, keyPrefix } = useLoaderData<typeof loader>();
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 20 }}>Koshoy Studio kurulu</h1>
      <p>Mağaza: {shop}</p>
      <p>
        API anahtarı:{" "}
        {keyPrefix ? `tanımlı (…${keyPrefix})` : "henüz tanımlı değil (uygulamayı yeniden açın)"}
      </p>
    </main>
  );
}
