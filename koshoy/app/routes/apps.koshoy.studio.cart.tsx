import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import {
  handleKoshoyCart,
  koshoyErrorResponse,
  koshoyMethodNotAllowed,
} from "../koshoy/handlers.server";

/** Storefront: POST /apps/koshoy/studio/cart {designId, version} → variant lines. */
export const loader = async () => koshoyMethodNotAllowed();

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyErrorResponse("unavailable", 401);
  return handleKoshoyCart(request, ctx);
};
