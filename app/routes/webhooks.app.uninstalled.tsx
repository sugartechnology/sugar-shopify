import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  if (!session) {
    return new Response(null, { status: 401 });
  }

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await authenticate.sessionStorage.deleteSession(session.id);
      }
      break;
    default:
      console.warn(`Unhandled webhook topic: ${topic} for shop ${shop}`);
  }

  return new Response();
};
