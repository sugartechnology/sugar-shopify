/**
 * Persistent Koshoy sessions and designs (Prisma: KoshoySession, KoshoyDesign,
 * KoshoySessionKey). One session is one room the customer opens (rooms.server.ts).
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
import { emptyJourney, parseJourney, type KoshoyJourney } from "./journey";
import {
  hashKoshoyToken,
  issueKoshoyToken,
  isWellFormedKoshoyToken,
  KOSHOY_ACCOUNT_SESSION_TTL_MS,
  KOSHOY_FRESH_SESSION_TTL_MS,
  KOSHOY_SESSION_TTL_MS,
  randomOpaqueId,
} from "./token.server";

const MAX_TRANSCRIPT_EVENTS = 60;
const PRUNE_EVERY_MS = 10 * 60 * 1000;
/** Devices an account room can be opened on besides the first; the oldest key goes. */
const MAX_DEVICE_KEYS = 5;

export interface KoshoySessionRow {
  id: string;
  shop: string;
  tokenHash: string;
  state: string;
  activeDesignId: string | null;
  roomId: string | null;
  customerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/** Another device's token for a session (an account room opened there). */
export interface KoshoySessionKeyRow {
  tokenHash: string;
  sessionId: string;
  createdAt: Date;
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
        "id" | "shop" | "tokenHash" | "state" | "activeDesignId" | "customerId" | "expiresAt"
      >;
    }): Promise<KoshoySessionRow>;
    findUnique(args: {
      where: { tokenHash: string } | { id: string };
    }): Promise<KoshoySessionRow | null>;
    update(args: {
      where: { id: string };
      data: Partial<
        Pick<KoshoySessionRow, "state" | "activeDesignId" | "expiresAt" | "roomId" | "customerId">
      >;
    }): Promise<KoshoySessionRow>;
    deleteMany(args: { where: { expiresAt: { lt: Date } } }): Promise<{ count: number }>;
  };
  koshoySessionKey: {
    findUnique(args: { where: { tokenHash: string } }): Promise<KoshoySessionKeyRow | null>;
    create(args: { data: Pick<KoshoySessionKeyRow, "tokenHash" | "sessionId"> }): Promise<KoshoySessionKeyRow>;
    findMany(args: {
      where: { sessionId: string };
      orderBy: { createdAt: "asc" };
    }): Promise<KoshoySessionKeyRow[]>;
    deleteMany(args: { where: { tokenHash: { in: string[] } } }): Promise<{ count: number }>;
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
    deleteMany(args: { where: { id: string; sessionId: string } }): Promise<{ count: number }>;
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

/** A transcript event with the time it was written (ms); rows from before had none. */
export type KoshoyTranscriptEvent = PublicEvent & { at?: number };

export interface KoshoySessionState {
  id: string;
  shop: string;
  activeDesignId: string | null;
  /** Latest analysed room (room-status sets it); read-only for turns. */
  roomId: string | null;
  /** Shopify customer the room belongs to; null = only the browsers holding its token. */
  customerId: string | null;
  /** Model conversation id; rotated when a hop left unmatched tool calls. */
  modelSessionId: string;
  brief: KoshoyBrief;
  /** Hydration transcript: assistant text and choice events only. */
  events: KoshoyTranscriptEvent[];
  /** `tool`: the question tool that asked (ask_user when missing). */
  pendingAskUser: { id: string; tool?: string; question: string; options: KoshoyPendingOption[] } | null;
  /** Tool payloads of the hop that ended with ask_user (every call id). */
  pendingTools: KoshoyPendingTool[];
  /** Room whose photo the model conversation has already seen (sent once per room). */
  photoSentRoomId: string | null;
  /** Stages, style decisions and approvals (journey.ts). */
  journey: KoshoyJourney;
}

export interface KoshoyDesign {
  id: string;
  kind: DesignKind;
  label: string;
  version: number;
  composition: CabinComposition;
}

export interface KoshoyStore {
  /** A signed-in customer's new session belongs to their account at once. */
  createSession(
    shop: string,
    customerId?: string | null,
  ): Promise<{ session: KoshoySessionState; token: string }>;
  /**
   * The session of a token (its first one or a device key). An account
   * session opens only for its own customer: signed out or someone else, it
   * is as if the token were unknown.
   */
  findSession(
    token: string,
    shop: string,
    customerId?: string | null,
  ): Promise<KoshoySessionState | null>;
  /** The signed-in customer takes an ownerless session into their account. */
  attachCustomer(session: KoshoySessionState, customerId: string): Promise<void>;
  /**
   * A new token on this device for one of the customer's account sessions
   * (`ref` is the session id the room list shows); null when it is not theirs.
   */
  openOnDevice(
    ref: string,
    shop: string,
    customerId: string,
  ): Promise<{ session: KoshoySessionState; token: string } | null>;
  saveSession(session: KoshoySessionState): Promise<void>;
  /**
   * Records the session's latest analysed room. Separate from saveSession,
   * which writes every other field: a turn that loaded the session earlier
   * must not undo it.
   */
  setRoom(sessionId: string, roomId: string): Promise<void>;
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
  /** "Bu ürünü istemiyorum": the design leaves the conversation. */
  deleteDesign(sessionId: string, designId: string): Promise<boolean>;
}

/**
 * Keeps the hydration transcript: assistant text (consecutive pieces merged,
 * like the storefront bubble) and choices. Everything else is live-only.
 */
export function appendTranscriptEvent(
  session: KoshoySessionState,
  event: PublicEvent,
  now: number = Date.now(),
) {
  if (event.type !== "text" && event.type !== "choice") return;
  const last = session.events[session.events.length - 1];
  if (event.type === "text" && last?.type === "text") {
    const glue = /\s$/.test(last.text) || /^\s/.test(event.text) ? "" : "\n\n";
    last.text += glue + event.text;
    return;
  }
  session.events.push({ ...event, at: now });
  if (session.events.length > MAX_TRANSCRIPT_EVENTS) {
    session.events.splice(0, session.events.length - MAX_TRANSCRIPT_EVENTS);
  }
}

type PersistedState = Pick<
  KoshoySessionState,
  "modelSessionId" | "brief" | "events" | "pendingAskUser" | "pendingTools" | "photoSentRoomId" | "journey"
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function transcriptEvents(raw: readonly unknown[]): KoshoyTranscriptEvent[] {
  const out: KoshoyTranscriptEvent[] = [];
  for (const item of raw) {
    const [event] = publicEvents([item]);
    if (!event) continue;
    const at = asRecord(item).at;
    out.push(typeof at === "number" && Number.isFinite(at) ? { ...event, at } : event);
  }
  return out;
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
    events: transcriptEvents(Array.isArray(row.events) ? row.events : []),
    pendingAskUser:
      typeof pending.id === "string" && Array.isArray(pending.options)
        ? {
            id: pending.id,
            ...(typeof pending.tool === "string" ? { tool: pending.tool } : {}),
            question: String(pending.question ?? ""),
            options: pending.options as KoshoyPendingOption[],
          }
        : null,
    pendingTools: Array.isArray(row.pendingTools)
      ? (row.pendingTools as KoshoyPendingTool[])
      : [],
    photoSentRoomId: typeof row.photoSentRoomId === "string" ? row.photoSentRoomId : null,
    journey: parseJourney(row.journey),
  };
}

function serializeState(session: KoshoySessionState): string {
  const state: PersistedState = {
    modelSessionId: session.modelSessionId,
    brief: session.brief,
    events: session.events.slice(-MAX_TRANSCRIPT_EVENTS),
    pendingAskUser: session.pendingAskUser,
    pendingTools: session.pendingTools,
    photoSentRoomId: session.photoSentRoomId,
    journey: session.journey,
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

/** A session row as the handlers see it (also the room list, room-sessions.server.ts). */
export function toSessionState(row: KoshoySessionRow): KoshoySessionState {
  return {
    id: row.id,
    shop: row.shop,
    activeDesignId: row.activeDesignId,
    roomId: row.roomId ?? null,
    customerId: row.customerId ?? null,
    ...parseState(row.state),
  };
}

export function createKoshoyStore(
  db: KoshoyDb,
  options: { now?: () => number; ttlMs?: number; freshTtlMs?: number; accountTtlMs?: number } = {},
): KoshoyStore {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? KOSHOY_SESSION_TTL_MS;
  const accountTtlMs = options.accountTtlMs ?? KOSHOY_ACCOUNT_SESSION_TTL_MS;
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
    async createSession(shop, customerId = null) {
      await pruneExpired();
      const { token, hash } = issueKoshoyToken();
      const session: KoshoySessionState = {
        id: randomUUID(),
        shop,
        activeDesignId: null,
        roomId: null,
        customerId,
        modelSessionId: randomUUID(),
        brief: { ...EMPTY_KOSHOY_BRIEF },
        events: [],
        pendingAskUser: null,
        pendingTools: [],
        photoSentRoomId: null,
        journey: emptyJourney(),
      };
      await db.koshoySession.create({
        data: {
          id: session.id,
          shop,
          tokenHash: hash,
          state: serializeState(session),
          activeDesignId: null,
          customerId,
          expiresAt: new Date(now() + freshTtlMs),
        },
      });
      return { session, token };
    },

    async findSession(token, shop, customerId = null) {
      if (!isWellFormedKoshoyToken(token)) return null;
      const tokenHash = hashKoshoyToken(token);
      let row = await db.koshoySession.findUnique({ where: { tokenHash } });
      if (!row) {
        // A device key: the room was opened on this device from the customer's account.
        const key = await db.koshoySessionKey.findUnique({ where: { tokenHash } });
        row = key ? await db.koshoySession.findUnique({ where: { id: key.sessionId } }) : null;
      }
      if (!row || row.shop !== shop) return null;
      if (row.expiresAt.getTime() <= now()) return null;
      if (row.customerId && row.customerId !== customerId) return null;
      return toSessionState(row);
    },

    async saveSession(session) {
      await db.koshoySession.update({
        where: { id: session.id },
        data: {
          state: serializeState(session),
          activeDesignId: session.activeDesignId,
          expiresAt: new Date(now() + (session.customerId ? accountTtlMs : ttlMs)),
        },
      });
    },

    async attachCustomer(session, customerId) {
      session.customerId = customerId;
      // An unused session (page view only) keeps its short life until its first save.
      const used = session.events.length > 0;
      await db.koshoySession.update({
        where: { id: session.id },
        data: { customerId, ...(used ? { expiresAt: new Date(now() + accountTtlMs) } : {}) },
      });
    },

    async openOnDevice(ref, shop, customerId) {
      const row = ref ? await db.koshoySession.findUnique({ where: { id: ref } }) : null;
      if (!row || row.shop !== shop || row.customerId !== customerId) return null;
      if (row.expiresAt.getTime() <= now()) return null;
      const { token, hash } = issueKoshoyToken();
      await db.koshoySessionKey.create({ data: { tokenHash: hash, sessionId: row.id } });
      const keys = await db.koshoySessionKey.findMany({
        where: { sessionId: row.id },
        orderBy: { createdAt: "asc" },
      });
      const extra = keys.slice(0, Math.max(0, keys.length - MAX_DEVICE_KEYS));
      if (extra.length) {
        await db.koshoySessionKey.deleteMany({
          where: { tokenHash: { in: extra.map((key) => key.tokenHash) } },
        });
      }
      return { session: toSessionState(row), token };
    },

    async setRoom(sessionId, roomId) {
      await db.koshoySession.update({ where: { id: sessionId }, data: { roomId } });
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

    async deleteDesign(sessionId, designId) {
      const result = await db.koshoyDesign.deleteMany({ where: { id: designId, sessionId } });
      return result.count === 1;
    },
  };
}
