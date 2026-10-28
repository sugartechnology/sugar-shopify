/**
 * Data API for the store team (docs/veri-api.md). Not an App Proxy route:
 * called directly on the app host with `Authorization: Bearer <KOSHOY_DATA_API_KEY>`.
 *
 *   GET  /api/koshoy/data                  all documents
 *   GET  /api/koshoy/data/audit            stored documents that no longer validate
 *   GET  /api/koshoy/data/:key             one document
 *   PUT  /api/koshoy/data/:key             save (body = the document)
 *   POST /api/koshoy/data/:key/validate    check only, nothing saved
 *   GET  /api/koshoy/data/:key/history     saved versions, newest first
 *   GET  /api/koshoy/funnel?from=&to=      journey funnel, YYYY-MM-DD in Türkiye time
 */
import { createHash, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import {
  isKoshoyDataKey,
  KOSHOY_DATA_KEYS,
  KOSHOY_DATA_MAX_BYTES,
  koshoyData,
  validateKoshoyData,
  type KoshoyDataStore,
} from "./data.server";
import { koshoyFunnel, type KoshoyEventDb } from "./journey-events.server";

export interface KoshoyDataApiDeps {
  /** KOSHOY_DATA_API_KEY; empty = the API is off (503). */
  apiKey: string | undefined;
  data: KoshoyDataStore;
  events: KoshoyEventDb;
}

export function koshoyDataApiDeps(): KoshoyDataApiDeps {
  return {
    apiKey: process.env.KOSHOY_DATA_API_KEY,
    data: koshoyData(),
    events: prisma as unknown as KoshoyEventDb,
  };
}

const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FUNNEL_DAYS = 366;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function fail(status: number, ...errors: string[]): Response {
  return json({ ok: false, errors }, status);
}

/** Constant time: both sides are hashed to the same length first. */
function keyMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearerToken(request: Request): string {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1].trim() : "";
}

async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const tooLarge = () => ({ ok: false as const, response: fail(413, "Gövde en fazla 64 KB olabilir.") });
  if (Number(request.headers.get("content-length") ?? 0) > KOSHOY_DATA_MAX_BYTES) return tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > KOSHOY_DATA_MAX_BYTES) return tooLarge();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: fail(400, "Gövde geçerli JSON değil.") };
  }
}

/** "2026-10-28" → that day's midnight in Türkiye (UTC+3, no daylight saving). */
function turkeyDay(value: string | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return new Date(utc.getTime() - TURKEY_OFFSET_MS);
}

async function funnelResponse(request: Request, events: KoshoyEventDb): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const from = turkeyDay(params.get("from"));
  const lastDay = turkeyDay(params.get("to"));
  if (!from || !lastDay) return fail(400, "from ve to gerekli, biçim YYYY-MM-DD.");
  const to = new Date(lastDay.getTime() + DAY_MS); // "to" is inclusive
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days < 1 || days > MAX_FUNNEL_DAYS) {
    return fail(400, `to, from'dan önce olamaz; en fazla ${MAX_FUNNEL_DAYS} gün.`);
  }
  const funnel = await koshoyFunnel(events, { from, to });
  return json({ from: params.get("from"), to: params.get("to"), ...funnel });
}

async function allDocs(data: KoshoyDataStore): Promise<Response> {
  const entries = await Promise.all(KOSHOY_DATA_KEYS.map(async (key) => [key, await data.get(key)] as const));
  return json({ docs: Object.fromEntries(entries) });
}

function methodNotAllowed(allowed: string): Response {
  return fail(405, `Bu adres yalnız ${allowed} kabul eder.`);
}

async function route(request: Request, deps: KoshoyDataApiDeps): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "koshoy") return fail(404, "Böyle bir adres yok.");
  const [area, key, action, ...rest] = parts.slice(2);
  const method = request.method.toUpperCase();

  if (area === "funnel" && !key) {
    return method === "GET" ? funnelResponse(request, deps.events) : methodNotAllowed("GET");
  }
  if (area !== "data" || rest.length) return fail(404, "Böyle bir adres yok.");

  if (!key) return method === "GET" ? allDocs(deps.data) : methodNotAllowed("GET");
  if (key === "audit" && !action) {
    return method === "GET" ? json({ audit: await deps.data.audit() }) : methodNotAllowed("GET");
  }
  if (!isKoshoyDataKey(key)) {
    return fail(404, `Böyle bir belge yok: ${key}. Belgeler: ${KOSHOY_DATA_KEYS.join(", ")}.`);
  }

  if (!action) {
    if (method === "GET") return json({ key, ...(await deps.data.get(key)) });
    if (method !== "PUT") return methodNotAllowed("GET ve PUT");
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const saved = await deps.data.put(key, body.value);
    return saved.ok ? json(saved) : json(saved, 422);
  }
  if (action === "validate") {
    if (method !== "POST") return methodNotAllowed("POST");
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const checked = validateKoshoyData(key, body.value);
    return checked.ok ? json(checked) : json(checked, 422);
  }
  if (action === "history") {
    return method === "GET" ? json({ key, history: await deps.data.history(key) }) : methodNotAllowed("GET");
  }
  return fail(404, "Böyle bir adres yok.");
}

/** Every data API request: key check first, then the route. Always answers JSON. */
export async function handleKoshoyDataRequest(request: Request, deps: KoshoyDataApiDeps): Promise<Response> {
  const expected = (deps.apiKey ?? "").trim();
  if (!expected) return fail(503, "Veri API kapalı.");
  const given = bearerToken(request);
  if (!given || !keyMatches(given, expected)) return fail(401, "Anahtar eksik ya da yanlış.");
  try {
    return await route(request, deps);
  } catch (error) {
    console.error("[koshoy] data api failed", error);
    return fail(500, "Sunucu hatası.");
  }
}
