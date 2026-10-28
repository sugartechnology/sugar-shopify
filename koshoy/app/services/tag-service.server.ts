/**
 * tag-service calls of the room photo flow (server to server, shop API key,
 * same base URL as the LLM gateway): room analysis jobs, room clean jobs
 * (items removed from the photo) and the koshoy-render pipeline. Answers are reduced here to what Koshoy needs;
 * nothing from them reaches the browser as is.
 */
import { getLlmGatewayUrl } from "./llm-gateway.server";
import type { KoshoyFile } from "./s3.server";

const CALL_TIMEOUT_MS = 20_000;
/** Analysis PNGs and render images; anything larger is refused. */
const MAX_DOWNLOAD_BYTES = 30_000_000;

export const KOSHOY_RENDER_PIPELINE = "koshoy-render";

export type StartResult = { ok: true; jobId: string } | { ok: false; status: number };

export type RoomAnalysisJob =
  | { status: "processing" }
  | { status: "completed"; result: unknown }
  | { status: "failed" }
  | { status: "expired" };

/** Upstream error text is kept only to tell "too large" apart; it never reaches the browser. */
export type RoomCleanStartResult = { ok: true; jobId: string } | { ok: false; status: number; error: string };

export type RoomCleanJob =
  | { status: "processing" }
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string }
  | { status: "expired" };

/**
 * Input of decor-ai's room clean job (ortak sözleşme §1). Koshoy never sends
 * a method: decor-ai picks it.
 */
export interface RoomCleanInput {
  /** The room photo, the same JPEG the analysis got */
  imageUrl: string;
  depthUrl: string;
  /** The analysis object map (8 bit, pixel = part number) */
  objectsUrl: string;
  furnitureUrl?: string;
  /** Part numbers to remove: every part of the selected items */
  objectIds: number[];
  depthScale: { min: number; max: number };
  /** As Koshoy stores them (RoomView camera and planes); decor-ai reads fx, fy, cx, cy and the equations */
  camera: { fx: number; fy: number; cx: number; cy: number };
  planes: { floor?: unknown; wall?: unknown };
}

export type RenderJob =
  | { status: "processing" }
  | { status: "completed"; imageUrl: string; imageBase64: string; mimeType: string }
  | { status: "failed" };

/** Input of the decor-ai script koshoy-render (contract §2). */
export interface KoshoyRenderInput {
  roomImageUrl: string;
  compositeImageUrl: string;
  cabinetImageUrl: string;
  cabinetDescription: string;
}

export interface KoshoyTagService {
  startRoomAnalysis(photo: Uint8Array, fovDegrees?: number): Promise<StartResult>;
  getRoomAnalysis(jobId: string): Promise<RoomAnalysisJob>;
  startRender(input: KoshoyRenderInput): Promise<StartResult>;
  getRender(jobId: string): Promise<RenderJob>;
  startRoomClean(input: RoomCleanInput): Promise<RoomCleanStartResult>;
  getRoomClean(jobId: string): Promise<RoomCleanJob>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return asRecord(await response.json().catch(() => null));
}

async function startResult(response: Response): Promise<StartResult> {
  const body = await readJson(response);
  const jobId = text(body.jobId);
  if (!response.ok || !jobId || body.status === "failed") {
    return { ok: false, status: response.status };
  }
  return { ok: true, jobId };
}

export function createTagService(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  baseUrl: string = getLlmGatewayUrl(),
): KoshoyTagService {
  const call = (path: string, init: RequestInit = {}) =>
    fetchFn(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

  return {
    async startRoomAnalysis(photo, fovDegrees) {
      const form = new FormData();
      form.append("image", new Blob([photo.slice().buffer as ArrayBuffer], { type: "image/jpeg" }), "room.jpg");
      if (fovDegrees !== undefined) form.append("fovDegrees", String(fovDegrees));
      return startResult(await call("/api/shopify/room-analysis/jobs", { method: "POST", body: form }));
    },

    async getRoomAnalysis(jobId) {
      const response = await call(`/api/shopify/room-analysis/jobs/${encodeURIComponent(jobId)}`);
      if (response.status === 404) return { status: "expired" };
      if (!response.ok) throw new Error(`room analysis job read failed (${response.status})`);
      const body = await readJson(response);
      if (body.status === "completed") return { status: "completed", result: body.result };
      if (body.status === "failed") {
        console.error("[koshoy] room analysis failed upstream", text(body.error).slice(0, 200));
        return { status: "failed" };
      }
      return { status: "processing" };
    },

    async startRoomClean(input) {
      const response = await call("/api/shopify/room-analysis/clean-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await readJson(response);
      const jobId = text(body.jobId);
      if (response.ok && jobId && body.status !== "failed") return { ok: true, jobId };
      return { ok: false, status: response.status, error: text(body.error).slice(0, 200) };
    },

    async getRoomClean(jobId) {
      const response = await call(`/api/shopify/room-analysis/clean-jobs/${encodeURIComponent(jobId)}`);
      if (response.status === 404) return { status: "expired" };
      if (!response.ok) throw new Error(`room clean job read failed (${response.status})`);
      const body = await readJson(response);
      if (body.status === "completed") return { status: "completed", result: body.result };
      if (body.status === "failed") {
        const error = text(body.error).slice(0, 200);
        console.error("[koshoy] room clean failed upstream", error);
        return { status: "failed", error };
      }
      return { status: "processing" };
    },

    async startRender(input) {
      return startResult(
        await call(`/api/shopify/pdp/pipelines/run-async?pipeline=${KOSHOY_RENDER_PIPELINE}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
    },

    async getRender(jobId) {
      const response = await call(`/api/shopify/pdp/jobs/${encodeURIComponent(jobId)}`);
      if (response.status === 404) return { status: "failed" };
      if (!response.ok) throw new Error(`render job read failed (${response.status})`);
      const body = await readJson(response);
      const status = text(body.status).toLowerCase();
      if (status === "completed") {
        return {
          status: "completed",
          imageUrl: text(body.imageUrl),
          imageBase64: text(body.imageDataBase64),
          mimeType: text(body.mimeType),
        };
      }
      if (status === "failed") {
        console.error("[koshoy] render failed upstream", text(body.error).slice(0, 200));
        return { status: "failed" };
      }
      return { status: "processing" };
    },
  };
}

/** Reads the body, giving up as soon as it grows past `max` bytes. */
async function readAtMost(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("Content-Length"));
  if (declared > max) throw new Error("result file too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error("result file too large");
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Reads a file the analysis or the render wrote (a link from a tag-service
 * answer). https only; null when it is gone.
 */
export async function downloadResultFile(
  url: string,
  fetchFn: typeof fetch = fetch,
  maxBytes: number = MAX_DOWNLOAD_BYTES,
): Promise<KoshoyFile | null> {
  if (!url.startsWith("https://")) return null;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`result file read failed (${response.status})`);
  const bytes = await readAtMost(response, maxBytes);
  return { bytes, contentType: response.headers.get("Content-Type") ?? "" };
}
