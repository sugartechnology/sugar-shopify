/**
 * In-memory KoshoyDb for tests. Behaves like the Prisma delegates the store
 * uses (unique tokenHash, cascade delete, conditional updateMany).
 */
import type { KoshoyLayoutRow } from "./layout.server";
import type { KoshoyPhoneLinkDb, KoshoyPhoneLinkRow } from "./phone-link.server";
import type { KoshoyRoomCleanRow } from "./room-clean.server";
import { measureRoom } from "./room-measure.server";
import type { KoshoyRenderRow, KoshoyRoomDb, KoshoyRoomRow, RoomPlanes } from "./room.server";
import type { KoshoyRoomSessionsDb } from "./room-sessions.server";
import type {
  KoshoyDb,
  KoshoyDesignRow,
  KoshoySessionKeyRow,
  KoshoySessionRow,
} from "./store.server";

export function createMemoryKoshoyDb(now: () => number = Date.now) {
  const sessions = new Map<string, KoshoySessionRow>();
  const designs = new Map<string, KoshoyDesignRow>();
  const keys = new Map<string, KoshoySessionKeyRow>();
  let tick = 0;
  // Strictly increasing timestamps keep createdAt ordering deterministic.
  const stamp = () => new Date(now() + (tick += 1) / 1000);

  const db: KoshoyDb = {
    koshoySession: {
      async create({ data }) {
        for (const row of sessions.values()) {
          if (row.tokenHash === data.tokenHash) throw new Error("unique tokenHash");
        }
        const row: KoshoySessionRow = { ...data, roomId: null, createdAt: stamp(), updatedAt: stamp() };
        sessions.set(row.id, row);
        return { ...row };
      },
      async findUnique({ where }) {
        if ("id" in where) {
          const row = sessions.get(where.id);
          return row ? { ...row } : null;
        }
        for (const row of sessions.values()) {
          if (row.tokenHash === where.tokenHash) return { ...row };
        }
        return null;
      },
      async update({ where, data }) {
        const row = sessions.get(where.id);
        if (!row) throw new Error("record not found");
        Object.assign(row, data, { updatedAt: stamp() });
        return { ...row };
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [id, row] of sessions) {
          if (row.expiresAt.getTime() < where.expiresAt.lt.getTime()) {
            sessions.delete(id);
            for (const [designId, design] of designs) {
              if (design.sessionId === id) designs.delete(designId);
            }
            for (const [hash, key] of keys) {
              if (key.sessionId === id) keys.delete(hash);
            }
            count += 1;
          }
        }
        return { count };
      },
    },
    koshoySessionKey: {
      async findUnique({ where }) {
        const row = keys.get(where.tokenHash);
        return row ? { ...row } : null;
      },
      async create({ data }) {
        if (keys.has(data.tokenHash)) throw new Error("unique tokenHash");
        if (!sessions.has(data.sessionId)) throw new Error("foreign key");
        const row: KoshoySessionKeyRow = { ...data, createdAt: stamp() };
        keys.set(row.tokenHash, row);
        return { ...row };
      },
      async findMany({ where }) {
        return [...keys.values()]
          .filter((row) => row.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((row) => ({ ...row }));
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const hash of where.tokenHash.in) {
          if (keys.delete(hash)) count += 1;
        }
        return { count };
      },
    },
    koshoyDesign: {
      async create({ data }) {
        if (!sessions.has(data.sessionId)) throw new Error("foreign key");
        const row: KoshoyDesignRow = { ...data, createdAt: stamp(), updatedAt: stamp() };
        designs.set(row.id, row);
        return { ...row };
      },
      async findMany({ where }) {
        return [...designs.values()]
          .filter((row) => row.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((row) => ({ ...row }));
      },
      async findFirst({ where }) {
        const row = designs.get(where.id);
        return row && row.sessionId === where.sessionId ? { ...row } : null;
      },
      async updateMany({ where, data }) {
        const row = designs.get(where.id);
        if (!row || row.sessionId !== where.sessionId || row.version !== where.version) {
          return { count: 0 };
        }
        Object.assign(row, data, { updatedAt: stamp() });
        return { count: 1 };
      },
      async deleteMany({ where }) {
        const row = designs.get(where.id);
        if (!row || row.sessionId !== where.sessionId) return { count: 0 };
        designs.delete(where.id);
        return { count: 1 };
      },
    },
  };

  return { db, sessions, designs, keys };
}

/**
 * In-memory KoshoyRoom / KoshoyRender tables (create, findFirst by id +
 * session, findMany by session, update), KoshoyRoomClean (by id + room, by
 * room) and KoshoyLayout (unique sessionId, conditional updateMany).
 */
export function createMemoryRoomDb(now: () => number = Date.now) {
  function table<Row extends { id: string; sessionId: string; createdAt: Date; updatedAt: Date }>() {
    const rows = new Map<string, Row>();
    return {
      rows,
      async create({ data }: { data: Omit<Row, "createdAt" | "updatedAt"> }) {
        const row = { ...data, createdAt: new Date(now()), updatedAt: new Date(now()) } as Row;
        rows.set(row.id, row);
        return { ...row };
      },
      async findFirst({ where }: { where: { id: string; sessionId: string } }) {
        const row = rows.get(where.id);
        return row && row.sessionId === where.sessionId ? { ...row } : null;
      },
      async findMany({ where }: { where: { sessionId: string } }) {
        return [...rows.values()].filter((row) => row.sessionId === where.sessionId).map((row) => ({ ...row }));
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
        const row = rows.get(where.id);
        if (!row) throw new Error("record not found");
        Object.assign(row, data, { updatedAt: new Date(now()) });
        return { ...row };
      },
    };
  }

  const layouts = new Map<string, KoshoyLayoutRow>();
  const koshoyLayout: KoshoyRoomDb["koshoyLayout"] = {
    async findUnique({ where }) {
      const row = layouts.get(where.sessionId);
      return row ? { ...row } : null;
    },
    async create({ data }) {
      if (layouts.has(data.sessionId)) throw new Error("unique sessionId");
      const row = { ...data, updatedAt: new Date(now()) };
      layouts.set(row.sessionId, row);
      return { ...row };
    },
    async updateMany({ where, data }) {
      const row = layouts.get(where.sessionId);
      if (!row || row.version !== where.version) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(now()) });
      return { count: 1 };
    },
  };

  const cleans = new Map<string, KoshoyRoomCleanRow>();
  const koshoyRoomClean: KoshoyRoomDb["koshoyRoomClean"] = {
    async create({ data }) {
      const row = { ...data, createdAt: new Date(now()), updatedAt: new Date(now()) };
      cleans.set(row.id, row);
      return { ...row };
    },
    async findFirst({ where }) {
      const row = cleans.get(where.id);
      return row && row.roomId === where.roomId ? { ...row } : null;
    },
    async findMany({ where }) {
      return [...cleans.values()].filter((row) => row.roomId === where.roomId).map((row) => ({ ...row }));
    },
    async update({ where, data }) {
      const row = cleans.get(where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date(now()) });
      return { ...row };
    },
  };

  const koshoyRoom = table<KoshoyRoomRow>();
  const koshoyRender = table<KoshoyRenderRow>();
  const db: KoshoyRoomDb = { koshoyRoom, koshoyRender, koshoyLayout, koshoyRoomClean };
  return { db, rooms: koshoyRoom.rows, renders: koshoyRender.rows, layouts, cleans };
}

/**
 * The room list / delete slice over the in-memory session, design, room and
 * render tables (findMany with the id-or-customer OR, delete with cascade).
 */
export function createMemoryRoomSessionsDb(
  koshoy: ReturnType<typeof createMemoryKoshoyDb>,
  rooms: ReturnType<typeof createMemoryRoomDb> = createMemoryRoomDb(),
): KoshoyRoomSessionsDb {
  const { sessions, designs, keys } = koshoy;
  const bySession = <Row extends { sessionId: string }>(table: Map<string, Row>, sessionId: string) =>
    [...table.entries()].filter(([, row]) => row.sessionId === sessionId);
  return {
    koshoySession: {
      async findMany({ where, orderBy, take }) {
        void orderBy;
        return [...sessions.values()]
          .filter(
            (row) =>
              row.shop === where.shop &&
              row.expiresAt.getTime() > where.expiresAt.gt.getTime() &&
              where.OR.some((match) =>
                "customerId" in match ? row.customerId === match.customerId : match.id.in.includes(row.id),
              ),
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, take)
          .map((row) => ({ ...row }));
      },
      async findFirst({ where }) {
        const row = sessions.get(where.id);
        const match =
          row &&
          row.shop === where.shop &&
          row.customerId === where.customerId &&
          row.expiresAt.getTime() > where.expiresAt.gt.getTime();
        return match ? { ...row } : null;
      },
      async delete({ where }) {
        if (!sessions.delete(where.id)) throw new Error("record not found");
        for (const [id] of bySession(designs, where.id)) designs.delete(id);
        for (const [hash] of bySession(keys, where.id)) keys.delete(hash);
        rooms.layouts.delete(where.id);
      },
    },
    koshoyDesign: {
      async count({ where }) {
        return bySession(designs, where.sessionId).length;
      },
    },
    koshoyRoom: {
      async findMany({ where }) {
        return bySession(rooms.rooms, where.sessionId).map(([, row]) => ({ ...row }));
      },
      async deleteMany({ where }) {
        const gone = bySession(rooms.rooms, where.sessionId);
        for (const [id] of gone) rooms.rooms.delete(id);
        return { count: gone.length };
      },
    },
    koshoyRender: {
      async findMany({ where }) {
        return bySession(rooms.renders, where.sessionId).map(([, row]) => ({ ...row }));
      },
      async deleteMany({ where }) {
        const gone = bySession(rooms.renders, where.sessionId);
        for (const [id] of gone) rooms.renders.delete(id);
        return { count: gone.length };
      },
    },
  };
}

/**
 * A ready room for tests: 1600×1200 photo, camera 1.3 m above the floor,
 * a wall 3.1 m straight ahead (so the visible wall is about ±1.84 m), and
 * measurements made the same way refreshRoom makes them (no mask files).
 */
export function sampleReadyRoom(id: string, sessionId: string, shop = "koshoy.myshopify.com"): KoshoyRoomRow {
  const camera = { fovXDegrees: 60, fovYDegrees: 47.9, aspect: 1.3333, fx: 1385.6, fy: 1385.6, cx: 800, cy: 600 };
  const planes: RoomPlanes = {
    floor: { normal: [0, -1, 0], equation: [0, -1, 0, 1.3] },
    wall: { normal: [0, 0, -1], equation: [0, 0, -1, 3.1] },
  };
  const depthScale = { min: 0.8, max: 6.4 };
  const measures = measureRoom(
    { width: 1600, height: 1200, camera, planes, depthScale },
    { depth: null, furniture: null, ceiling: null },
  );
  return {
    id,
    sessionId,
    shop,
    status: "ready",
    error: null,
    jobId: "job",
    photoKey: `koshoy-studio/rooms/${id}/photo.jpg`,
    consentAt: null,
    width: 1600,
    height: 1200,
    camera: JSON.stringify(camera),
    planes: JSON.stringify(planes),
    depthScale: JSON.stringify(depthScale),
    fileUrls: JSON.stringify({ depth: "https://x/depth.png" }),
    scaleSource: "exif",
    measures: JSON.stringify(measures),
    objects: null,
    activeCleanId: null,
    readyCleanId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * In-memory KoshoyPhoneLink table: unique tokenHash, conditional
 * updateMany (the claim), the two deleteMany filters the link uses.
 */
export function createMemoryPhoneDb(now: () => number = Date.now) {
  const links = new Map<string, KoshoyPhoneLinkRow>();
  const db: KoshoyPhoneLinkDb = {
    koshoyPhoneLink: {
      async create({ data }) {
        for (const row of links.values()) {
          if (row.tokenHash === data.tokenHash) throw new Error("unique tokenHash");
        }
        const row = { ...data, createdAt: new Date(now()) };
        links.set(row.id, row);
        return { ...row };
      },
      async findUnique({ where }) {
        for (const row of links.values()) {
          if (row.tokenHash === where.tokenHash) return { ...row };
        }
        return null;
      },
      async findFirst({ where }) {
        const row = links.get(where.id);
        return row && row.sessionId === where.sessionId ? { ...row } : null;
      },
      async update({ where, data }) {
        const row = links.get(where.id);
        if (!row) throw new Error("record not found");
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }) {
        const row = links.get(where.id);
        if (!row || row.usedAt !== null || row.expiresAt.getTime() <= where.expiresAt.gt.getTime()) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [id, row] of links) {
          const gone =
            "sessionId" in where
              ? row.sessionId === where.sessionId && row.roomId === null
              : row.expiresAt.getTime() < where.expiresAt.lt.getTime();
          if (gone) {
            links.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  return { db, links };
}
