import type { LoaderFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { handleKoshoyRenderFile, koshoyStudioError } from "../koshoy/room-handlers.server";

/** Storefront: GET /apps/koshoy/studio/render-file?render= → image bytes. Session in the Authorization header. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyStudioError("unavailable", 401);
  return handleKoshoyRenderFile(request, ctx);
};

export const action = async () => koshoyStudioError("invalid_input", 405);
