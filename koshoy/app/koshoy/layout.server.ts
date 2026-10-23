/**
 * The session's room layout (CONTRACT v2 §6): which designs stand where, in
 * the analysed room or in the studio in front of a virtual wall.
 *
 * The backend is the source of truth. Every write (a drag, "Odaya ekle",
 * "×", an LLM tool) is an op applied to the latest saved layout with the
 * rules of layout-solver.ts; the version goes up by one. Saves are
 * optimistic (update where version = read version) and retried, so two
 * writers never lose each other's change silently.
 */
import {
  KOSHOY_MAX_LAYOUT_ITEMS,
  toLayoutItem,
  toPublicEvent,
  type LayoutItemView,
  type LayoutPlaceView,
  type LayoutTargetView,
  type PublicEvent,
} from "./events";
import { sceneEvent } from "./design-ops.server";
import {
  applyLayoutOp,
  designDepthM,
  designSizes,
  designWidthM,
  fitStudioTarget,
  layoutTarget,
  placedLeftToRight,
  settleItems,
  targetView,
  type DesignSize,
  type LayoutOp,
  type LayoutOutcome,
  type LayoutState,
  type LayoutTarget,
} from "./layout-solver";
import { parseMeasures, roundedCm } from "./room-measure.server";
import { roomView, type KoshoyRoomDeps, type KoshoyRoomRow } from "./room.server";
import type { KoshoyDesign } from "./store.server";

export { KOSHOY_MAX_LAYOUT_ITEMS };

export interface KoshoyLayoutRow {
  sessionId: string;
  roomId: string | null;
  version: number;
  /** JSON LayoutItemView[] */
  items: string;
  updatedAt: Date;
}

/** The slice of the Prisma client the layout uses. */
export interface KoshoyLayoutDb {
  koshoyLayout: {
    findUnique(args: { where: { sessionId: string } }): Promise<KoshoyLayoutRow | null>;
    create(args: { data: Omit<KoshoyLayoutRow, "updatedAt"> }): Promise<KoshoyLayoutRow>;
    updateMany(args: {
      where: { sessionId: string; version: number };
      data: Pick<KoshoyLayoutRow, "roomId" | "version" | "items">;
    }): Promise<{ count: number }>;
  };
}

/** CONTRACT v2 LayoutView: the layout with each design's label and where it stands. */
export interface LayoutView {
  version: number;
  roomId: string | null;
  items: Array<{ designId: string; label: string; place: LayoutPlaceView | null }>;
  target: LayoutTargetView;
}

export const EMPTY_LAYOUT: LayoutState = { version: 0, roomId: null, items: [] };

/** How often a save is retried when another writer got there first. */
const SAVE_ATTEMPTS = 3;

function parseItems(raw: string): LayoutItemView[] {
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .map(toLayoutItem)
    .filter((item): item is LayoutItemView => item !== null)
    .slice(0, KOSHOY_MAX_LAYOUT_ITEMS);
}

export async function readLayout(db: KoshoyLayoutDb, sessionId: string): Promise<LayoutState> {
  const row = await db.koshoyLayout.findUnique({ where: { sessionId } });
  if (!row) return { ...EMPTY_LAYOUT, items: [] };
  return { version: row.version, roomId: row.roomId, items: parseItems(row.items) };
}

/** Saves `next` as version read.version + 1; false when someone else saved first. */
async function saveLayout(
  db: KoshoyLayoutDb,
  sessionId: string,
  read: LayoutState,
  next: Omit<LayoutState, "version">,
): Promise<LayoutState | null> {
  const saved: LayoutState = { version: read.version + 1, roomId: next.roomId, items: next.items };
  const data = { roomId: saved.roomId, version: saved.version, items: JSON.stringify(saved.items) };
  if (read.version === 0) {
    try {
      await db.koshoyLayout.create({ data: { sessionId, ...data } });
      return saved;
    } catch {
      return null; // created meanwhile (unique sessionId)
    }
  }
  const result = await db.koshoyLayout.updateMany({
    where: { sessionId, version: read.version },
    data,
  });
  return result.count === 1 ? saved : null;
}

/**
 * Applies `change` to the latest layout and saves it. `change` returns the
 * next layout, or null to leave it as it is. Returns the saved layout (or
 * the unchanged one); throws only after SAVE_ATTEMPTS lost races.
 */
export async function updateLayout(
  db: KoshoyLayoutDb,
  sessionId: string,
  change: (current: LayoutState) => Omit<LayoutState, "version"> | null,
): Promise<{ layout: LayoutState; changed: boolean }> {
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    const current = await readLayout(db, sessionId);
    const next = change(current);
    if (!next) return { layout: current, changed: false };
    const saved = await saveLayout(db, sessionId, current, next);
    if (saved) return { layout: saved, changed: true };
  }
  throw new Error("layout save kept losing to other writers");
}

/** Items whose design still exists, each with its label; roomId and target are the current ones. */
export function layoutView(
  layout: LayoutState,
  designs: readonly KoshoyDesign[],
  target: LayoutTarget,
): LayoutView {
  const byId = new Map(designs.map((design) => [design.id, design]));
  return {
    version: layout.version,
    roomId: target.roomId,
    items: layout.items
      .filter((item) => byId.has(item.designId))
      .map((item) => ({
        designId: item.designId,
        label: byId.get(item.designId)!.label,
        place: item.place,
      })),
    target: targetView(target),
  };
}

export function layoutEvent(layout: LayoutState, target: LayoutTarget): PublicEvent | null {
  return toPublicEvent({
    type: "layout",
    version: layout.version,
    items: layout.items,
    target: targetView(target),
  });
}

/**
 * The layout block of the model instructions: designs left to right with
 * their stretch of the wall in cm from its left end (rounded to 10 cm), or
 * on the floor when there is no wall, then the ones not standing anywhere.
 */
export function layoutFactsForModel(
  layout: LayoutState,
  designs: readonly KoshoyDesign[],
  wall: { fromM: number } | null,
  inRoom: boolean,
): Record<string, unknown> {
  const byId = new Map(designs.map((design) => [design.id, design]));
  const items: Record<string, unknown>[] = [];
  for (const designId of placedLeftToRight(layout)) {
    const design = byId.get(designId);
    const place = layout.items.find((item) => item.designId === designId)?.place;
    if (!design || !place) continue;
    const base = { designId, label: design.label };
    if (place.surface === "wall" && wall) {
      const half = designWidthM(design) / 2;
      items.push({
        ...base,
        fromCm: roundedCm(place.alongM - half - wall.fromM),
        toCm: roundedCm(place.alongM + half - wall.fromM),
      });
    } else {
      items.push({ ...base, onFloor: true });
    }
  }
  const waiting = layout.items
    .filter((item) => item.place === null && byId.has(item.designId))
    .map((item) => ({ designId: item.designId, label: byId.get(item.designId)!.label }));
  return {
    where: inRoom ? "müşterinin odası" : "stüdyo (arkada boş duvar)",
    leftToRight: items,
    ...(waiting.length ? { noFreeSpot: waiting } : {}),
    maxDesigns: KOSHOY_MAX_LAYOUT_ITEMS,
  };
}

/**
 * Settles the saved layout onto `target` and applies `op` (if any), then
 * saves it as the next version. Every call saves, so the storefront always
 * gets an answer newer than its own guess (a refused drag snaps back).
 */
export async function changeLayout(
  db: KoshoyLayoutDb,
  sessionId: string,
  target: LayoutTarget,
  sizes: ReadonlyMap<string, DesignSize>,
  op?: LayoutOp,
): Promise<{ layout: LayoutState; outcome: LayoutOutcome | null; place: LayoutPlaceView | null }> {
  let outcome: LayoutOutcome | null = null;
  let place: LayoutPlaceView | null = null;
  const { layout } = await updateLayout(db, sessionId, (current) => {
    const settled = settleItems(current.items, target, sizes);
    if (!op) return { roomId: target.roomId, items: settled };
    const result = applyLayoutOp(settled, op, target, sizes);
    outcome = result.outcome;
    place = result.place;
    return { roomId: target.roomId, items: result.items };
  });
  return { layout, outcome, place };
}

/* ---------------- the session's layout ---------------- */

/** The session's ready room (if any) and where its layout stands; the studio wall grows to fit `designs`. */
export async function sessionTarget(
  deps: KoshoyRoomDeps,
  session: { id: string; roomId: string | null },
  designs: readonly KoshoyDesign[],
): Promise<{ target: LayoutTarget; room: KoshoyRoomRow | null }> {
  const row = session.roomId
    ? await deps.db.koshoyRoom.findFirst({ where: { id: session.roomId, sessionId: session.id } })
    : null;
  const room = row?.status === "ready" ? row : null;
  const free = room ? parseMeasures(room.measures)?.free ?? [] : [];
  return { target: fitStudioTarget(layoutTarget(room ? roomView(room) : null, free), designSizes(designs)), room };
}

/**
 * The layout as it stands now. A layout saved for another room (a new
 * photo was analysed since) is refitted onto the current one first.
 */
export async function currentLayout(
  deps: KoshoyRoomDeps,
  session: { id: string; roomId: string | null },
  designs: readonly KoshoyDesign[],
): Promise<{ layout: LayoutState; target: LayoutTarget; room: KoshoyRoomRow | null }> {
  const { target, room } = await sessionTarget(deps, session, designs);
  let layout = await readLayout(deps.db, session.id);
  if (layout.items.length && layout.roomId !== target.roomId) {
    layout = (await changeLayout(deps.db, session.id, target, designSizes(designs))).layout;
  }
  return { layout, target, room };
}

/** Scene events of the designs standing in the layout, so the storefront can draw each one. */
export function layoutScenes(layout: LayoutState, designs: readonly KoshoyDesign[]): PublicEvent[] {
  const inLayout = new Set(layout.items.map((item) => item.designId));
  return designs
    .filter((design) => inLayout.has(design.id))
    .map(sceneEvent)
    .filter((event): event is PublicEvent => event !== null);
}

/**
 * After a design changed size: re-settles the layout when that design stands
 * in it (neighbours move as little as possible, settleRow). `designs` holds
 * the design's new version. null when the layout did not have to change.
 */
export async function settleAfterResize(
  deps: KoshoyRoomDeps,
  session: { id: string; roomId: string | null },
  designs: readonly KoshoyDesign[],
  before: KoshoyDesign,
  after: KoshoyDesign,
): Promise<{ layout: LayoutState; target: LayoutTarget } | null> {
  const resized =
    designWidthM(before) !== designWidthM(after) || designDepthM(before) !== designDepthM(after);
  if (!resized) return null;
  const { layout, target } = await currentLayout(deps, session, designs);
  if (!layout.items.some((item) => item.designId === after.id)) return null;
  return { layout: (await changeLayout(deps.db, session.id, target, designSizes(designs))).layout, target };
}


/**
 * A room just became ready (room-status, CONTRACT v2.1-1): the layout moves
 * into it (refit) and the active design walks in when it fits. Returns the
 * layout the storefront starts its room mode from (possibly empty).
 */
export async function enterRoom(
  deps: KoshoyRoomDeps,
  session: { id: string; roomId: string | null; activeDesignId: string | null },
  designs: readonly KoshoyDesign[],
): Promise<{ layout: LayoutState; target: LayoutTarget }> {
  const { layout, target } = await currentLayout(deps, session, designs);
  const active = session.activeDesignId;
  const standing = layout.items.some((item) => item.designId === active);
  if (target.roomId === null || !active || standing || !designs.some((design) => design.id === active)) {
    return { layout, target };
  }
  const added = await changeLayout(deps.db, session.id, target, designSizes(designs), { op: "add", designId: active });
  return { layout: added.layout, target };
}
