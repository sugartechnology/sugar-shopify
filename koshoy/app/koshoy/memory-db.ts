/**
 * In-memory KoshoyDb for tests. Behaves like the Prisma delegates the store
 * uses (unique tokenHash, cascade delete, conditional updateMany).
 */
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
        const row: KoshoySessionRow = { ...data, createdAt: stamp(), updatedAt: stamp() };
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
