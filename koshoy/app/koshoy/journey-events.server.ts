/**
 * Journey events (KoshoyEvent): one row per step a customer reaches, so the
 * team can see where people drop off (koshoyFunnel, GET /api/koshoy/funnel).
 *
 * Only the opaque session id, the step name, phone/desktop and a few small
 * props are kept — never personal data. Rows older than 180 days are pruned.
 */
import { randomUUID } from "node:crypto";

/** Journey order; the funnel lists the steps in this order. */
export const KOSHOY_JOURNEY_EVENTS = [
  "card_clicked",
  "first_message",
  "room_chosen",
  "structure_photo",
  "structure_measure",
  "structure_skipped",
  "set_planned",
  "style_done",
  "signed_in",
  "room_approved",
  "product_approved",
  "product_changed",
  "product_later",
  "product_removed",
  "cart_sent",
  "checkout_started",
  "order_placed",
] as const;

export type KoshoyJourneyEvent = (typeof KOSHOY_JOURNEY_EVENTS)[number];
export type KoshoyDevice = "phone" | "desktop";
export type KoshoyEventProps = Record<string, string | number>;

const KEEP_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 10 * 60 * 1000;
const MAX_PROPS = 10;
const MAX_PROP_CHARS = 200;
/** Funnel reads at most this many rows; more sets `truncated`. */
const FUNNEL_MAX_ROWS = 200_000;

export interface KoshoyEventRow {
  id: string;
  at: Date;
  sessionId: string;
  name: string;
  device: string;
  props: string | null;
}

/** The slice of the Prisma client the events use (tests pass an in-memory one). */
export interface KoshoyEventDb {
  koshoyEvent: {
    create(args: { data: KoshoyEventRow }): Promise<unknown>;
    deleteMany(args: { where: { at: { lt: Date } } }): Promise<{ count: number }>;
    findMany(args: {
      where: { at: { gte: Date; lt: Date } };
      select: { sessionId: true; name: true; device: true };
      take: number;
    }): Promise<Pick<KoshoyEventRow, "sessionId" | "name" | "device">[]>;
  };
}

/** Tablets count as phones. iPads that send a Mac user agent count as desktop. */
export function deviceFromUserAgent(userAgent: string | null | undefined): KoshoyDevice {
  return /mobi|android|iphone|ipad|ipod|tablet|kindle|silk|opera mini/i.test(userAgent ?? "")
    ? "phone"
    : "desktop";
}

function isJourneyEvent(name: string): name is KoshoyJourneyEvent {
  return (KOSHOY_JOURNEY_EVENTS as readonly string[]).includes(name);
}

/** Looks like an e-mail address or a phone number: never stored. */
function looksPersonal(value: string): boolean {
  return value.includes("@") || /\d[\d\s-]{8,}\d/.test(value);
}

/** Flat strings and finite numbers only, at most 10 keys, 200 characters each. */
function cleanProps(props: Record<string, unknown> | undefined): KoshoyEventProps | null {
  const out: KoshoyEventProps = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    if (typeof value === "string" && !looksPersonal(value)) out[key] = value.slice(0, MAX_PROP_CHARS);
  }
  return Object.keys(out).length ? out : null;
}

// Last prune time per database, so tests with their own fake db do not share it.
const lastPruneByDb = new WeakMap<object, number>();

/** Records one journey step. Never throws: a failed write only logs a warning. */
export async function recordKoshoyEvent(
  db: KoshoyEventDb,
  input: { sessionId: string; name: KoshoyJourneyEvent; device: KoshoyDevice; props?: Record<string, unknown> },
  options: { now?: () => number } = {},
): Promise<void> {
  const now = (options.now ?? Date.now)();
  try {
    if (!isJourneyEvent(input.name) || !input.sessionId) return;
    const props = cleanProps(input.props);
    await db.koshoyEvent.create({
      data: {
        id: randomUUID(),
        at: new Date(now),
        sessionId: input.sessionId.slice(0, 64),
        name: input.name,
        device: input.device === "phone" ? "phone" : "desktop",
        props: props ? JSON.stringify(props) : null,
      },
    });
    if (now - (lastPruneByDb.get(db) ?? 0) >= PRUNE_EVERY_MS) {
      lastPruneByDb.set(db, now);
      await db.koshoyEvent.deleteMany({ where: { at: { lt: new Date(now - KEEP_DAYS * DAY_MS) } } });
    }
  } catch (error) {
    console.warn("[koshoy] journey event not recorded", input.name, error);
  }
}

export interface KoshoyFunnelStep {
  name: KoshoyJourneyEvent;
  /** Distinct sessions that reached the step. */
  sessions: number;
  phone: number;
  desktop: number;
  /** sessions / previous step's sessions (0.42 = 42%); null for the first step or after 0. */
  rateFromPrevious: number | null;
}

export interface KoshoyFunnel {
  steps: KoshoyFunnelStep[];
  /** More rows than the funnel reads; the counts are too low. */
  truncated: boolean;
}

/** Distinct sessions per step between `from` (inclusive) and `to` (exclusive). */
export async function koshoyFunnel(
  db: KoshoyEventDb,
  range: { from: Date; to: Date },
): Promise<KoshoyFunnel> {
  const rows = await db.koshoyEvent.findMany({
    where: { at: { gte: range.from, lt: range.to } },
    select: { sessionId: true, name: true, device: true },
    take: FUNNEL_MAX_ROWS + 1,
  });
  const seen = new Map<string, { all: Set<string>; phone: Set<string>; desktop: Set<string> }>();
  for (const row of rows.slice(0, FUNNEL_MAX_ROWS)) {
    let step = seen.get(row.name);
    if (!step) {
      step = { all: new Set(), phone: new Set(), desktop: new Set() };
      seen.set(row.name, step);
    }
    step.all.add(row.sessionId);
    (row.device === "phone" ? step.phone : step.desktop).add(row.sessionId);
  }

  let previous: number | null = null;
  const steps = KOSHOY_JOURNEY_EVENTS.map((name) => {
    const step = seen.get(name);
    const sessions = step?.all.size ?? 0;
    const rateFromPrevious = previous ? Math.round((sessions / previous) * 1000) / 1000 : null;
    previous = sessions;
    return {
      name,
      sessions,
      phone: step?.phone.size ?? 0,
      desktop: step?.desktop.size ?? 0,
      rateFromPrevious,
    };
  });
  return { steps, truncated: rows.length > FUNNEL_MAX_ROWS };
}
