import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate, login } from "../shopify.server";
import { loadShopIdentity } from "../services/catalog.server";
import { notifyInstalled, resolveReturnUrl } from "../services/crm.server";
import { takePendingConnect } from "../services/pending-connect.server";
import { clearStateCookie, readStateCookie, verifyConnectState } from "../services/state.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop")) {
    return login(request);
  }

  const { session } = await authenticate.admin(request);
  const state = readStateCookie(request);
  let connectSessionId: string | null = null;
  if (state) {
    try {
      connectSessionId = verifyConnectState(state);
    } catch (error) {
      console.warn("Connect state cookie invalid", error);
    }
  }
  if (!connectSessionId) {
    connectSessionId = await takePendingConnect(session.shop);
  }

  if (connectSessionId) {
    try {
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
      return {
        shop: shop.shopDomain,
        companyName: installed.companyName,
        error: null,
        crmLinked: true,
      };
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      return {
        shop: session.shop,
        companyName: null,
        error: error instanceof Error ? error.message : "Shopify connection failed",
        crmLinked: false,
      };
    }
  }

  return {
    shop: session.shop,
    companyName: null,
    error: null,
    crmLinked: false,
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  if (data && "shop" in data) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: 32, maxWidth: 560 }}>
        <h1>Sugar Connect</h1>
        {data.error ? (
          <p>{data.error}</p>
        ) : data.crmLinked ? (
          <p>
            {data.shop} CRM şirketine bağlandı
            {data.companyName ? `: ${data.companyName}` : ""}. Super Admin’e dönebilirsiniz.
          </p>
        ) : (
          <p>
            {data.shop} Shopify’de kurulu, ama CRM haberdar değil. Super Admin’de şirketi açıp
            tekrar Connect’e basın.
          </p>
        )}
      </main>
    );
  }
  return null;
}
