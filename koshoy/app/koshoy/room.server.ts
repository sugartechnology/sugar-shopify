/**
 * Room photo flow (CONTRACT §3, /room, /room-status, /room-file).
 *
 * The customer's photo goes to Sugar S3 and to the room analysis. When the
 * analysis is done its answer is whitelisted into the KoshoyRoom row, and
 * RoomView is rebuilt from that row field by field: no upstream text, link
 * or name ever reaches the browser. Mask/depth links stay in the row and
 * /room-file passes the bytes through.
 */
import type { KoshoyFile, KoshoyFileStore } from "../services/s3.server";
import type { KoshoyTagService } from "../services/tag-service.server";
import type { RoomPhotoRequest } from "./input";
import type { KoshoyLayoutDb } from "./layout.server";
import { decodeGreyPng, type GreyImage } from "./png.server";
import { guessNoExifFov, type FovGuess } from "./room-fov";
import { floorFrame } from "./room-layout";
import { measureRoom, parseMeasures, type MetreRange, type RoomMeasures } from "./room-measure.server";
import type { KoshoySessionState } from "./store.server";
import { randomOpaqueId } from "./token.server";

/** A job still "processing" after this long is given up (lost upstream). */
export const KOSHOY_JOB_DEADLINE_MS = 10 * 60 * 1000;

export const ROOM_FILE_NAMES = ["photo", "depth", "floor", "wall", "ceiling", "furniture"] as const;
export type RoomFileName = (typeof ROOM_FILE_NAMES)[number];
type AnalysisFileName = Exclude<RoomFileName, "photo">;

export type KoshoyJobStatus = "processing" | "ready" | "failed";

/** Where the room's scale comes from; picks the measurement band (room-measure.server.ts). */
export type ScaleSource = "exif" | "user" | FovGuess;

export interface KoshoyRoomRow {
  id: string;
  sessionId: string;
  shop: string;
  status: string;
  error: string | null;
  jobId: string | null;
  photoKey: string;
  consentAt: Date | null;
  width: number | null;
  height: number | null;
  camera: string | null;
  planes: string | null;
  depthScale: string | null;
  fileUrls: string | null;
  /** exif | user | hand_height | phone_26mm (room-fov.ts); never sent to the browser */
  scaleSource: string | null;
  /** JSON RoomMeasures (room-measure.server.ts); never sent to the browser as such */
  measures: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KoshoyRenderRow {
  id: string;
  sessionId: string;
  shop: string;
  roomId: string;
  /** JSON: ids of the designs drawn, left to right */
  designIds: string;
  status: string;
  error: string | null;
  jobId: string | null;
  compositeKey: string;
  cabinetKey: string;
  resultKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type NewRow<T> = Omit<T, "createdAt" | "updatedAt">;

/** The slice of the Prisma client the room, render and layout flows use. */
export interface KoshoyRoomDb extends KoshoyLayoutDb {
  koshoyRoom: {
    create(args: { data: NewRow<KoshoyRoomRow> }): Promise<KoshoyRoomRow>;
    findFirst(args: { where: { id: string; sessionId: string } }): Promise<KoshoyRoomRow | null>;
    findMany(args: { where: { sessionId: string } }): Promise<KoshoyRoomRow[]>;
    update(args: { where: { id: string }; data: Partial<NewRow<KoshoyRoomRow>> }): Promise<KoshoyRoomRow>;
  };
  koshoyRender: {
    create(args: { data: NewRow<KoshoyRenderRow> }): Promise<KoshoyRenderRow>;
    findFirst(args: { where: { id: string; sessionId: string } }): Promise<KoshoyRenderRow | null>;
    findMany(args: { where: { sessionId: string } }): Promise<KoshoyRenderRow[]>;
    update(args: { where: { id: string }; data: Partial<NewRow<KoshoyRenderRow>> }): Promise<KoshoyRenderRow>;
  };
}

export interface KoshoyRoomDeps {
  db: KoshoyRoomDb;
  /** Sugar S3 */
  files: KoshoyFileStore;
  /** tag-service client with the shop's API key (resolved lazily). */
  tagService(): Promise<KoshoyTagService>;
  /** Reads a file the analysis or the render wrote. */
  download(url: string): Promise<KoshoyFile | null>;
  now?: () => number;
}

/* ---------------- public view ---------------- */

export type Vector3 = [number, number, number];
export type Vector4 = [number, number, number, number];

export interface RoomCamera {
  fovXDegrees: number;
  fovYDegrees: number;
  aspect: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

interface RoomPlane {
  normal: Vector3;
  equation: Vector4;
}

export interface RoomPlanes {
  floor?: RoomPlane;
  wall?: RoomPlane;
}

interface DepthScale {
  min: number;
  max: number;
}

type AnalysisFileUrls = { depth: string } & Partial<Record<Exclude<AnalysisFileName, "depth">, string>>;

export interface RoomView {
  id: string;
  status: KoshoyJobStatus;
  error?: "analysis_failed" | "expired" | "no_floor";
  width?: number;
  height?: number;
  camera?: RoomCamera;
  planes?: RoomPlanes;
  depthScale?: DepthScale;
  files?: { photo: string } & Partial<Record<AnalysisFileName, string>>;
  /** Visible wall along the wall line (room-layout alongM); absent without a usable wall. */
  wall?: MetreRange;
}

/* ---------------- whitelist of the analysis answer ---------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteList(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out = value.map(finite);
  return out.every((item) => item !== null) ? (out as number[]) : null;
}

function pixels(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 20_000
    ? value
    : null;
}

/** Drops fovSource, axes and anything else the analysis adds. */
function toCamera(raw: unknown): RoomCamera | null {
  const row = asRecord(raw);
  const camera = {
    fovXDegrees: finite(row?.fovXDegrees),
    fovYDegrees: finite(row?.fovYDegrees),
    aspect: finite(row?.aspect),
    fx: finite(row?.fx),
    fy: finite(row?.fy),
    cx: finite(row?.cx),
    cy: finite(row?.cy),
  };
  return Object.values(camera).every((value) => value !== null) ? (camera as RoomCamera) : null;
}

function toPlane(raw: unknown): RoomPlane | null {
  const row = asRecord(raw);
  const normal = finiteList(row?.normal, 3);
  const equation = finiteList(row?.equation, 4);
  return normal && equation ? { normal: normal as Vector3, equation: equation as Vector4 } : null;
}

function toPlanes(raw: unknown): RoomPlanes {
  const row = asRecord(raw);
  const planes: RoomPlanes = {};
  const floor = toPlane(row?.floor);
  const wall = toPlane(row?.wall);
  if (floor) planes.floor = floor;
  if (wall) planes.wall = wall;
  return planes;
}

function toDepthScale(raw: unknown): DepthScale | null {
  const row = asRecord(raw);
  const min = finite(row?.min);
  const max = finite(row?.max);
  return min !== null && max !== null && max > min ? { min, max } : null;
}

function httpsLink(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

function toFileUrls(raw: unknown): AnalysisFileUrls | null {
  const row = asRecord(raw);
  const depth = httpsLink(row?.depth);
  if (!row || !depth) return null;
  const urls: AnalysisFileUrls = { depth };
  for (const name of ["floor", "wall", "ceiling", "furniture"] as const) {
    const link = httpsLink(row[name]);
    if (link) urls[name] = link;
  }
  return urls;
}

/**
 * What a completed analysis leaves in the row; null when it is unusable.
 * A photo analysed at the 45° default (no EXIF, no fovDegrees) gets its
 * angle guessed again (room-fov.ts); EXIF and storefront angles stay.
 */
export function parseRoomAnalysis(result: unknown) {
  const row = asRecord(result);
  const masks = asRecord(row?.masks);
  const width = pixels(row?.width);
  const height = pixels(row?.height);
  const camera = toCamera(row?.camera);
  const depthScale = toDepthScale(row?.depthScale);
  const fileUrls = toFileUrls({ ...masks, depth: row?.depth });
  if (!row || !width || !height || !camera || !depthScale || !fileUrls) return null;
  const analysed = { width, height, camera, planes: toPlanes(row.planes) };
  const fovSource = asRecord(row.camera)?.fovSource;
  const guessed = fovSource === "default" ? guessNoExifFov(analysed) : null;
  const scaleSource: ScaleSource | null =
    guessed?.guess ?? (fovSource === "exif" || fovSource === "user" ? fovSource : null);
  return {
    ...analysed,
    camera: guessed?.camera ?? camera,
    planes: guessed?.planes ?? analysed.planes,
    depthScale,
    fileUrls,
    scaleSource,
  };
}

function parseColumn(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function roomFileLink(roomId: string, name: RoomFileName): string {
  return `/apps/koshoy/studio/room-file?room=${roomId}&name=${name}`;
}

/** RoomView, rebuilt from the row through the same whitelist. */
export function roomView(row: KoshoyRoomRow): RoomView {
  if (row.status === "failed") {
    const error = row.error === "expired" || row.error === "no_floor" ? row.error : "analysis_failed";
    return { id: row.id, status: "failed", error };
  }
  if (row.status !== "ready") return { id: row.id, status: "processing" };
  const camera = toCamera(parseColumn(row.camera));
  const depthScale = toDepthScale(parseColumn(row.depthScale));
  const urls = toFileUrls(parseColumn(row.fileUrls));
  const width = pixels(row.width);
  const height = pixels(row.height);
  if (!camera || !depthScale || !urls || !width || !height) {
    return { id: row.id, status: "failed", error: "analysis_failed" };
  }
  const files: RoomView["files"] = { photo: roomFileLink(row.id, "photo") };
  for (const name of Object.keys(urls) as AnalysisFileName[]) {
    files[name] = roomFileLink(row.id, name);
  }
  const view: RoomView = {
    id: row.id,
    status: "ready",
    width,
    height,
    camera,
    planes: toPlanes(parseColumn(row.planes)),
    depthScale,
    files,
  };
  // Only the wall's ends reach the browser; the other measurements stay here.
  const wall = parseMeasures(row.measures)?.wall;
  if (wall) view.wall = { fromM: wall.fromM, toM: wall.toM };
  return view;
}

/* ---------------- flow ---------------- */

export function isOverdue(row: { createdAt: Date }, now: number): boolean {
  return now - row.createdAt.getTime() > KOSHOY_JOB_DEADLINE_MS;
}

/** Image type from the bytes themselves; never from an upstream header. */
export function imageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Stores the photo and starts the analysis. A refused start (busy, limit,
 * bad image) is a failed room, so the stored photo always has its row.
 */
export async function startRoom(
  deps: KoshoyRoomDeps,
  session: KoshoySessionState,
  input: RoomPhotoRequest,
): Promise<KoshoyRoomRow> {
  const tagService = await deps.tagService();
  const id = randomOpaqueId();
  const photoKey = await deps.files.put(`rooms/${id}/photo.jpg`, {
    bytes: input.photo,
    contentType: "image/jpeg",
  });
  let jobId: string | null = null;
  try {
    const started = await tagService.startRoomAnalysis(input.photo, input.fovDegrees);
    if (started.ok) jobId = started.jobId;
    else console.error("[koshoy] room analysis refused", started.status);
  } catch (error) {
    console.error("[koshoy] room analysis start failed", error);
  }
  return deps.db.koshoyRoom.create({
    data: {
      id,
      sessionId: session.id,
      shop: session.shop,
      status: jobId ? "processing" : "failed",
      error: jobId ? null : "analysis_failed",
      jobId,
      photoKey,
      consentAt: input.consent ? new Date((deps.now ?? Date.now)()) : null,
      width: null,
      height: null,
      camera: null,
      planes: null,
      depthScale: null,
      fileUrls: null,
      scaleSource: null,
      measures: null,
    },
  });
}

/**
 * One upstream check of a processing room (no background worker: the
 * storefront polls). Upstream trouble leaves the room processing.
 */
export async function refreshRoom(deps: KoshoyRoomDeps, row: KoshoyRoomRow): Promise<KoshoyRoomRow> {
  if (row.status !== "processing") return row;
  const now = (deps.now ?? Date.now)();
  const fail = (error: "analysis_failed" | "expired" | "no_floor") =>
    deps.db.koshoyRoom.update({ where: { id: row.id }, data: { status: "failed", error } });
  if (!row.jobId) return fail("analysis_failed");

  let job;
  try {
    job = await (await deps.tagService()).getRoomAnalysis(row.jobId);
  } catch (error) {
    console.error("[koshoy] room analysis read failed", error);
    return isOverdue(row, now) ? fail("analysis_failed") : row;
  }
  if (job.status === "expired") return fail("expired");
  if (job.status === "failed") return fail("analysis_failed");
  if (job.status === "processing") return isOverdue(row, now) ? fail("analysis_failed") : row;

  const analysis = parseRoomAnalysis(job.result);
  if (!analysis) {
    console.error("[koshoy] room analysis result unusable", row.id);
    return fail("analysis_failed");
  }
  // Same rule as the 3D view (room-layout floorFrame): without a usable floor
  // nothing can stand in this photo, so say so now, not after "Odamda gör".
  if (!floorFrame(analysis)) return fail("no_floor");
  const measures = await measureAnalysis(deps, analysis);
  return deps.db.koshoyRoom.update({
    where: { id: row.id },
    data: {
      status: "ready",
      error: null,
      width: analysis.width,
      height: analysis.height,
      camera: JSON.stringify(analysis.camera),
      planes: JSON.stringify(analysis.planes),
      depthScale: JSON.stringify(analysis.depthScale),
      fileUrls: JSON.stringify(analysis.fileUrls),
      scaleSource: analysis.scaleSource,
      measures: JSON.stringify(measures),
    },
  });
}

/** A mask or the depth map, decoded; null when it is missing or unreadable. */
async function analysisImage(deps: KoshoyRoomDeps, url: string | undefined): Promise<GreyImage | null> {
  if (!url) return null;
  try {
    const file = await deps.download(url);
    return file ? decodeGreyPng(file.bytes) : null;
  } catch (error) {
    console.error("[koshoy] analysis file not read", error);
    return null;
  }
}

/**
 * Measurements of a finished analysis, with the corrected camera and planes
 * (after room-fov.ts). Files that cannot be read leave their values out;
 * the wall's geometry never needs them.
 */
async function measureAnalysis(
  deps: KoshoyRoomDeps,
  analysis: NonNullable<ReturnType<typeof parseRoomAnalysis>>,
): Promise<RoomMeasures> {
  const urls = analysis.fileUrls;
  const [depth, furniture, ceiling] = await Promise.all([
    analysisImage(deps, urls.depth),
    analysisImage(deps, urls.furniture),
    analysisImage(deps, urls.ceiling),
  ]);
  return measureRoom(analysis, { depth, furniture, ceiling });
}

/** Photo from Sugar S3, analysis files through their links; null when missing. */
export async function readRoomFile(
  deps: KoshoyRoomDeps,
  row: KoshoyRoomRow,
  name: RoomFileName,
): Promise<KoshoyFile | null> {
  if (name === "photo") {
    const file = await deps.files.get(row.photoKey);
    return file && imageType(file.bytes) === "image/jpeg"
      ? { bytes: file.bytes, contentType: "image/jpeg" }
      : null;
  }
  if (row.status !== "ready") return null;
  const urls = toFileUrls(parseColumn(row.fileUrls));
  const url = urls?.[name];
  if (!url) return null;
  const file = await deps.download(url);
  // The analysis writes PNGs (8 bit masks, 16 bit depth).
  return file && imageType(file.bytes) === "image/png"
    ? { bytes: file.bytes, contentType: "image/png" }
    : null;
}
