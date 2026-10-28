/**
 * Item removal endpoints (CONTRACT §2.9): /room-clean and /room-clean-status.
 * Same session rules and error bodies as the room endpoints
 * (room-handlers.server.ts); the files come through /room-file …&clean=.
 *
 * Limits: a new selection counts per visitor (koshoyClientKey, one a
 * minute) and per room photo (MAX_CLEANS_PER_ROOM distinct selections);
 * asking for one again and bringing everything back are free. Status polls
 * count per session like the room's.
 */
import { koshoyJson, loadSession, readJson, type KoshoyRequestContext } from "./handlers.server";
import { parseOpaqueId } from "./input";
import { MAX_PHOTO_ITEMS } from "./photo-items";
import { koshoyClientKey } from "./rate-limit.server";
import { refreshActiveClean, requestClean, roomViewWithClean } from "./room-clean.server";
import { koshoyStudioError } from "./room-handlers.server";

/** {roomId, objectIds: string[]} with 0..12 well-formed ids; null otherwise. */
export function parseRoomCleanRequest(body: Record<string, unknown>): { roomId: string; objectIds: string[] } | null {
  const roomId = parseOpaqueId(body.roomId);
  if (!roomId || !Array.isArray(body.objectIds) || body.objectIds.length > MAX_PHOTO_ITEMS) return null;
  const objectIds = body.objectIds.map(parseOpaqueId);
  if (objectIds.some((id) => id === null)) return null;
  return { roomId, objectIds: objectIds as string[] };
}

/* ---------------- POST /room-clean {roomId, objectIds} ---------------- */

export async function handleKoshoyRoomClean(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const input = parseRoomCleanRequest(body);
    if (!input) return koshoyStudioError("invalid_input");

    const room = await ctx.room.db.koshoyRoom.findFirst({
      where: { id: input.roomId, sessionId: session.id },
    });
    if (!room) return koshoyStudioError("not_found");
    if (room.status !== "ready") return koshoyStudioError("invalid_input");

    const visitor = koshoyClientKey(ctx.shop, request);
    const limiter = ctx.limits.roomClean;
    const result = await requestClean(ctx.room, room, input.objectIds, () => limiter?.hit(visitor) ?? false);
    if (!result.ok) {
      if (result.refused === "unknown_items") return koshoyStudioError("invalid_input");
      if (result.refused === "rate_limited") return koshoyStudioError("rate_limited");
      return koshoyJson({ error: "clean_limit" }, 400);
    }
    return koshoyJson({ room: await roomViewWithClean(ctx.room.db, result.room) });
  } catch (error) {
    console.error("[koshoy] room clean failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /room-clean-status {roomId} ---------------- */

export async function handleKoshoyRoomCleanStatus(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const roomId = parseOpaqueId(body.roomId);
    if (!roomId) return koshoyStudioError("invalid_input");
    if (!ctx.limits.roomRead.hit(session.id)) return koshoyStudioError("rate_limited");

    const found = await ctx.room.db.koshoyRoom.findFirst({
      where: { id: roomId, sessionId: session.id },
    });
    if (!found) return koshoyStudioError("not_found");
    const room = found.status === "ready" ? await refreshActiveClean(ctx.room, found) : found;
    return koshoyJson({ room: await roomViewWithClean(ctx.room.db, room) });
  } catch (error) {
    console.error("[koshoy] room clean status failed", error);
    return koshoyStudioError("unavailable");
  }
}
