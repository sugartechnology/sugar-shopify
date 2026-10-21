import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import {
  handleKoshoyEdit,
  koshoyErrorResponse,
  koshoyMethodNotAllowed,
} from "../koshoy/handlers.server";

/** Storefront: POST /apps/koshoy/studio/edit {designId, version, op}. */
export const loader = async () => koshoyMethodNotAllowed();

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyErrorResponse("unavailable", 401);
  return handleKoshoyEdit(request, ctx);
};
