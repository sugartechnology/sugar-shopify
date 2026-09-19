import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate, login } from "../shopify.server";
import { loadShopIdentity } from "../services/catalog.server";
import { notifyInstalled, resolveReturnUrl } from "../services/crm.server";
import { clearStateCookie, readStateCookie, verifyConnectState } from "../services/state.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop")) {
    return login(request);
  }

  const { session } = await authenticate.admin(request);
  const state = readStateCookie(request);
  if (state) {
    try {
      const connectSessionId = verifyConnectState(state);
      const shop = await loadShopIdentity(session.shop);
      const installed = await notifyInstalled({
        shopDomain: shop.shopDomain,
        shopGid: shop.shopGid,
        connectSessionId,
      });
      const returnUrl = resolveReturnUrl(installed.returnUrl);
      if (returnUrl) {
        throw redirect(returnUrl, {
          headers: { "Set-Cookie": clearStateCookie() },
        });
      }
      return Response.json(
        { shop: shop.shopDomain, companyName: installed.companyName, error: null },
        { headers: { "Set-Cookie": clearStateCookie() } },
      );
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      return {
        shop: session.shop,
        companyName: null,
        error: error instanceof Error ? error.message : "Shopify connection failed",
      };
    }
  }

  return { shop: session.shop, companyName: null, error: null };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  if (data && "shop" in data) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: 32, maxWidth: 560 }}>
        <h1>Sugar Connect</h1>
        {data.error ? (
          <p>{data.error}</p>
        ) : (
          <p>
            {data.shop} is connected
            {data.companyName ? ` to ${data.companyName}` : ""}. Catalog transfer continues in CRM Super Admin.
          </p>
        )}
      </main>
    );
  }
  return null;
}
