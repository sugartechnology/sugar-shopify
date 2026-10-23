/**
 * The room layout in the chat (CONTRACT v2 §6): the tools show_in_room,
 * render_room, place_in_room and remove_from_room, the room and layout
 * blocks of every hop, the room photo (once per room) and the layout
 * changes other tools cause (a new design enters the room, a wider design
 * pushes its neighbours). turn.server.ts calls these; it only offers the
 * tools while the room feature is configured.
 */
import {
  designSizes,
  gapAround,
  samePlace,
  PLACE_ERROR_HINTS,
  wantedPlace,
  type LayoutOp,
  type LayoutState,
  type LayoutTarget,
  type PlaceRequest,
} from "./layout-solver";
import {
  changeLayout,
  currentLayout,
  layoutEvent,
  layoutFactsForModel,
  settleAfterResize,
} from "./layout.server";
import {
  fitFor,
  measureBand,
  parseMeasures,
  roomFactsForModel,
  roundedCm,
  TIGHT_FIT_SENTENCE,
} from "./room-measure.server";
import type { KoshoyRoomDeps, KoshoyRoomRow } from "./room.server";
import type { KoshoyDesign, KoshoySessionState, KoshoyStore } from "./store.server";

export interface RoomToolContext {
  session: KoshoySessionState;
  store: KoshoyStore;
  room: KoshoyRoomDeps;
  /** Whitelists and emits a public event (turn.server.ts). */
  publish(raw: unknown): void;
}

/** The reasons a room tool gives the model; product language. */
const HINTS = {
  ...PLACE_ERROR_HINTS,
  no_floor: "Bu fotoğrafta zemin bulunamadı; müşteriden odanın zeminini de gösteren başka bir fotoğraf iste.",
  no_space: "Odada bu tasarım için boş yer yok; başka bir tasarımı odadan çıkarmayı ya da daha dar bir tasarım önermeyi düşün.",
  layout_full: "Odada en çok 8 tasarım olabilir; önce birini odadan çıkarmak gerekir.",
  design_not_found: "Böyle bir tasarım yok.",
  not_placed: "Tasarım şu an odaya yerleştirilemedi; müşteriye elle sürükleyebileceğini söyle.",
  unchanged:
    "Tasarımın yeri değişmedi: istenen yer zaten bu ya da yakında boş yer yok. Müşteriye yerleştirdim deme; fotoğrafta başka bir nokta seç (zeminde photo_x ve photoY) ya da elle sürükleyebileceğini söyle.",
} as const;

/**
 * Why the room tools cannot work on the photo: no ready room yet, or a
 * ready room whose photo has no usable floor (the 3D view stays in the studio).
 */
function roomProblem(room: KoshoyRoomRow | null, target: LayoutTarget): "no_room" | "no_floor" | null {
  if (!room) return "no_room";
  return target.roomId === null ? "no_floor" : null;
}

const MOVED_NEARBY_NOTE = "İstenen yer doluydu ya da duvarın dışındaydı; en yakın boş yere koydum.";
const RENDER_STARTED_NOTE = "Görsel hazırlanıyor; hazır olunca sohbette görünecek.";

/** The models' photo limit (decor-ai responses: 2 MB). */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const PLACE_AT = ["free", "left_of", "right_of", "photo_x", "wall_cm", "floor"] as const;
const ALIGNS = ["center", "left_edge", "right_edge"] as const;

function placeRequest(args: Record<string, unknown>): PlaceRequest {
  return {
    at: oneOf(args.at, PLACE_AT) ?? "free",
    refDesignId: str(args.refDesignId) || undefined,
    photoX: num(args.photoX),
    photoY: num(args.photoY),
    wallCm: num(args.wallCm),
    align: oneOf(args.align, ALIGNS),
    rotateDeg: num(args.rotateDeg),
  };
}

async function designFor(ctx: RoomToolContext, designId: string): Promise<KoshoyDesign | null> {
  const id = designId || ctx.session.activeDesignId;
  return id ? ctx.store.getDesign(ctx.session.id, id) : null;
}

/** The layout block of the tool results: designs left to right with their stretch of wall. */
function layoutFacts(layout: LayoutState, designs: readonly KoshoyDesign[], target: LayoutTarget) {
  return layoutFactsForModel(
    layout,
    designs,
    target.surface === "wall" ? target.bounds : null,
    target.roomId !== null,
  ).leftToRight;
}

/** "Sınırda…" when the cabinet's margin in its stretch of wall is inside the measurement band. */
function fitNotes(
  layout: LayoutState,
  target: LayoutTarget,
  designs: readonly KoshoyDesign[],
  room: KoshoyRoomRow | null,
  designId: string,
): string[] {
  if (target.roomId === null || !room) return [];
  const sizes = designSizes(designs);
  const gap = gapAround(layout, target, sizes, designId);
  const width = sizes.get(designId)?.widthM;
  if (gap === null || width === undefined) return [];
  return fitFor(gap, width, measureBand(room.scaleSource)) === "rahat" ? [] : [TIGHT_FIT_SENTENCE];
}

async function placeInRoom(ctx: RoomToolContext, args: Record<string, unknown>) {
  const design = await designFor(ctx, str(args.designId));
  if (!design) return { ok: false, error: "design_not_found", hint: HINTS.design_not_found };
  const designs = await ctx.store.listDesigns(ctx.session.id);
  const { layout, target, room } = await currentLayout(ctx.room, ctx.session, designs);
  // A ready room without a floor: nothing can stand in it (no studio fallback either).
  if (roomProblem(room, target) === "no_floor") return { ok: false, error: "no_floor", hint: HINTS.no_floor };
  const sizes = designSizes(designs);
  const wanted = wantedPlace(target, layout.items, sizes, design.id, placeRequest(args));
  if (wanted.error) return { ok: false, error: wanted.error, hint: HINTS[wanted.error] };

  const standing = layout.items.some((item) => item.designId === design.id);
  const op: LayoutOp =
    wanted.place && standing
      ? { op: "move", designId: design.id, place: wanted.place }
      : { op: "add", designId: design.id, ...(wanted.place ? { place: wanted.place } : {}) };
  const result = await changeLayout(ctx.room.db, ctx.session.id, target, sizes, op);
  ctx.publish(layoutEvent(result.layout, target));
  if (result.outcome === "no_space" || result.outcome === "layout_full") {
    return { ok: false, error: result.outcome, hint: HINTS[result.outcome] };
  }
  if (result.outcome !== "placed" && result.outcome !== "moved_nearby") {
    return { ok: false, error: "not_placed", hint: HINTS.not_placed };
  }
  // Same spot as before: the model must not say it moved anything (CONTRACT v2.2-6).
  const before = layout.items.find((item) => item.designId === design.id)?.place;
  if (before && result.place && samePlace(before, result.place)) {
    return { ok: false, error: "unchanged", hint: HINTS.unchanged };
  }

  const notes = [...wanted.notes];
  if (result.outcome === "moved_nearby") notes.push(MOVED_NEARBY_NOTE);
  notes.push(...fitNotes(result.layout, target, designs, room, design.id));
  const place = result.place;
  const width = sizes.get(design.id)!.widthM;
  return {
    ok: true,
    place:
      place?.surface === "wall" && target.surface === "wall"
        ? {
            fromCm: roundedCm(place.alongM - width / 2 - target.bounds.fromM),
            toCm: roundedCm(place.alongM + width / 2 - target.bounds.fromM),
          }
        : { onFloor: true, rotateDeg: place?.surface === "floor" ? Math.round(place.rotDeg) : 0 },
    ...(notes.length ? { notes } : {}),
    layout: layoutFacts(result.layout, designs, target),
    ...(target.surface === "wall"
      ? { wall: { fromCm: 0, toCm: roundedCm(target.bounds.toM - target.bounds.fromM) } }
      : {}),
  };
}

async function removeFromRoom(ctx: RoomToolContext, args: Record<string, unknown>) {
  const design = await designFor(ctx, str(args.designId));
  if (!design) return { ok: false, error: "design_not_found", hint: HINTS.design_not_found };
  const designs = await ctx.store.listDesigns(ctx.session.id);
  const { target } = await currentLayout(ctx.room, ctx.session, designs);
  const result = await changeLayout(ctx.room.db, ctx.session.id, target, designSizes(designs), {
    op: "remove",
    designId: design.id,
  });
  ctx.publish(layoutEvent(result.layout, target));
  return { ok: true, layout: layoutFacts(result.layout, designs, target) };
}

/**
 * show_in_room: the design enters the room if it is not there yet, then the
 * storefront shows the room. render_room: the storefront captures every
 * cabinet in the room and asks for the realistic picture.
 */
async function showOrRender(ctx: RoomToolContext, name: "show_in_room" | "render_room", args: Record<string, unknown>) {
  const design = await designFor(ctx, str(args.designId));
  if (!design) return { ok: false, error: "design_not_found", hint: HINTS.design_not_found };
  // The model never gets the photo through a tool, only whether one is ready.
  const designs = await ctx.store.listDesigns(ctx.session.id);
  const { layout, target, room } = await currentLayout(ctx.room, ctx.session, designs);
  const problem = roomProblem(room, target);
  if (problem) return { ok: false, error: problem, hint: HINTS[problem] };

  const notes: string[] = [];
  if (!layout.items.some((item) => item.designId === design.id)) {
    const added = await changeLayout(ctx.room.db, ctx.session.id, target, designSizes(designs), {
      op: "add",
      designId: design.id,
    });
    ctx.publish(layoutEvent(added.layout, target));
    if (added.outcome === "no_space" || added.outcome === "layout_full") notes.push(HINTS[added.outcome]);
  }
  if (name === "show_in_room") {
    ctx.publish({ type: "room_show", designId: design.id });
    return { ok: true, ...(notes.length ? { notes } : {}) };
  }
  ctx.publish({ type: "render_request", designId: design.id });
  return { ok: true, note: RENDER_STARTED_NOTE, ...(notes.length ? { notes } : {}) };
}

export async function runRoomTool(
  ctx: RoomToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (name === "place_in_room") return placeInRoom(ctx, args);
  if (name === "remove_from_room") return removeFromRoom(ctx, args);
  if (name === "show_in_room" || name === "render_room") return showOrRender(ctx, name, args);
  return { ok: false, error: "unsupported_tool" };
}

/**
 * A newly planned design enters the analysed room when there is a free spot
 * (Fatih, 21 Ekim). Without a ready room nothing happens: the studio keeps
 * today's single design view. Returns what to tell the model, or null.
 */
export async function addNewDesignToRoom(ctx: RoomToolContext, design: KoshoyDesign): Promise<string | null> {
  if (!ctx.session.roomId) return null;
  const designs = await ctx.store.listDesigns(ctx.session.id);
  const { target } = await currentLayout(ctx.room, ctx.session, designs);
  if (target.roomId === null) return null;
  const result = await changeLayout(ctx.room.db, ctx.session.id, target, designSizes(designs), {
    op: "add",
    designId: design.id,
  });
  ctx.publish(layoutEvent(result.layout, target));
  if (result.outcome === "placed" || result.outcome === "moved_nearby") return "Tasarım odaya yerleşti.";
  return result.outcome === "layout_full" ? HINTS.layout_full : HINTS.no_space;
}

/**
 * A planned room set stands together: each design goes into the layout, in
 * the room when one is ready, in front of the studio wall otherwise. Returns
 * a note for the model when some of them found no place.
 */
export async function addSetToLayout(ctx: RoomToolContext, added: readonly KoshoyDesign[]): Promise<string | null> {
  const designs = await ctx.store.listDesigns(ctx.session.id);
  const { target, room } = await currentLayout(ctx.room, ctx.session, designs);
  if (roomProblem(room, target) === "no_floor") return HINTS.no_floor;
  const sizes = designSizes(designs);
  let last: Awaited<ReturnType<typeof changeLayout>> | null = null;
  let missed = 0;
  for (const design of added) {
    last = await changeLayout(ctx.room.db, ctx.session.id, target, sizes, { op: "add", designId: design.id });
    if (last.outcome !== "placed" && last.outcome !== "moved_nearby") missed += 1;
  }
  if (last) ctx.publish(layoutEvent(last.layout, target));
  if (!missed) return null;
  return last?.outcome === "layout_full" ? HINTS.layout_full : HINTS.no_space;
}

/** After an edit changed a design's size: its neighbours in the room move as little as possible. */
export async function settleRoomAfterEdit(ctx: RoomToolContext, before: KoshoyDesign, after: KoshoyDesign) {
  const designs = await ctx.store.listDesigns(ctx.session.id);
  const settled = await settleAfterResize(ctx.room, ctx.session, designs, before, after);
  if (settled) ctx.publish(layoutEvent(settled.layout, settled.target));
}

/**
 * The room and layout blocks for one hop, and the room photo when this
 * model conversation has not seen it yet (sent with a customer message only).
 */
export async function roomHopContext(
  ctx: RoomToolContext,
  designs: readonly KoshoyDesign[],
  withMessage: boolean,
): Promise<{
  room: Record<string, unknown> | null;
  /** A ready room with a usable floor: room sizes may be told (approximately). */
  roomReady: boolean;
  layout: Record<string, unknown>;
  /** Set only when this model conversation has not seen the room yet; mark it seen after a clean hop. */
  photo: { contentBase64: string; mimeType: string; roomId: string } | null;
}> {
  const { layout, target, room } = await currentLayout(ctx.room, ctx.session, designs);
  const roomReady = roomProblem(room, target) === null;
  const measures = room && roomReady ? parseMeasures(room.measures) : null;
  const sizes = designSizes(designs);
  let roomFacts: Record<string, unknown> | null = null;
  if (room && !roomReady) {
    // A photo without a usable floor: say so, never "upload a photo".
    roomFacts = { floor: HINTS.no_floor };
  } else if (room && measures) {
    roomFacts = roomFactsForModel(
      measures,
      room.scaleSource,
      designs.map((design) => ({ id: design.id, label: design.label, widthM: sizes.get(design.id)!.widthM })),
    );
  }
  const layoutBlock = layoutFactsForModel(
    layout,
    designs,
    target.surface === "wall" ? target.bounds : null,
    target.roomId !== null,
  );

  let photo: { contentBase64: string; mimeType: string; roomId: string } | null = null;
  if (withMessage && room && ctx.session.photoSentRoomId !== room.id) {
    const file = await ctx.room.files.get(room.photoKey).catch((error) => {
      console.error("[koshoy] room photo not read for the model", error);
      return null;
    });
    if (file && file.bytes.length <= MAX_PHOTO_BYTES) {
      const contentBase64 = Buffer.from(file.bytes).toString("base64");
      photo = { contentBase64, mimeType: "image/jpeg", roomId: room.id };
    }
  }
  return { room: roomFacts, roomReady, layout: layoutBlock, photo };
}
