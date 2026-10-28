/**
 * Items removed from the room photo (CONTRACT §2.9): POST /room-clean,
 * POST /room-clean-status, GET /room-file …&clean=.
 *
 * The customer picks items (photo-items.ts), writes what to remove, or both;
 * decor-ai gets the original photo (a signed link to Sugar S3), the text and
 * every part of the picked items through tag-service, picks the method and
 * writes a cleaned photo, depth and furniture mask. One KoshoyRoomClean row
 * per request; the room points at the one asked for last (activeCleanId) and
 * the ready one in use (readyCleanId). Files are served through /room-file,
 * so the browser never sees where they were made.
 */
import type { KoshoyFile } from "../services/s3.server";
import { parseStoredPhotoItems, toPhotoItemView, type PhotoItem } from "./photo-items";
import { measureRoom, parseMeasures, type RoomMeasures } from "./room-measure.server";
import {
  analysisImage,
  imageType,
  isOverdue,
  roomView,
  storedAnalysis,
  type KoshoyJobStatus,
  type KoshoyRoomDeps,
  type KoshoyRoomRow,
  type RoomView,
} from "./room.server";
import { stripImageMetadata } from "./strip-metadata.server";
import { randomOpaqueId } from "./token.server";

/** Distinct requests per room photo; asking for one again or bringing everything back is free. */
export const MAX_CLEANS_PER_ROOM = 5;
/** How long decor-ai may read the room photo (queue wait included). */
export const CLEAN_LINK_SECONDS = 15 * 60;
/** decor-ai's message when the selection covers more than half of the photo. */
const TOO_LARGE_PREFIX = "Selected area is too large";
/** decor-ai's message when the asked items are still in the photo after two tries. */
const NOT_REMOVED = "not_removed";

export const CLEAN_FILE_NAMES = ["photo", "depth", "furniture"] as const;
export type CleanFileName = (typeof CLEAN_FILE_NAMES)[number];

export type CleanError = "clean_failed" | "too_large" | "not_removed";

export interface KoshoyRoomCleanRow {
  id: string;
  roomId: string;
  sessionId: string;
  shop: string;
  /** JSON: selected item ids (PhotoItemView.id), sorted */
  objectIds: string;
  /** What the customer wrote, trimmed; null when they only picked items */
  text: string | null;
  /** JSON: part numbers sent upstream, sorted */
  parts: string;
  status: string;
  error: string | null;
  jobId: string | null;
  photoUrl: string | null;
  depthUrl: string | null;
  furnitureUrl: string | null;
  /** JSON RoomMeasures with the cleaned furniture mask; null = the room's own */
  measures: string | null;
  /** Upstream method and model; kept for our records, never sent to the browser */
  method: string | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type NewRow<T> = Omit<T, "createdAt" | "updatedAt">;

/** The slice of the Prisma client this flow uses (part of KoshoyRoomDb). */
export interface KoshoyRoomCleanDb {
  koshoyRoomClean: {
    create(args: { data: NewRow<KoshoyRoomCleanRow> }): Promise<KoshoyRoomCleanRow>;
    findFirst(args: { where: { id: string; roomId: string } }): Promise<KoshoyRoomCleanRow | null>;
    findMany(args: { where: { roomId: string } }): Promise<KoshoyRoomCleanRow[]>;
    update(args: { where: { id: string }; data: Partial<NewRow<KoshoyRoomCleanRow>> }): Promise<KoshoyRoomCleanRow>;
  };
}

/* ---------------- public view ---------------- */

export interface CleanView {
  id: string;
  status: KoshoyJobStatus;
  error?: CleanError;
  objectIds: string[];
  /** What the customer wrote; absent when they only picked items */
  text?: string;
}

const ITEM_ID = /^\d{1,3}$/;

/** A stored id list; anything unreadable is an empty list. */
function idList(raw: string): string[] {
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && ITEM_ID.test(id)) : [];
  } catch {
    return [];
  }
}

export function cleanView(row: KoshoyRoomCleanRow): CleanView {
  const objectIds = idList(row.objectIds);
  const text = row.text ? { text: row.text } : {};
  if (row.status === "failed") {
    const error = row.error === "too_large" || row.error === "not_removed" ? row.error : "clean_failed";
    return { id: row.id, status: "failed", error, objectIds, ...text };
  }
  return { id: row.id, status: row.status === "ready" ? "ready" : "processing", objectIds, ...text };
}

/** RoomView with the removable items and the item removal (CONTRACT §2.5, §2.9). */
export async function roomViewWithClean(db: KoshoyRoomCleanDb, row: KoshoyRoomRow): Promise<RoomView> {
  const view = roomView(row);
  if (view.status !== "ready") return view;
  const items = parseStoredPhotoItems(row.objects);
  if (items) view.objects = items.map(toPhotoItemView);
  const active = row.activeCleanId
    ? await db.koshoyRoomClean.findFirst({ where: { id: row.activeCleanId, roomId: row.id } })
    : null;
  if (active) view.clean = cleanView(active);
  if (row.readyCleanId) view.cleanReadyId = row.readyCleanId;
  return view;
}

/* ---------------- a request ---------------- */

/** Without repeats, in number order: the same items in any order are the same selection. */
export function sortedSelection(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => Number(a) - Number(b));
}

/**
 * Whether the customer's text names this item, so it is not also sent as one to keep ("koltuğu kaldır" and
 * "Koltuk (solda)"). Turkish suffixes change the last letter (koltuk → koltuğu, sehpa → sehpayı): a word of the
 * text starting with the label's first word without its last letter is a match. Short names need the whole word.
 */
export function namedIn(text: string, label: string): boolean {
  const name = normalText(label).split(" ")[0] ?? "";
  if (!text || !name) return false;
  const stem = name.length > 3 ? name.slice(0, -1) : name;
  return normalText(text)
    .split(/[^\p{L}]+/u)
    .some((word) => word.startsWith(stem));
}

/** Lower case, one space between words: "Koltuğu  ve SEHPAYI" is "koltuğu ve sehpayı". */
function normalText(text: string): string {
  return text.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

/** The same items (in any order) with the same text are the same request. */
function requestKey(ids: readonly string[], text: string): string {
  return `${ids.join(",")}|${normalText(text)}`;
}

function cleanKey(clean: KoshoyRoomCleanRow): string {
  return requestKey(idList(clean.objectIds), clean.text ?? "");
}

function cleanError(upstream: string): CleanError {
  if (upstream === NOT_REMOVED) return "not_removed";
  return upstream.startsWith(TOO_LARGE_PREFIX) ? "too_large" : "clean_failed";
}

/** The room after the request, or why it was refused. */
export type CleanRequestResult =
  | { ok: true; room: KoshoyRoomRow }
  | { ok: false; refused: "unknown_items" | "clean_limit" | "rate_limited" };

/**
 * POST /room-clean on a ready room of the session (`text` already trimmed):
 * - no items and no text brings every item back (the original photo is in use again),
 * - a request asked before (still processing or ready) is used again, free,
 * - a new request (or one that failed before) starts a job when the room
 *   has room for it (MAX_CLEANS_PER_ROOM distinct requests) and the
 *   visitor has budget (`takeBudget`, called only then).
 * While a new request is processing the previous ready one stays in use.
 */
export async function requestClean(
  deps: KoshoyRoomDeps,
  room: KoshoyRoomRow,
  request: { objectIds: readonly string[]; text: string },
  takeBudget: () => boolean,
): Promise<CleanRequestResult> {
  const selection = sortedSelection(request.objectIds);
  const text = request.text;
  if (!selection.length && !text) {
    const cleared = await deps.db.koshoyRoom.update({
      where: { id: room.id },
      data: { activeCleanId: null, readyCleanId: null },
    });
    return { ok: true, room: cleared };
  }

  const items = parseStoredPhotoItems(room.objects) ?? [];
  const chosen = selection.map((id) => items.find((item) => item.id === id));
  if (chosen.some((item) => item === undefined)) return { ok: false, refused: "unknown_items" };

  const key = requestKey(selection, text);
  const cleans = await deps.db.koshoyRoomClean.findMany({ where: { roomId: room.id } });
  const same = cleans.find((clean) => clean.status !== "failed" && cleanKey(clean) === key);
  if (same) {
    const reused = await deps.db.koshoyRoom.update({
      where: { id: room.id },
      data: same.status === "ready" ? { activeCleanId: same.id, readyCleanId: same.id } : { activeCleanId: same.id },
    });
    return { ok: true, room: reused };
  }

  // A refused request spends no budget: the room's cap is checked first.
  const asked = new Set(cleans.map(cleanKey));
  if (!asked.has(key) && asked.size >= MAX_CLEANS_PER_ROOM) return { ok: false, refused: "clean_limit" };
  if (!takeBudget()) return { ok: false, refused: "rate_limited" };

  const clean = await startClean(deps, room, { selection, text }, chosen as PhotoItem[], items);
  const started = await deps.db.koshoyRoom.update({ where: { id: room.id }, data: { activeCleanId: clean.id } });
  return { ok: true, room: started };
}

/**
 * Starts the clean job; a refused start is a failed clean, so the customer is told.
 * decor-ai gets the customer's text, or else the picked items' names; the
 * names of the items not picked as the ones to keep; the parts of the picked
 * items to check the result. Twelve names fit in decor-ai's 300 characters.
 */
async function startClean(
  deps: KoshoyRoomDeps,
  room: KoshoyRoomRow,
  request: { selection: string[]; text: string },
  chosen: readonly PhotoItem[],
  items: readonly PhotoItem[],
): Promise<KoshoyRoomCleanRow> {
  const tagService = await deps.tagService();
  const parts = [...new Set(chosen.flatMap((item) => item.parts))].sort((a, b) => a - b);
  const text = request.text || chosen.map((item) => item.label.toLocaleLowerCase("tr-TR")).join(", ");
  const keepText = items
    .filter((item) => !chosen.includes(item) && !namedIn(request.text, item.label))
    .map((item) => item.label)
    .join(", ");
  const analysis = storedAnalysis(room);
  let jobId: string | null = null;
  let error: CleanError = "clean_failed";
  if (analysis?.fileUrls.objects) {
    try {
      const started = await tagService.startRoomClean({
        imageUrl: await deps.files.signedUrl(room.photoKey, CLEAN_LINK_SECONDS),
        depthUrl: analysis.fileUrls.depth,
        objectsUrl: analysis.fileUrls.objects,
        ...(analysis.fileUrls.furniture ? { furnitureUrl: analysis.fileUrls.furniture } : {}),
        ...(parts.length ? { objectIds: parts } : {}),
        text,
        ...(keepText ? { keepText } : {}),
        depthScale: analysis.depthScale,
        camera: analysis.camera,
        planes: analysis.planes,
      });
      if (started.ok) jobId = started.jobId;
      else {
        console.error("[koshoy] room clean refused", started.status, started.error);
        error = cleanError(started.error);
      }
    } catch (failure) {
      console.error("[koshoy] room clean start failed", failure);
    }
  }
  return deps.db.koshoyRoomClean.create({
    data: {
      id: randomOpaqueId(),
      roomId: room.id,
      sessionId: room.sessionId,
      shop: room.shop,
      objectIds: JSON.stringify(request.selection),
      text: request.text || null,
      parts: JSON.stringify(parts),
      status: jobId ? "processing" : "failed",
      error: jobId ? null : error,
      jobId,
      photoUrl: null,
      depthUrl: null,
      furnitureUrl: null,
      measures: null,
      method: null,
      model: null,
    },
  });
}

/* ---------------- the job ---------------- */

function httpsLink(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** What a completed clean job leaves in the row; null when it is unusable. */
function parseCleanResult(raw: unknown) {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const photoUrl = httpsLink(row?.photo);
  const depthUrl = httpsLink(row?.depth);
  if (!row || !photoUrl || !depthUrl) return null;
  return {
    photoUrl,
    depthUrl,
    furnitureUrl: httpsLink(row.furniture),
    method: shortText(row.method, 40),
    model: shortText(row.model, 80),
  };
}

/**
 * Measurements of the cleaned room: the cleaned furniture mask with the
 * room's own depth, ceiling, camera and planes. The visible wall therefore
 * stays the same (the layout does not move); only the free stretches open up
 * where items were removed. null without a readable cleaned mask: the room's
 * own measurements stay in use.
 */
async function cleanMeasures(
  deps: KoshoyRoomDeps,
  room: KoshoyRoomRow,
  furnitureUrl: string | null,
): Promise<RoomMeasures | null> {
  const analysis = storedAnalysis(room);
  if (!analysis || !furnitureUrl) return null;
  const [depth, furniture, ceiling] = await Promise.all([
    analysisImage(deps, analysis.fileUrls.depth),
    analysisImage(deps, furnitureUrl),
    analysisImage(deps, analysis.fileUrls.ceiling),
  ]);
  return furniture ? measureRoom(analysis, { depth, furniture, ceiling }) : null;
}

/**
 * One upstream check of a processing clean (no background worker: the
 * storefront polls). Upstream trouble leaves it processing until the deadline.
 */
export async function refreshClean(
  deps: KoshoyRoomDeps,
  room: KoshoyRoomRow,
  clean: KoshoyRoomCleanRow,
): Promise<KoshoyRoomCleanRow> {
  if (clean.status !== "processing") return clean;
  const now = (deps.now ?? Date.now)();
  const fail = (error: CleanError) =>
    deps.db.koshoyRoomClean.update({ where: { id: clean.id }, data: { status: "failed", error } });
  if (!clean.jobId) return fail("clean_failed");

  let job;
  try {
    job = await (await deps.tagService()).getRoomClean(clean.jobId);
  } catch (error) {
    console.error("[koshoy] room clean read failed", error);
    return isOverdue(clean, now) ? fail("clean_failed") : clean;
  }
  if (job.status === "expired") return fail("clean_failed");
  if (job.status === "failed") return fail(cleanError(job.error));
  if (job.status === "processing") return isOverdue(clean, now) ? fail("clean_failed") : clean;

  const result = parseCleanResult(job.result);
  if (!result) {
    console.error("[koshoy] room clean result unusable", clean.id);
    return fail("clean_failed");
  }
  const measures = await cleanMeasures(deps, room, result.furnitureUrl);
  return deps.db.koshoyRoomClean.update({
    where: { id: clean.id },
    data: {
      status: "ready",
      error: null,
      photoUrl: result.photoUrl,
      depthUrl: result.depthUrl,
      furnitureUrl: result.furnitureUrl,
      measures: measures ? JSON.stringify(measures) : null,
      method: result.method,
      model: result.model,
    },
  });
}

/**
 * POST /room-clean-status: checks the clean asked for last. When it just got
 * ready it becomes the one in use, unless the customer asked for something
 * else meanwhile. A failed one leaves the previous ready one in use.
 */
export async function refreshActiveClean(deps: KoshoyRoomDeps, room: KoshoyRoomRow): Promise<KoshoyRoomRow> {
  if (!room.activeCleanId) return room;
  const clean = await deps.db.koshoyRoomClean.findFirst({ where: { id: room.activeCleanId, roomId: room.id } });
  if (!clean || clean.status !== "processing") return room;
  const after = await refreshClean(deps, room, clean);
  if (after.status !== "ready") return room;
  const current = await deps.db.koshoyRoom.findFirst({ where: { id: room.id, sessionId: room.sessionId } });
  if (!current || current.activeCleanId !== after.id) return current ?? room;
  return deps.db.koshoyRoom.update({ where: { id: room.id }, data: { readyCleanId: after.id } });
}

/* ---------------- what uses the cleaned room ---------------- */

/** The ready clean in use; null = the original photo. */
export async function readyClean(db: KoshoyRoomCleanDb, room: KoshoyRoomRow): Promise<KoshoyRoomCleanRow | null> {
  if (!room.readyCleanId) return null;
  const clean = await db.koshoyRoomClean.findFirst({ where: { id: room.readyCleanId, roomId: room.id } });
  return clean?.status === "ready" ? clean : null;
}

/** The measurements in force: the ready clean's when it has its own, else the room's. */
export function currentMeasures(room: KoshoyRoomRow, clean: KoshoyRoomCleanRow | null): RoomMeasures | null {
  return parseMeasures(clean?.measures ?? null) ?? parseMeasures(room.measures);
}

/** Same, loading the ready clean (layout.server.ts free stretches). */
export async function roomMeasuresNow(db: KoshoyRoomCleanDb, room: KoshoyRoomRow): Promise<RoomMeasures | null> {
  return currentMeasures(room, await readyClean(db, room));
}

/** Room photo link for the realistic picture (render.server.ts): the cleaned photo in use, or null. */
export async function readyCleanPhotoUrl(db: KoshoyRoomCleanDb, room: KoshoyRoomRow): Promise<string | null> {
  return (await readyClean(db, room))?.photoUrl ?? null;
}

export function isCleanFileName(name: string): name is CleanFileName {
  return (CLEAN_FILE_NAMES as readonly string[]).includes(name);
}

/** /room-file …&clean=: a ready clean of this room; null when missing. */
export async function readCleanFile(
  deps: KoshoyRoomDeps,
  room: KoshoyRoomRow,
  cleanId: string,
  name: CleanFileName,
): Promise<KoshoyFile | null> {
  const clean = await deps.db.koshoyRoomClean.findFirst({ where: { id: cleanId, roomId: room.id } });
  if (!clean || clean.status !== "ready") return null;
  const url = { photo: clean.photoUrl, depth: clean.depthUrl, furniture: clean.furnitureUrl }[name];
  const file = url ? await deps.download(url) : null;
  if (!file) return null;
  if (name === "photo") {
    // The image provider may write its name into the file; it never reaches the customer.
    return imageType(file.bytes) === "image/jpeg"
      ? { bytes: stripImageMetadata(file.bytes), contentType: "image/jpeg" }
      : null;
  }
  return imageType(file.bytes) === "image/png" ? { bytes: file.bytes, contentType: "image/png" } : null;
}
