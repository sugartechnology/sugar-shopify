import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { koshoyErrorResponse, koshoyMethodNotAllowed } from "../koshoy/handlers.server";
import { handleKoshoySessionDelete } from "../koshoy/room-sessions-handlers.server";

/** Storefront: POST /apps/koshoy/studio/session-delete (App Proxy, CONTRACT §2.8). */
export const loader = async () => koshoyMethodNotAllowed();

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyErrorResponse("unavailable", 401);
  return handleKoshoySessionDelete(request, ctx);
};
