import type { LoaderFunctionArgs } from "@remix-run/node";
import { login } from "../shopify.server";
import { stateCookie, verifyConnectState } from "../services/state.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  verifyConnectState(state);
  const shop = url.searchParams.get("shop");

  if (shop) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/?shop=${encodeURIComponent(shop)}`,
        "Set-Cookie": stateCookie(state!),
      },
    });
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  if (apiKey) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://admin.shopify.com/oauth/install_custom_app?client_id=${encodeURIComponent(apiKey)}`,
        "Set-Cookie": stateCookie(state!),
      },
    });
  }

  const loginResponse = await login(request);
  const loginHeaders = new Headers(loginResponse.headers);
  loginHeaders.append("Set-Cookie", stateCookie(state!));
  return new Response(loginResponse.body, {
    status: loginResponse.status,
    headers: loginHeaders,
  });
};
