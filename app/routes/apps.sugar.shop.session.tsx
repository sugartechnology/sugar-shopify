import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getShopConfig } from "../services/shop-config.server";
import {
  createShoppingChatSession,
  getShoppingChatSession,
  publicDisplayEvents,
  readSessionCookie,
  sessionCookieHeader,
} from "../services/shopping-chat-session.server";
import { issueShoppingStreamToken } from "../services/shopping-chat-token.server";

function chatUrl(request: Request) {
  const env = (process.env.SHOPIFY_APP_URL || process.env.HOST || "")
    .trim()
    .replace(/\/+$/, "");
  if (env) return `${env}/api/shop/chat`;
  const origin = new URL(request.url).origin;
  if (!origin.includes("myshopify.com")) return `${origin}/api/shop/chat`;
  return "/api/shop/chat";
}

async function handleSession(request: Request, reset: boolean) {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getShopConfig(admin);
  if (!config.shopAssistantEnabled) {
    return json({ enabled: false, events: [] });
  }

  const cookieId = readSessionCookie(request);
  let state =
    !reset && cookieId
      ? getShoppingChatSession(cookieId, session.shop)
      : null;
  if (!state) {
    state = createShoppingChatSession(session.shop);
  }

  const headers = new Headers({
    "Set-Cookie": sessionCookieHeader(state.id),
  });
  return json(
    {
      enabled: true,
      sessionId: state.id,
      streamToken: issueShoppingStreamToken(state.id, session.shop),
      chatUrl: chatUrl(request),
      events: publicDisplayEvents(state.events),
      currency: state.brief.currency,
    },
    { headers },
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    return await handleSession(request, false);
  } catch (error) {
    console.error("[sugar-shop-session]", error);
    return json({ error: "Failed to start shopping session" }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const body = await request.json().catch(() => ({}));
    return await handleSession(request, Boolean((body as { reset?: boolean }).reset));
  } catch (error) {
    console.error("[sugar-shop-session]", error);
    return json({ error: "Failed to start shopping session" }, { status: 500 });
  }
};
