import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { notifyUninstalled } from "../services/crm.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  if (topic === "APP_UNINSTALLED") {
    if (session) {
      await authenticate.sessionStorage.deleteSession(session.id);
    }
    await notifyUninstalled(shop);
  }
  return new Response();
};
