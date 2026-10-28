/**
 * Item removal in the chat (CONTRACT §2.9, §5 photo_items): the tool
 * offer_photo_cleanup, the photo items in the room facts and which photo the
 * model sees. The assistant never removes anything: it only opens the card,
 * the customer's button does the rest (room-clean-handlers.server.ts).
 */
import { MAX_PHOTO_ITEMS, parseStoredPhotoItems, photoItemsForModel } from "./photo-items";
import { cleanView, type KoshoyRoomCleanRow } from "./room-clean.server";
import type { RoomToolContext } from "./room-tools.server";
import { imageType, type KoshoyRoomDeps, type KoshoyRoomRow } from "./room.server";

/**
 * offer_photo_cleanup {preselect?}: opens the removal card with the items
 * the model suggests already ticked. Ids that are not this photo's drop.
 */
export async function offerPhotoCleanup(
  ctx: RoomToolContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const room = ctx.session.roomId
    ? await ctx.room.db.koshoyRoom.findFirst({ where: { id: ctx.session.roomId, sessionId: ctx.session.id } })
    : null;
  if (room?.status !== "ready") return { ok: false, reason: "no_room" };
  const items = parseStoredPhotoItems(room.objects) ?? [];
  if (!items.length) return { ok: false, reason: "no_items" };

  const known = new Set(items.map((item) => item.id));
  const wanted = Array.isArray(args.preselect) ? args.preselect : [];
  const preselect = [...new Set(wanted.filter((id): id is string => typeof id === "string" && known.has(id)))];
  ctx.publish({ type: "photo_items", preselect: preselect.slice(0, MAX_PHOTO_ITEMS) });
  return { ok: true, shown: true, items: items.map((item) => ({ id: item.id, label: item.label })) };
}

/** The room facts' photo part: what is in the photo and what was removed. No measurements. */
export function photoFactsForModel(
  room: KoshoyRoomRow,
  clean: KoshoyRoomCleanRow | null,
): Record<string, unknown> {
  const items = parseStoredPhotoItems(room.objects);
  if (!items?.length) return {};
  const removedIds = new Set(clean ? cleanView(clean).objectIds : []);
  const removed = items.filter((item) => removedIds.has(item.id)).map((item) => item.label);
  return { photoItems: photoItemsForModel(items), ...(removed.length ? { removed } : {}) };
}

/**
 * Which photo the model has seen: the room, or the room with one clean.
 * A room without a clean keeps the plain room id, as before this feature.
 */
export function photoSeenKey(room: KoshoyRoomRow, clean: KoshoyRoomCleanRow | null): string {
  return clean ? `${room.id}:${clean.id}` : room.id;
}

/** The photo the customer sees now: the ready clean's, else the original. null when unreadable. */
export async function currentPhotoBytes(
  deps: KoshoyRoomDeps,
  room: KoshoyRoomRow,
  clean: KoshoyRoomCleanRow | null,
): Promise<Uint8Array | null> {
  if (clean?.photoUrl) {
    const file = await deps.download(clean.photoUrl);
    return file && imageType(file.bytes) === "image/jpeg" ? file.bytes : null;
  }
  return (await deps.files.get(room.photoKey))?.bytes ?? null;
}
