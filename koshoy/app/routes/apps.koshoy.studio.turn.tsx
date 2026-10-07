import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { koshoyContextFromProxy } from "../koshoy/context.server";
import { handleKoshoyTurn, koshoyTurnError } from "../koshoy/handlers.server";

/** Storefront: POST /apps/koshoy/studio/turn — SSE, or JSON with Accept: application/json. */
export const loader = async ({ request }: LoaderFunctionArgs) =>
  koshoyTurnError(request, "invalid_input", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await koshoyContextFromProxy(request);
  if (!ctx) return koshoyTurnError(request, "unavailable", 401);
  return handleKoshoyTurn(request, ctx);
};
