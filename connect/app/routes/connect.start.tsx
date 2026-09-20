import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { stateCookie, verifyConnectState } from "../services/state.server";

/**
 * CRM Super-admin Connect butonu buraya gelir.
 * Custom install link kullanılmaz — standart Shopify OAuth.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  verifyConnectState(state);

  const shop = url.searchParams.get("shop")?.trim();
  const headers = { "Set-Cookie": stateCookie(state!) };

  if (shop) {
    throw redirect(`/?shop=${encodeURIComponent(shop)}`, { headers });
  }

  throw redirect("/auth/login", { headers });
};
