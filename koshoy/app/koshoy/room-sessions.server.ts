/**
 * Room sessions (CONTRACT §2.8, ClickUp z8qu5d7pzv): one KoshoySession per
 * room the customer opens. The browser keeps the tokens of its rooms; a
 * signed-in customer's rooms also belong to their Shopify account
 * (KoshoySession.customerId) and show on every device.
 *
 * Decisions (Fatih, 28 Oct): at most 10 rooms; "Sil" deletes everything,
 * the room photo and the pictures in Sugar S3 too.
 */
import type { KoshoyFileStore } from "../services/s3.server";
import type { KoshoyDataRoom } from "./data.server";
import type { KoshoyRenderRow, KoshoyRoomRow } from "./room.server";
import { toSessionState, type KoshoySessionRow, type KoshoyStore } from "./store.server";

export const MAX_ROOM_SESSIONS = 10;
const UNNAMED_ROOM = "Yeni oda";

/** The slice of the Prisma client the room list and delete use. */
export interface KoshoyRoomSessionsDb {
  koshoySession: {
    findMany(args: {
      where: {
        shop: string;
        expiresAt: { gt: Date };
        OR: Array<{ id: { in: string[] } } | { customerId: string }>;
      };
      orderBy: { updatedAt: "desc" };
      take: number;
    }): Promise<KoshoySessionRow[]>;
    findFirst(args: {
      where: { id: string; shop: string; customerId: string; expiresAt: { gt: Date } };
    }): Promise<KoshoySessionRow | null>;
    /** Cascades to designs, layout, QR links and device keys. */
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  koshoyDesign: {
    count(args: { where: { sessionId: string } }): Promise<number>;
  };
  koshoyRoom: {
    findMany(args: { where: { sessionId: string } }): Promise<Array<Pick<KoshoyRoomRow, "photoKey">>>;
    deleteMany(args: { where: { sessionId: string } }): Promise<{ count: number }>;
  };
  koshoyRender: {
    findMany(args: {
      where: { sessionId: string };
    }): Promise<Array<Pick<KoshoyRenderRow, "compositeKey" | "cabinetKey" | "resultKey">>>;
    deleteMany(args: { where: { sessionId: string } }): Promise<{ count: number }>;
  };
}

export interface KoshoyRoomSessionsDeps {
  db: KoshoyRoomSessionsDb;
  store: KoshoyStore;
  /** Sugar S3; unset when the room photo feature is off (then a session has no files). */
  files?: KoshoyFileStore;
  /** Akın's room types; a room's name comes from them. */
  roomTypes: ReadonlyArray<Pick<KoshoyDataRoom, "id" | "label" | "synonyms">>;
  now?: () => number;
}

/** One line of the room list (CONTRACT §2.8 RoomEntry). */
export interface RoomEntry {
  ref: string;
  key?: string;
  name: string;
  designs: number;
  updatedAt: number;
  photo?: string;
  approved?: true;
  account: boolean;
}

/** The room type the assistant understood, as the customer sees it ("Yatak odası"). */
export function roomTypeName(
  room: string,
  types: KoshoyRoomSessionsDeps["roomTypes"],
): string {
  const text = room.trim();
  if (!text) return UNNAMED_ROOM;
  const lower = text.toLocaleLowerCase("tr-TR");
  const known = types.find(
    (type) =>
      type.id === text ||
      [type.label, ...type.synonyms].some((word) => word.toLocaleLowerCase("tr-TR") === lower),
  );
  if (known) return known.label;
  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}

/** "Salon", "Salon 2", …: rooms of the same type numbered in the order they were opened. */
export function numberRoomNames(rooms: ReadonlyArray<{ type: string; createdAt: number }>): string[] {
  const order = rooms
    .map((room, index) => ({ ...room, index }))
    .sort((a, b) => a.createdAt - b.createdAt);
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (const room of order) {
    const count = (seen.get(room.type) ?? 0) + 1;
    seen.set(room.type, count);
    names[room.index] = count === 1 ? room.type : `${room.type} ${count}`;
  }
  return names;
}

/**
 * The rooms this browser holds (`keys`) plus, for a signed-in customer, the
 * rooms in their account. The browser's ownerless rooms join the account of
 * the customer signed in now (`onAttach` per room). Most recently used first.
 */
export async function listRoomSessions(
  deps: KoshoyRoomSessionsDeps,
  input: {
    shop: string;
    customerId: string | null;
    keys: readonly string[];
    onAttach?: (sessionId: string) => void;
  },
): Promise<RoomEntry[]> {
  const now = deps.now ?? Date.now;
  // session id → this browser's token; a token that no longer opens here is left out.
  const keyOf = new Map<string, string>();
  for (const key of input.keys.slice(0, MAX_ROOM_SESSIONS)) {
    const session = await deps.store.findSession(key, input.shop, input.customerId);
    if (!session || keyOf.has(session.id)) continue;
    keyOf.set(session.id, key);
    if (input.customerId && !session.customerId) {
      await deps.store.attachCustomer(session, input.customerId);
      input.onAttach?.(session.id);
    }
  }
  if (!keyOf.size && !input.customerId) return [];

  const rows = await deps.db.koshoySession.findMany({
    where: {
      shop: input.shop,
      expiresAt: { gt: new Date(now()) },
      OR: [
        { id: { in: [...keyOf.keys()] } },
        ...(input.customerId ? [{ customerId: input.customerId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_ROOM_SESSIONS,
  });
  const counted = await Promise.all(
    rows.map(async (row) => ({
      row,
      session: toSessionState(row),
      designs: await deps.db.koshoyDesign.count({ where: { sessionId: row.id } }),
    })),
  );
  // A room nobody has used yet (page view only) shows only in the browser that opened it,
  // not on the customer's other devices.
  const shown = counted.filter(
    (item) => keyOf.has(item.row.id) || item.designs > 0 || item.session.events.length > 0,
  );
  const names = numberRoomNames(
    shown.map((item) => ({
      type: roomTypeName(item.session.brief.room, deps.roomTypes),
      createdAt: item.row.createdAt.getTime(),
    })),
  );

  return shown.map(({ row, session, designs }, index): RoomEntry => {
    const key = keyOf.get(row.id);
    return {
      ref: row.id,
      ...(key ? { key } : {}),
      name: names[index],
      designs,
      updatedAt: row.updatedAt.getTime(),
      // The photo file needs this room's token, so only rooms this browser holds show it.
      ...(key && session.roomId ? { photo: session.roomId } : {}),
      ...(session.journey.roomApprovedAt !== null ? { approved: true as const } : {}),
      account: Boolean(session.customerId),
    };
  });
}

/**
 * Deletes a room: allowed with the room's own token (`key`) or when the room
 * is in the signed-in customer's account. Files go first: if S3 fails the
 * rows stay, so the customer can try again and nothing is left behind.
 * Returns false when there is no such room for this caller.
 */
export async function deleteRoomSession(
  deps: KoshoyRoomSessionsDeps,
  input: { shop: string; customerId: string | null; ref: string; key: string | null },
): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const byKey = input.key
    ? await deps.store.findSession(input.key, input.shop, input.customerId)
    : null;
  let sessionId = byKey?.id === input.ref ? byKey.id : null;
  if (!sessionId && input.customerId) {
    const row = await deps.db.koshoySession.findFirst({
      where: {
        id: input.ref,
        shop: input.shop,
        customerId: input.customerId,
        expiresAt: { gt: new Date(now()) },
      },
    });
    sessionId = row?.id ?? null;
  }
  if (!sessionId) return false;

  const [rooms, renders] = await Promise.all([
    deps.db.koshoyRoom.findMany({ where: { sessionId } }),
    deps.db.koshoyRender.findMany({ where: { sessionId } }),
  ]);
  const fileKeys = [
    ...rooms.map((room) => room.photoKey),
    ...renders.flatMap((render) => [render.compositeKey, render.cabinetKey, render.resultKey]),
  ].filter((key): key is string => Boolean(key));
  if (fileKeys.length) {
    if (!deps.files) throw new Error("room files cannot be deleted: Sugar S3 is not configured");
    for (const key of fileKeys) await deps.files.delete(key);
  }
  await deps.db.koshoyRender.deleteMany({ where: { sessionId } });
  await deps.db.koshoyRoom.deleteMany({ where: { sessionId } });
  await deps.db.koshoySession.delete({ where: { id: sessionId } });
  return true;
}
