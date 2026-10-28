/**
 * In-memory KoshoyDataDb and KoshoyEventDb for tests. Behave like the Prisma
 * delegates the data store and the journey events use.
 */
import type { KoshoyDataDb, KoshoyDataDocRow, KoshoyDataHistoryRow } from "./data.server";
import type { KoshoyEventDb, KoshoyEventRow } from "./journey-events.server";

export function createMemoryDataDb(now: () => number = Date.now) {
  const docs = new Map<string, KoshoyDataDocRow>();
  const history: KoshoyDataHistoryRow[] = [];
  const db: KoshoyDataDb = {
    koshoyDataDoc: {
      async findMany() {
        return [...docs.values()].map((row) => ({ ...row }));
      },
      async findUnique({ where }) {
        const row = docs.get(where.key);
        return row ? { ...row } : null;
      },
      async upsert({ where, create, update }) {
        const old = docs.get(where.key);
        const row: KoshoyDataDocRow = old
          ? { ...old, version: old.version + update.version.increment, json: update.json, updatedAt: new Date(now()) }
          : { ...create, updatedAt: new Date(now()) };
        docs.set(where.key, row);
        return { ...row };
      },
    },
    koshoyDataHistory: {
      async create({ data }) {
        const row = { ...data, createdAt: new Date(now()) };
        history.push(row);
        return { ...row };
      },
      async findMany({ where, take }) {
        return history
          .filter((row) => row.key === where.key)
          .sort((a, b) => b.version - a.version)
          .slice(0, take)
          .map((row) => ({ ...row }));
      },
    },
  };
  return { db, docs, history };
}

export function createMemoryEventDb() {
  const events: KoshoyEventRow[] = [];
  const db: KoshoyEventDb = {
    koshoyEvent: {
      async create({ data }) {
        events.push({ ...data });
        return { ...data };
      },
      async deleteMany({ where }) {
        const before = events.length;
        const kept = events.filter((row) => row.at.getTime() >= where.at.lt.getTime());
        events.splice(0, events.length, ...kept);
        return { count: before - kept.length };
      },
      async findMany({ where, take }) {
        return events
          .filter((row) => row.at >= where.at.gte && row.at < where.at.lt)
          .slice(0, take)
          .map(({ sessionId, name, device }) => ({ sessionId, name, device }));
      },
    },
  };
  return { db, events };
}
