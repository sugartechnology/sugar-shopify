import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { handleKoshoyRenderStatus, koshoyStudioError } from "../koshoy/room-handlers.server";

/** Storefront: POST /apps/koshoy/studio/render-status {renderId} → {render}. */
export const loader = async () => koshoyStudioError("invalid_input", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyStudioError("unavailable", 401);
  return handleKoshoyRenderStatus(request, ctx);
};
