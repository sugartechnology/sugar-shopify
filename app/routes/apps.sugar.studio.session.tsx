import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import {
  handleKoshoySession,
  koshoyErrorResponse,
  koshoyMethodNotAllowed,
} from "../koshoy/handlers.server";

/** Storefront: POST /apps/koshoy/studio/session (App Proxy). GET never creates sessions. */
export const loader = async () => koshoyMethodNotAllowed();

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyErrorResponse("unavailable", 401);
  return handleKoshoySession(request, ctx);
};
