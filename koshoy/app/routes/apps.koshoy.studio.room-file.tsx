import type { LoaderFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { handleKoshoyRoomFile, koshoyStudioError } from "../koshoy/room-handlers.server";

/** Storefront: GET /apps/koshoy/studio/room-file?room=&name=[&clean=] → image bytes. Session in the Authorization header. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyStudioError("unavailable", 401);
  return handleKoshoyRoomFile(request, ctx);
};

export const action = async () => koshoyStudioError("invalid_input", 405);
