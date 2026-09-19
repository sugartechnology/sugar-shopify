import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { getShopConfig } from "../services/shop-config.server";
import { getShoppingChatSession } from "../services/shopping-chat-session.server";
import {
  parseClientInput,
  runShoppingChatTurn,
  shoppingCorsHeaders,
} from "../services/shopping-chat.server";
import {
  readBearerToken,
  verifyShoppingStreamToken,
} from "../services/shopping-chat-token.server";

function corsResponse(request: Request, status = 204) {
  return new Response(null, {
    status,
    headers: shoppingCorsHeaders(request),
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return corsResponse(request);
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...shoppingCorsHeaders(request),
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return corsResponse(request);

  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...shoppingCorsHeaders(request),
  };

  try {
    const claims = verifyShoppingStreamToken(readBearerToken(request));
    const { admin } = await unauthenticated.admin(claims.shop);
    const config = await getShopConfig(admin);
    if (!config.shopAssistantEnabled) {
      return new Response("event: error\ndata: {\"type\":\"error\",\"message\":\"Disabled\"}\n\n", {
        status: 403,
        headers,
      });
    }

    const session = getShoppingChatSession(claims.sessionId, claims.shop);
    if (!session) {
      return new Response("event: error\ndata: {\"type\":\"error\",\"message\":\"Session expired\"}\n\n", {
        status: 401,
        headers,
      });
    }

    const client = parseClientInput(await request.json().catch(() => null));
    if (!client) {
      return new Response("event: error\ndata: {\"type\":\"error\",\"message\":\"Invalid input\"}\n\n", {
        status: 400,
        headers,
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const emit = (event: { type: string }) => {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        };
        void runShoppingChatTurn({
          client,
          admin,
          config,
          session,
          emit,
        })
          .catch((error) => {
            emit({
              type: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Shopping assistant failed",
            } as { type: string });
            emit({ type: "done" });
          })
          .finally(() => {
            controller.close();
          });
      },
    });

    return new Response(stream, { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unauthorized";
    const status = /token|expired|Unauthorized/i.test(message) ? 401 : 500;
    return new Response(
      `event: error\ndata: ${JSON.stringify({ type: "error", message })}\n\n`,
      { status, headers },
    );
  }
};
