/**
 * Room photo and render endpoints (CONTRACT §3): /room, /room-status,
 * /room-file, /render, /render-status, /render-file. Same session rules as
 * the other studio endpoints (handlers.server.ts): Authorization header,
 * cookie, then {session} in the body.
 *
 * Bodies are {room: RoomView}, {render: RenderView}, {layout, events},
 * image bytes or {error: code}. A room, render or design of another
 * session is "not_found".
 *
 * Limits (rate-limit.server.ts): starting an analysis or a render counts
 * per visitor (koshoyClientKey), so a new session does not reset it; status
 * polls and file reads count per session.
 */
import type { KoshoyFile } from "../services/s3.server";
import { koshoyJson, loadSession, readJson, type KoshoyRequestContext } from "./handlers.server";
import { parseLayoutOp, parseOpaqueId, parseRenderRequest, parseRoomPhoto } from "./input";
import { koshoyClientKey } from "./rate-limit.server";
import { designSizes, placedLeftToRight } from "./layout-solver";
import {
  changeLayout,
  currentLayout,
  enterRoom,
  layoutScenes,
  layoutView,
  sessionTarget,
} from "./layout.server";
import {
  readRenderFile,
  renderDescription,
  refreshRender,
  renderView,
  startRender,
} from "./render.server";
import {
  readRoomFile,
  refreshRoom,
  ROOM_FILE_NAMES,
  roomView,
  startRoom,
  type KoshoyRoomDeps,
  type RoomFileName,
} from "./room.server";
import type { KoshoyDesign, KoshoyStore } from "./store.server";

type StudioErrorCode =
  | "unavailable"
  | "rate_limited"
  | "session_expired"
  | "invalid_input"
  | "not_found"
  | "link_expired";

const STATUS_BY_CODE: Record<StudioErrorCode, number> = {
  unavailable: 503,
  rate_limited: 429,
  session_expired: 401,
  invalid_input: 400,
  not_found: 404,
  /** QR phone link used, expired or unknown (phone-handlers.server.ts) */
  link_expired: 410,
};

export function koshoyStudioError(
  code: StudioErrorCode,
  status = STATUS_BY_CODE[code],
): Response {
  return koshoyJson({ error: code }, status);
}

function fileResponse(file: KoshoyFile): Response {
  return new Response(file.bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function roomFileName(value: string | null): RoomFileName | null {
  return (ROOM_FILE_NAMES as readonly (string | null)[]).includes(value)
    ? (value as RoomFileName)
    : null;
}

/* ---------------- POST /room ---------------- */

export async function handleKoshoyRoom(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const input = parseRoomPhoto(body);
    if (!input) return koshoyStudioError("invalid_input");
    if (!ctx.limits.room.hit(koshoyClientKey(ctx.shop, request))) {
      return koshoyStudioError("rate_limited");
    }

    const room = await startRoom(ctx.room, session, input);
    return koshoyJson({ room: roomView(room) });
  } catch (error) {
    console.error("[koshoy] room failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /room-status ---------------- */

export async function handleKoshoyRoomStatus(
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
    const room = await refreshRoom(ctx.room, found);
    if (room.status !== "ready") return koshoyJson({ room: roomView(room) });

    // The chat tools (show_in_room, render_room) use the latest ready room.
    // A session without one also takes it, so a failed write is retried on
    // the next poll; the failure itself must not cost the customer the room.
    const justReady = found.status !== "ready" || !session.roomId;
    if (justReady) {
      await ctx.store.setRoom(session.id, room.id).catch((error) => {
        console.error("[koshoy] session room not saved", error);
      });
    }
    // The room mode starts from this layout (CONTRACT v2.1-1): moved into the
    // room, with the active design in it when it fits.
    const designs = await ctx.store.listDesigns(session.id);
    const sessionNow = justReady ? { ...session, roomId: room.id } : session;
    const { layout, target } = justReady
      ? await enterRoom(ctx.room, sessionNow, designs)
      : await currentLayout(ctx.room, sessionNow, designs);
    return koshoyJson({
      room: roomView(room),
      layout: layoutView(layout, designs, target),
      events: layoutScenes(layout, designs),
    });
  } catch (error) {
    console.error("[koshoy] room status failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- GET /room-file?room=&name= ---------------- */

export async function handleKoshoyRoomFile(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const session = await loadSession(request, ctx, {});
    if (!session) return koshoyStudioError("session_expired");
    const query = new URL(request.url).searchParams;
    const roomId = parseOpaqueId(query.get("room"));
    const name = roomFileName(query.get("name"));
    if (!roomId || !name) return koshoyStudioError("invalid_input");
    if (!ctx.limits.roomRead.hit(session.id)) return koshoyStudioError("rate_limited");

    const room = await ctx.room.db.koshoyRoom.findFirst({
      where: { id: roomId, sessionId: session.id },
    });
    const file = room ? await readRoomFile(ctx.room, room, name) : null;
    return file ? fileResponse(file) : koshoyStudioError("not_found");
  } catch (error) {
    console.error("[koshoy] room file failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /render ---------------- */

/**
 * What the captures show, left to right: every design standing in this
 * room's layout (moved into the room first if it was saved for another
 * one); without one, the design the storefront names. null when a named
 * design is not this session's.
 */
async function renderedDesigns(
  room: KoshoyRoomDeps,
  store: KoshoyStore,
  sessionId: string,
  roomId: string,
  designId: string | undefined,
): Promise<KoshoyDesign[] | null> {
  const designs = await store.listDesigns(sessionId);
  const { layout, target } = await currentLayout(room, { id: sessionId, roomId }, designs);
  const placed = target.roomId === roomId ? placedLeftToRight(layout) : [];
  if (placed.length) {
    return placed
      .map((id) => designs.find((design) => design.id === id))
      .filter((design): design is KoshoyDesign => design !== undefined);
  }
  if (!designId) return [];
  const named = designs.find((design) => design.id === designId);
  return named ? [named] : null;
}

export async function handleKoshoyRender(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const input = parseRenderRequest(body);
    if (!input) return koshoyStudioError("invalid_input");

    const room = await ctx.room.db.koshoyRoom.findFirst({
      where: { id: input.roomId, sessionId: session.id },
    });
    if (!room) return koshoyStudioError("not_found");
    const designs = await renderedDesigns(ctx.room, ctx.store, session.id, room.id, input.designId);
    if (!designs) return koshoyStudioError("not_found");
    if (!designs.length || room.status !== "ready") return koshoyStudioError("invalid_input");
    if (!ctx.limits.render.hit(koshoyClientKey(ctx.shop, request))) {
      return koshoyStudioError("rate_limited");
    }

    const render = await startRender(ctx.room, session, {
      room,
      designs,
      composite: input.composite,
      cabinet: input.cabinet,
      description: renderDescription(ctx.engine, designs),
    });
    return koshoyJson({ render: renderView(render) });
  } catch (error) {
    console.error("[koshoy] render failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /render-status ---------------- */

export async function handleKoshoyRenderStatus(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const renderId = parseOpaqueId(body.renderId);
    if (!renderId) return koshoyStudioError("invalid_input");
    if (!ctx.limits.roomRead.hit(session.id)) return koshoyStudioError("rate_limited");

    const found = await ctx.room.db.koshoyRender.findFirst({
      where: { id: renderId, sessionId: session.id },
    });
    if (!found) return koshoyStudioError("not_found");
    return koshoyJson({ render: renderView(await refreshRender(ctx.room, found)) });
  } catch (error) {
    console.error("[koshoy] render status failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- GET /render-file?render= ---------------- */

export async function handleKoshoyRenderFile(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const session = await loadSession(request, ctx, {});
    if (!session) return koshoyStudioError("session_expired");
    const renderId = parseOpaqueId(new URL(request.url).searchParams.get("render"));
    if (!renderId) return koshoyStudioError("invalid_input");
    if (!ctx.limits.roomRead.hit(session.id)) return koshoyStudioError("rate_limited");

    const render = await ctx.room.db.koshoyRender.findFirst({
      where: { id: renderId, sessionId: session.id },
    });
    const file = render ? await readRenderFile(ctx.room, render) : null;
    return file ? fileResponse(file) : koshoyStudioError("not_found");
  } catch (error) {
    console.error("[koshoy] render file failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /layout {op, designId, place?} ---------------- */

/**
 * A drag, "Odaya ekle" or "×" from the storefront. No busy lock: a turn may
 * run meanwhile; the layout has its own row and versioned saves.
 */
export async function handleKoshoyLayout(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const op = parseLayoutOp(body);
    if (!op) return koshoyStudioError("invalid_input");
    if (!ctx.limits.layout.hit(session.id)) return koshoyStudioError("rate_limited");

    const designs = await ctx.store.listDesigns(session.id);
    if (!designs.some((design) => design.id === op.designId)) return koshoyStudioError("not_found");
    const { target } = await sessionTarget(ctx.room, session, designs);
    const result = await changeLayout(ctx.room.db, session.id, target, designSizes(designs), op);
    if (result.outcome === "not_in_layout") return koshoyStudioError("not_found");
    if (result.outcome === "layout_full" || result.outcome === "wrong_surface") {
      return koshoyStudioError("invalid_input");
    }
    return koshoyJson({
      layout: layoutView(result.layout, designs, target),
      events: layoutScenes(result.layout, designs),
    });
  } catch (error) {
    console.error("[koshoy] layout failed", error);
    return koshoyStudioError("unavailable");
  }
}
