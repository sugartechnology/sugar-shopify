/**
 * Kök URL (/). Shopify admin app'i genelde ?shop=... ile gelir.
 * shop parametresi varsa embedded admin'e yönlendir; yoksa login ekranı.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/pdp-ai?${url.searchParams.toString()}`);
  }

  // Mağaza domain'i gir → Shopify OAuth başlat (kütüphane)
  return login(request);
};
