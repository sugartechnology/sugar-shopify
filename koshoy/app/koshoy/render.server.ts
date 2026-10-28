/**
 * Photoreal render of a design in the customer's room (CONTRACT §3,
 * /render, /render-status, /render-file; decor-ai script koshoy-render).
 *
 * The two 3D captures go to Sugar S3; decor-ai gets short-lived signed links
 * to them and to the room photo. The result is copied into Sugar S3 and
 * served through /render-file, so the browser never sees where it was made.
 */
import type { KoshoyFile } from "../services/s3.server";
import type { RenderJob } from "../services/tag-service.server";
import { CABIN_COLOR_LABELS, DESIGN_KIND_LABELS, type CabinetEngine } from "./engine";
import { normalizeCabinColor } from "./cabinet-core";
import { readyCleanPhotoUrl } from "./room-clean.server";
import {
  imageType,
  isOverdue,
  type KoshoyJobStatus,
  type KoshoyRenderRow,
  type KoshoyRoomDeps,
  type KoshoyRoomRow,
} from "./room.server";
import type { KoshoyDesign, KoshoySessionState } from "./store.server";
import { stripImageMetadata } from "./strip-metadata.server";
import { randomOpaqueId } from "./token.server";

/** How long decor-ai may read the inputs (queue wait included). */
export const RENDER_LINK_SECONDS = 15 * 60;

export interface RenderView {
  id: string;
  status: KoshoyJobStatus;
  error?: "render_failed";
  file?: string;
}

function cmText(mm: number): string {
  return String(Math.round(mm) / 10).replace(".", ",");
}

/**
 * Short product-language summary for the render prompt, e.g.
 * "3 kapaklı, 2 çekmeceli gardırop, ahşap, 192 cm genişlik, 230,4 cm yükseklik, 64 cm derinlik".
 */
export function cabinetDescription(engine: CabinetEngine, design: KoshoyDesign): string {
  const c = design.composition;
  const count = (part: string) =>
    engine
      .toBom(c)
      .filter((line) => line.part === part)
      .reduce((sum, line) => sum + line.qty, 0);
  const doors = count("KAPAK");
  const drawers = count("CEKMECE_ON");
  const widthMm = c.units.reduce((sum, unit) => sum + unit.widthMm, 0);
  const heightMm = Math.max(...c.units.map((unit) => unit.heightMm));
  const features: string[] = [];
  if (doors) features.push(`${doors} kapaklı`);
  if (drawers) features.push(`${drawers} çekmeceli`);
  const kind = DESIGN_KIND_LABELS[design.kind].toLocaleLowerCase("tr-TR");
  const color = CABIN_COLOR_LABELS[normalizeCabinColor(c.color)].toLocaleLowerCase("tr-TR");
  return [
    [features.join(", "), kind].filter(Boolean).join(" "),
    color,
    `${cmText(widthMm)} cm genişlik`,
    `${cmText(heightMm)} cm yükseklik`,
    `${cmText(c.depthMm)} cm derinlik`,
  ].join(", ");
}

/**
 * The render prompt's cabinet text: one design as one line; several as
 * "Soldan sağa:" and one line per cabinet ("1) …"), in the order they
 * stand in the room (koshoy-render keeps the line breaks).
 */
export function renderDescription(engine: CabinetEngine, designs: readonly KoshoyDesign[]): string {
  if (designs.length === 1) return cabinetDescription(engine, designs[0]);
  const lines = designs.map((design, index) => `${index + 1}) ${cabinetDescription(engine, design)}`);
  return ["Soldan sağa:", ...lines].join("\n");
}

export function renderView(row: KoshoyRenderRow): RenderView {
  if (row.status === "failed") return { id: row.id, status: "failed", error: "render_failed" };
  if (row.status === "ready" && row.resultKey) {
    return { id: row.id, status: "ready", file: `/apps/koshoy/studio/render-file?render=${row.id}` };
  }
  return { id: row.id, status: "processing" };
}

/**
 * Stores both captures and starts koshoy-render. `designs` are the cabinets
 * in the captures, left to right. A refused start is a failed render.
 */
export async function startRender(
  deps: KoshoyRoomDeps,
  session: KoshoySessionState,
  input: {
    room: KoshoyRoomRow;
    designs: readonly KoshoyDesign[];
    composite: Uint8Array;
    cabinet: Uint8Array;
    description: string;
  },
): Promise<KoshoyRenderRow> {
  const tagService = await deps.tagService();
  const id = randomOpaqueId();
  const jpeg = (bytes: Uint8Array) => ({ bytes, contentType: "image/jpeg" });
  const compositeKey = await deps.files.put(`renders/${id}/composite.jpg`, jpeg(input.composite));
  const cabinetKey = await deps.files.put(`renders/${id}/cabinet.jpg`, jpeg(input.cabinet));
  const link = (key: string) => deps.files.signedUrl(key, RENDER_LINK_SECONDS);

  let jobId: string | null = null;
  try {
    const started = await tagService.startRender({
      // With items removed from the photo, the picture is made from the cleaned room (CONTRACT §2.9).
      roomImageUrl: (await readyCleanPhotoUrl(deps.db, input.room)) ?? (await link(input.room.photoKey)),
      compositeImageUrl: await link(compositeKey),
      cabinetImageUrl: await link(cabinetKey),
      cabinetDescription: input.description,
    });
    if (started.ok) jobId = started.jobId;
    else console.error("[koshoy] render refused", started.status);
  } catch (error) {
    console.error("[koshoy] render start failed", error);
  }
  return deps.db.koshoyRender.create({
    data: {
      id,
      sessionId: session.id,
      shop: session.shop,
      roomId: input.room.id,
      designIds: JSON.stringify(input.designs.map((design) => design.id)),
      status: jobId ? "processing" : "failed",
      error: jobId ? null : "render_failed",
      jobId,
      compositeKey,
      cabinetKey,
      resultKey: null,
    },
  });
}

async function resultImage(
  deps: KoshoyRoomDeps,
  job: Extract<RenderJob, { status: "completed" }>,
): Promise<KoshoyFile | null> {
  let bytes: Uint8Array | null = null;
  if (job.imageUrl) bytes = (await deps.download(job.imageUrl))?.bytes ?? null;
  else if (job.imageBase64) bytes = new Uint8Array(Buffer.from(job.imageBase64, "base64"));
  const type = bytes ? imageType(bytes) : null;
  // The provider's name (C2PA, XMP, EXIF) never reaches the customer (CONTRACT v2.2-3).
  return bytes && type ? { bytes: stripImageMetadata(bytes), contentType: type } : null;
}

/**
 * One upstream check of a processing render (the storefront polls). A
 * finished image is copied into Sugar S3. Upstream trouble leaves it
 * processing until the deadline.
 */
export async function refreshRender(
  deps: KoshoyRoomDeps,
  row: KoshoyRenderRow,
): Promise<KoshoyRenderRow> {
  if (row.status !== "processing") return row;
  const now = (deps.now ?? Date.now)();
  const fail = () =>
    deps.db.koshoyRender.update({
      where: { id: row.id },
      data: { status: "failed", error: "render_failed" },
    });
  if (!row.jobId) return fail();

  try {
    const job = await (await deps.tagService()).getRender(row.jobId);
    if (job.status === "failed") return fail();
    if (job.status === "processing") return isOverdue(row, now) ? fail() : row;

    const image = await resultImage(deps, job);
    if (!image) {
      console.error("[koshoy] render result unusable", row.id);
      return fail();
    }
    const extension = image.contentType.slice("image/".length).replace("jpeg", "jpg");
    const resultKey = await deps.files.put(`renders/${row.id}/result.${extension}`, image);
    return deps.db.koshoyRender.update({
      where: { id: row.id },
      data: { status: "ready", error: null, resultKey },
    });
  } catch (error) {
    console.error("[koshoy] render read failed", error);
    return isOverdue(row, now) ? fail() : row;
  }
}

export async function readRenderFile(
  deps: KoshoyRoomDeps,
  row: KoshoyRenderRow,
): Promise<KoshoyFile | null> {
  if (row.status !== "ready" || !row.resultKey) return null;
  const file = await deps.files.get(row.resultKey);
  const type = file ? imageType(file.bytes) : null;
  return file && type ? { bytes: file.bytes, contentType: type } : null;
}
