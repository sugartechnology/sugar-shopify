/**
 * Mağaza app'i kaldırınca Shopify webhook gönderir.
 * O shop'un Session ve ShopCredential kayıtlarını sileriz.
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, sessionStorage } from "../shopify.server";
import { deleteShopCredential } from "../services/shop-credentials.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  if (!session) {
    return new Response(null, { status: 401 });
  }

  switch (topic) {
    case "APP_UNINSTALLED":
      await sessionStorage?.deleteSession(session.id);
      await deleteShopCredential(shop);
      break;
    default:
      console.warn(`Unhandled webhook topic: ${topic} for shop ${shop}`);
  }

  return new Response();
};
