import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { handleKoshoyRender, koshoyStudioError } from "../koshoy/room-handlers.server";

/** Storefront: POST /apps/koshoy/studio/render {roomId, designId, composite, cabinet} → {render}. */
export const loader = async () => koshoyStudioError("invalid_input", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyStudioError("unavailable", 401);
  return handleKoshoyRender(request, ctx);
};
