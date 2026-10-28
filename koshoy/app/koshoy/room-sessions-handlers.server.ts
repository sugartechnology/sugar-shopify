/**
 * Room list and room delete endpoints (CONTRACT §2.8). Opening an account
 * room on this device is `POST /session {open}` (handlers.server.ts).
 */
import { koshoyErrorResponse, koshoyJson, readJson, type KoshoyRequestContext } from "./handlers.server";
import { parseOpaqueId } from "./input";
import { koshoyClientKey } from "./rate-limit.server";
import {
  deleteRoomSession,
  listRoomSessions,
  MAX_ROOM_SESSIONS,
  type KoshoyRoomSessionsDeps,
} from "./room-sessions.server";
import { isWellFormedKoshoyToken } from "./token.server";

async function roomSessionsDeps(ctx: KoshoyRequestContext): Promise<KoshoyRoomSessionsDeps> {
  const data = await ctx.journeyData();
  return { db: ctx.roomSessions, store: ctx.store, files: ctx.room?.files, roomTypes: data.rooms };
}

/** The browser's room tokens: well-formed, no repeats, at most MAX_ROOM_SESSIONS. */
function parseKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((key): key is string => typeof key === "string" && isWellFormedKoshoyToken(key));
  return [...new Set(keys)].slice(0, MAX_ROOM_SESSIONS);
}

/* ---------------- POST /sessions ---------------- */

export async function handleKoshoySessions(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled) return koshoyErrorResponse("unavailable");
    if (!ctx.limits.rooms.hit(koshoyClientKey(ctx.shop, request))) {
      return koshoyErrorResponse("rate_limited");
    }
    const body = await readJson(request);
    const rooms = await listRoomSessions(await roomSessionsDeps(ctx), {
      shop: ctx.shop,
      customerId: ctx.customerId,
      keys: parseKeys(body.keys),
      onAttach: (sessionId) => ctx.track?.(sessionId, "signed_in"),
    });
    return koshoyJson({ rooms, account: Boolean(ctx.customerId), max: MAX_ROOM_SESSIONS });
  } catch (error) {
    console.error("[koshoy] room list failed", error);
    return koshoyErrorResponse("unavailable");
  }
}

/* ---------------- POST /session-delete ---------------- */

export async function handleKoshoySessionDelete(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled) return koshoyErrorResponse("unavailable");
    if (!ctx.limits.rooms.hit(koshoyClientKey(ctx.shop, request))) {
      return koshoyErrorResponse("rate_limited");
    }
    const body = await readJson(request);
    const ref = parseOpaqueId(body.ref);
    if (!ref) return koshoyErrorResponse("invalid_input");
    const key = typeof body.key === "string" && isWellFormedKoshoyToken(body.key) ? body.key : null;
    const deleted = await deleteRoomSession(await roomSessionsDeps(ctx), {
      shop: ctx.shop,
      customerId: ctx.customerId,
      ref,
      key,
    });
    return deleted ? koshoyJson({ ok: true }) : koshoyErrorResponse("session_expired");
  } catch (error) {
    console.error("[koshoy] room delete failed", error);
    return koshoyErrorResponse("unavailable");
  }
}
