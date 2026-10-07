/**
 * Persistent Koshoy sessions and designs (Prisma: KoshoySession, KoshoyDesign).
 *
 * The store codes against KoshoyDb — the small slice of the Prisma client it
 * uses — so tests can pass an in-memory implementation and the app passes
 * the real client (see context.server.ts).
 */
import { randomUUID } from "node:crypto";
import type {
  CabinColorId,
  CabinComposition,
  DesignKind,
  PlanLevel,
} from "./engine";
import { DESIGN_KINDS } from "./engine";
import { publicEvents, type ChoiceOption, type PublicEvent } from "./events";
import {
  hashKoshoyToken,
  issueKoshoyToken,
  isWellFormedKoshoyToken,
  KOSHOY_FRESH_SESSION_TTL_MS,
  KOSHOY_SESSION_TTL_MS,
  randomOpaqueId,
} from "./token.server";

const MAX_TRANSCRIPT_EVENTS = 60;
const PRUNE_EVERY_MS = 10 * 60 * 1000;

export interface KoshoySessionRow {
  id: string;
  shop: string;
  tokenHash: string;
  state: string;
  activeDesignId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface KoshoyDesignRow {
  id: string;
  sessionId: string;
  kind: string;
  label: string;
  version: number;
  composition: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KoshoyDb {
  koshoySession: {
    create(args: {
      data: Pick<
        KoshoySessionRow,
        "id" | "shop" | "tokenHash" | "state" | "activeDesignId" | "expiresAt"
      >;
    }): Promise<KoshoySessionRow>;
    findUnique(args: { where: { tokenHash: string } }): Promise<KoshoySessionRow | null>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<KoshoySessionRow, "state" | "activeDesignId" | "expiresAt">>;
    }): Promise<KoshoySessionRow>;
    deleteMany(args: { where: { expiresAt: { lt: Date } } }): Promise<{ count: number }>;
  };
  koshoyDesign: {
    create(args: {
      data: Pick<
        KoshoyDesignRow,
        "id" | "sessionId" | "kind" | "label" | "version" | "composition"
      >;
    }): Promise<KoshoyDesignRow>;
    findMany(args: {
      where: { sessionId: string };
      orderBy: { createdAt: "asc" };
    }): Promise<KoshoyDesignRow[]>;
    findFirst(args: {
      where: { id: string; sessionId: string };
    }): Promise<KoshoyDesignRow | null>;
    updateMany(args: {
      where: { id: string; sessionId: string; version: number };
      data: Pick<KoshoyDesignRow, "label" | "version" | "composition">;
    }): Promise<{ count: number }>;
  };
}

export interface KoshoyBrief {
  room: string;
  style: string;
  level: PlanLevel | "";
  color: CabinColorId | "";
  notes: string;
}

export const EMPTY_KOSHOY_BRIEF: KoshoyBrief = {
  room: "",
  style: "",
  level: "",
  color: "",
  notes: "",
};

export interface KoshoyPendingTool {
  id: string;
  name: string;
  payload: Record<string, unknown>;
}

/**
 * An ask_user option as stored: `id` is the public opaque id the storefront
 * sees ("opt_1"), `value` the id the model chose, which never leaves the server.
 */
export interface KoshoyPendingOption extends ChoiceOption {
  value: string;
}

export interface KoshoySessionState {
  id: string;
  shop: string;
  activeDesignId: string | null;
  /** Model conversation id; rotated when a hop left unmatched tool calls. */
  modelSessionId: string;
  brief: KoshoyBrief;
  /** Hydration transcript: assistant text and choice events only. */
  events: PublicEvent[];
  pendingAskUser: { id: string; question: string; options: KoshoyPendingOption[] } | null;
  /** Tool payloads of the hop that ended with ask_user (every call id). */
  pendingTools: KoshoyPendingTool[];
}

export interface KoshoyDesign {
  id: string;
  kind: DesignKind;
  label: string;
  version: number;
  composition: CabinComposition;
}

export interface KoshoyStore {
  createSession(shop: string): Promise<{ session: KoshoySessionState; token: string }>;
  findSession(token: string, shop: string): Promise<KoshoySessionState | null>;
  saveSession(session: KoshoySessionState): Promise<void>;
  listDesigns(sessionId: string): Promise<KoshoyDesign[]>;
  getDesign(sessionId: string, designId: string): Promise<KoshoyDesign | null>;
  createDesign(
    sessionId: string,
    input: { kind: DesignKind; label: string; composition: CabinComposition },
  ): Promise<KoshoyDesign>;
  /** Optimistic update; null when `design.version` is no longer current. */
  updateDesign(
    sessionId: string,
    design: KoshoyDesign,
    next: { label: string; composition: CabinComposition },
  ): Promise<KoshoyDesign | null>;
}

/**
 * Keeps the hydration transcript: assistant text (consecutive pieces merged,
 * like the storefront bubble) and choices. Everything else is live-only.
 */
export function appendTranscriptEvent(session: KoshoySessionState, event: PublicEvent) {
  if (event.type !== "text" && event.type !== "choice") return;
  const last = session.events[session.events.length - 1];
  if (event.type === "text" && last?.type === "text") {
    const glue = /\s$/.test(last.text) || /^\s/.test(event.text) ? "" : "\n\n";
    last.text += glue + event.text;
    return;
  }
  session.events.push(event.type === "text" ? { ...event } : event);
  if (session.events.length > MAX_TRANSCRIPT_EVENTS) {
    session.events.splice(0, session.events.length - MAX_TRANSCRIPT_EVENTS);
  }
}

type PersistedState = Pick<
  KoshoySessionState,
  "modelSessionId" | "brief" | "events" | "pendingAskUser" | "pendingTools"
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseState(raw: string): PersistedState {
  let row: Record<string, unknown> = {};
  try {
    row = asRecord(JSON.parse(raw));
  } catch {
    row = {};
  }
  const pending = asRecord(row.pendingAskUser);
  return {
    modelSessionId: typeof row.modelSessionId === "string" && row.modelSessionId
      ? row.modelSessionId
      : randomUUID(),
    brief: { ...EMPTY_KOSHOY_BRIEF, ...(asRecord(row.brief) as Partial<KoshoyBrief>) },
    events: publicEvents(Array.isArray(row.events) ? row.events : []),
    pendingAskUser:
      typeof pending.id === "string" && Array.isArray(pending.options)
        ? {
            id: pending.id,
            question: String(pending.question ?? ""),
            options: pending.options as KoshoyPendingOption[],
          }
        : null,
    pendingTools: Array.isArray(row.pendingTools)
      ? (row.pendingTools as KoshoyPendingTool[])
      : [],
  };
}

function serializeState(session: KoshoySessionState): string {
  const state: PersistedState = {
    modelSessionId: session.modelSessionId,
    brief: session.brief,
    events: session.events.slice(-MAX_TRANSCRIPT_EVENTS),
    pendingAskUser: session.pendingAskUser,
    pendingTools: session.pendingTools,
  };
  return JSON.stringify(state);
}

function toDesign(row: KoshoyDesignRow): KoshoyDesign | null {
  if (!(DESIGN_KINDS as readonly string[]).includes(row.kind)) return null;
  let composition: CabinComposition;
  try {
    composition = JSON.parse(row.composition) as CabinComposition;
  } catch {
    return null;
  }
  if (!composition || !Array.isArray(composition.units)) return null;
  return {
    id: row.id,
    kind: row.kind as DesignKind,
    label: row.label,
    version: row.version,
    composition,
  };
}

export function createKoshoyStore(
  db: KoshoyDb,
  options: { now?: () => number; ttlMs?: number; freshTtlMs?: number } = {},
): KoshoyStore {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? KOSHOY_SESSION_TTL_MS;
  // Page views create sessions; only a saved (used) session gets the full TTL.
  const freshTtlMs = Math.min(options.freshTtlMs ?? KOSHOY_FRESH_SESSION_TTL_MS, ttlMs);
  let lastPrune = 0;

  const pruneExpired = async () => {
    const at = now();
    if (at - lastPrune < PRUNE_EVERY_MS) return;
    lastPrune = at;
    await db.koshoySession.deleteMany({ where: { expiresAt: { lt: new Date(at) } } });
  };

  return {
    async createSession(shop) {
      await pruneExpired();
      const { token, hash } = issueKoshoyToken();
      const session: KoshoySessionState = {
        id: randomUUID(),
        shop,
        activeDesignId: null,
        modelSessionId: randomUUID(),
        brief: { ...EMPTY_KOSHOY_BRIEF },
        events: [],
        pendingAskUser: null,
        pendingTools: [],
      };
      await db.koshoySession.create({
        data: {
          id: session.id,
          shop,
          tokenHash: hash,
          state: serializeState(session),
          activeDesignId: null,
          expiresAt: new Date(now() + freshTtlMs),
        },
      });
      return { session, token };
    },

    async findSession(token, shop) {
      if (!isWellFormedKoshoyToken(token)) return null;
      const row = await db.koshoySession.findUnique({
        where: { tokenHash: hashKoshoyToken(token) },
      });
      if (!row || row.shop !== shop) return null;
      if (row.expiresAt.getTime() <= now()) return null;
      return {
        id: row.id,
        shop: row.shop,
        activeDesignId: row.activeDesignId,
        ...parseState(row.state),
      };
    },

    async saveSession(session) {
      await db.koshoySession.update({
        where: { id: session.id },
        data: {
          state: serializeState(session),
          activeDesignId: session.activeDesignId,
          expiresAt: new Date(now() + ttlMs),
        },
      });
    },

    async listDesigns(sessionId) {
      const rows = await db.koshoyDesign.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toDesign).filter((row): row is KoshoyDesign => row !== null);
    },

    async getDesign(sessionId, designId) {
      if (!designId) return null;
      const row = await db.koshoyDesign.findFirst({ where: { id: designId, sessionId } });
      return row ? toDesign(row) : null;
    },

    async createDesign(sessionId, input) {
      const design: KoshoyDesign = {
        id: randomOpaqueId(),
        kind: input.kind,
        label: input.label,
        version: 1,
        composition: input.composition,
      };
      await db.koshoyDesign.create({
        data: {
          id: design.id,
          sessionId,
          kind: design.kind,
          label: design.label,
          version: design.version,
          composition: JSON.stringify(design.composition),
        },
      });
      return design;
    },

    async updateDesign(sessionId, design, next) {
      const version = design.version + 1;
      const result = await db.koshoyDesign.updateMany({
        where: { id: design.id, sessionId, version: design.version },
        data: {
          label: next.label,
          version,
          composition: JSON.stringify(next.composition),
        },
      });
      if (result.count !== 1) return null;
      return { ...design, label: next.label, version, composition: next.composition };
    },
  };
}
