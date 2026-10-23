import type { ActionFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { handleKoshoyPhoneLinkStatus } from "../koshoy/phone-handlers.server";
import { koshoyStudioError } from "../koshoy/room-handlers.server";

/** Storefront: POST /apps/koshoy/studio/phone-link-status {linkId} → {phone} (desktop polls). */
export const loader = async () => koshoyStudioError("invalid_input", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyStudioError("unavailable", 401);
  return handleKoshoyPhoneLinkStatus(request, ctx);
};
