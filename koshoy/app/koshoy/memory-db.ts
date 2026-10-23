/**
 * In-memory KoshoyDb for tests. Behaves like the Prisma delegates the store
 * uses (unique tokenHash, cascade delete, conditional updateMany).
 */
import type { KoshoyLayoutRow } from "./layout.server";
import type { KoshoyPhoneLinkDb, KoshoyPhoneLinkRow } from "./phone-link.server";
import { measureRoom } from "./room-measure.server";
import type { KoshoyRenderRow, KoshoyRoomDb, KoshoyRoomRow, RoomPlanes } from "./room.server";
import type {
  KoshoyDb,
  KoshoyDesignRow,
  KoshoySessionRow,
} from "./store.server";

export function createMemoryKoshoyDb(now: () => number = Date.now) {
  const sessions = new Map<string, KoshoySessionRow>();
  const designs = new Map<string, KoshoyDesignRow>();
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
            count += 1;
          }
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
    },
  };

  return { db, sessions, designs };
}

/**
 * In-memory KoshoyRoom / KoshoyRender tables (create, findFirst by id +
 * session, findMany by session, update) and KoshoyLayout (unique sessionId,
 * conditional updateMany).
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

  const koshoyRoom = table<KoshoyRoomRow>();
  const koshoyRender = table<KoshoyRenderRow>();
  const db: KoshoyRoomDb = { koshoyRoom, koshoyRender, koshoyLayout };
  return { db, rooms: koshoyRoom.rows, renders: koshoyRender.rows, layouts };
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
