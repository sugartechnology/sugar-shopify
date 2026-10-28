import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import type { KoshoyFile, KoshoyFileStore } from "../services/s3.server";
import type {
  KoshoyRenderInput,
  KoshoyTagService,
  RoomAnalysisJob,
  RoomCleanInput,
  RoomCleanJob,
  RoomCleanStartResult,
} from "../services/tag-service.server";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import { cabinetEngine } from "./engine";
import { handleKoshoySession, type KoshoyRequestContext } from "./handlers.server";
import { createMemoryKoshoyDb, createMemoryRoomDb, createMemoryRoomSessionsDb } from "./memory-db";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import { createBusyLock, createRateLimiter, KOSHOY_LIMITS } from "./rate-limit.server";
import { handleKoshoyRoomClean, handleKoshoyRoomCleanStatus } from "./room-clean-handlers.server";
import { MAX_CLEANS_PER_ROOM } from "./room-clean.server";
import { handleKoshoyRender, handleKoshoyRoom, handleKoshoyRoomFile, handleKoshoyRoomStatus } from "./room-handlers.server";
import { parseMeasures } from "./room-measure.server";
import { KOSHOY_JOB_DEADLINE_MS, type KoshoyRoomDeps } from "./room.server";
import { createKoshoyStore } from "./store.server";

const SHOP = "koshoy.myshopify.com";
/** Anything that would tell the browser where files live, who made them or how. */
const LEAKS =
  /amazonaws|x-amz|sugar|decor|ihom|koshoy-studio\/|gemini|openai|lama|method|model|area"|classId|className|jobId|Selected area|tag-?service/i;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6]);
const jpegDataUrl = () => `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`;
/** A cleaned photo whose EXIF names the image provider. */
const CLEAN_JPEG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe1, 0x00, 0x0a, ...Buffer.from("Gemini!!"),
  0xff, 0xda, 0x00, 0x02, 9, 9,
  0xff, 0xd9,
]);

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** 8 bit grey PNG, 160×120 (a tenth of the photo), `value(u, v)` in photo pixels. */
function maskPng(value: (u: number, v: number) => number): Uint8Array {
  const width = 160;
  const height = 120;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) rows.push(value(x * 10, y * 10));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.from(rows))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

/** A cabinet in the middle of the wall, in front of it from the floor up. */
const FURNITURE_MASK = maskPng((u, v) => (u >= 640 && u < 960 && v >= 600 ? 255 : 0));
const EMPTY_MASK = maskPng(() => 0);

const ANALYSIS_LINK = "https://ihom.s3.eu-central-1.amazonaws.com/room-analysis/job-1";
const CLEAN_LINK = "https://ihom.s3.eu-central-1.amazonaws.com/room-analysis/clean/clean-job-1";
const ANALYSIS = {
  width: 1600,
  height: 1200,
  camera: { fovXDegrees: 60, fovYDegrees: 47.9, aspect: 1.3333, fx: 1385.6, fy: 1385.6, cx: 800, cy: 600, fovSource: "exif" },
  masks: {
    furniture: `${ANALYSIS_LINK}/furniture.png`,
    objects: `${ANALYSIS_LINK}/objects.png`,
  },
  depth: `${ANALYSIS_LINK}/depth.png`,
  depthScale: { min: 0.8, max: 6.4 },
  planes: {
    floor: { normal: [0, -1, 0], equation: [0, -1, 0, 1.3], inlierRatio: 0.92 },
    wall: { normal: [0, 0, -1], equation: [0, 0, -1, 3.1], inlierRatio: 0.71 },
  },
  objects: [
    { id: 1, classId: 0, className: "wall", box: [0, 0, 1, 0.6], area: 0.4, touches: [2] },
    { id: 2, classId: 23, className: "sofa", box: [0.4, 0.45, 0.8, 0.8], area: 0.12, touches: [1, 3, 4] },
    { id: 3, classId: 39, className: "cushion", box: [0.45, 0.5, 0.55, 0.6], area: 0.01, touches: [2] },
    { id: 4, classId: 28, className: "rug", box: [0.2, 0.75, 0.9, 1], area: 0.1, touches: [2] },
    { id: 5, classId: 36, className: "lamp", box: [0.1, 0.2, 0.15, 0.6], area: 0.01, touches: [] },
    { id: 6, classId: 18, className: "curtain", box: [0.85, 0, 1, 0.7], area: 0.06, touches: [] },
  ],
};
const cleanResult = (job: string) => ({
  width: 1600,
  height: 1200,
  method: "gemini",
  model: "gemini-2.5-flash-image",
  objectIds: [2, 3],
  areaRatio: 0.13,
  photo: `${CLEAN_LINK.replace("clean-job-1", job)}/photo.jpg`,
  depth: `${CLEAN_LINK.replace("clean-job-1", job)}/depth.png`,
  furniture: `${CLEAN_LINK.replace("clean-job-1", job)}/furniture.png`,
  mask: `${CLEAN_LINK.replace("clean-job-1", job)}/mask.png`,
  inpaintMs: 9000,
  processingMs: 12000,
});

function fakeTagService() {
  const calls = { cleans: [] as RoomCleanInput[], renders: [] as KoshoyRenderInput[] };
  const state = {
    roomJob: { status: "completed", result: ANALYSIS } as RoomAnalysisJob,
    cleanStart: null as RoomCleanStartResult | null,
    /** Answer per clean job id; "processing" when missing */
    cleanJobs: new Map<string, RoomCleanJob>(),
  };
  const service: KoshoyTagService = {
    async startRoomAnalysis() {
      return { ok: true, jobId: "room-job-1" };
    },
    async getRoomAnalysis() {
      return state.roomJob;
    },
    async startRender(input) {
      calls.renders.push(input);
      return { ok: true, jobId: "render-job-1" };
    },
    async getRender() {
      return { status: "processing" };
    },
    async startRoomClean(input) {
      calls.cleans.push(input);
      return state.cleanStart ?? { ok: true, jobId: `clean-job-${calls.cleans.length}` };
    },
    async getRoomClean(jobId) {
      return state.cleanJobs.get(jobId) ?? { status: "processing" };
    },
  };
  return { service, calls, state };
}

function setup(options: { cleanLimit?: number } = {}) {
  const clock = { now: Date.parse("2026-10-28T12:00:00Z") };
  const tag = fakeTagService();
  const objects = new Map<string, KoshoyFile>();
  const files: KoshoyFileStore = {
    async put(name, file) {
      objects.set(`koshoy-studio/${name}`, file);
      return `koshoy-studio/${name}`;
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async deleteFolder(prefix) {
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
    },
    async signedUrl(key, seconds) {
      return `https://cdn.sugartech.s3.eu-central-1.amazonaws.com/${key}?X-Amz-Expires=${seconds}`;
    },
  };
  const memory = createMemoryRoomDb(() => clock.now);
  const downloads = new Map<string, Uint8Array>([
    [ANALYSIS.depth, PNG],
    [ANALYSIS.masks.furniture, FURNITURE_MASK],
    [ANALYSIS.masks.objects, PNG],
  ]);
  for (const job of ["clean-job-1", "clean-job-2", "clean-job-3"]) {
    const result = cleanResult(job);
    downloads.set(result.photo, CLEAN_JPEG).set(result.depth, PNG).set(result.furniture, EMPTY_MASK);
  }
  const room: KoshoyRoomDeps = {
    db: memory.db,
    files,
    tagService: async () => tag.service,
    download: async (url) => {
      const bytes = downloads.get(url);
      return bytes ? { bytes, contentType: "binary/octet-stream" } : null;
    },
    now: () => clock.now,
  };
  const loose = () => createRateLimiter({ limit: 100, windowMs: 60_000 });
  const koshoyDb = createMemoryKoshoyDb();
  const ctx: KoshoyRequestContext = {
    shop: SHOP,
    enabled: true,
    store: createKoshoyStore(koshoyDb.db),
    engine: cabinetEngine,
    pricer: createKoshoyPricer(cabinetEngine, createMockSkuResolver([{ pattern: "*", price: "100.00" }])),
    limits: {
      turn: loose(),
      edit: loose(),
      cart: loose(),
      session: loose(),
      client: loose(),
      shop: loose(),
      shopSession: loose(),
      room: loose(),
      render: loose(),
      roomRead: loose(),
      layout: loose(),
      rooms: loose(),
      roomClean: createRateLimiter({ ...KOSHOY_LIMITS.roomClean, limit: options.cleanLimit ?? KOSHOY_LIMITS.roomClean.limit }),
    },
    busy: createBusyLock(),
    chatConfig: async () => ({ apiKey: "", mock: true }),
    journeyData: async () => KOSHOY_DATA_DEFAULTS,
    customerId: "c1",
    roomSessions: createMemoryRoomSessionsDb(koshoyDb, memory),
    room,
  };
  return { ctx, tag, memory, clock, downloads };
}

type Setup = ReturnType<typeof setup>;

function post(path: string, body: unknown, token: string, ip = "203.0.113.9"): Request {
  return new Request(`https://app.test/apps/koshoy/studio/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Forwarded-For": `${ip}, 23.227.38.1` },
    body: JSON.stringify(body),
  });
}

function get(pathAndQuery: string, token: string): Request {
  return new Request(`https://app.test${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function openSession(ctx: KoshoyRequestContext): Promise<string> {
  const response = await handleKoshoySession(
    new Request("https://app.test/apps/koshoy/studio/session", { method: "POST", body: "{}" }),
    ctx,
  );
  return ((await response.json()) as { session: string }).session;
}

type View = {
  id: string;
  status: string;
  files?: Record<string, string>;
  objects?: Array<{ id: string; label: string; parts: number[]; box: number[] }>;
  clean?: { id: string; status: string; error?: string; objectIds: string[] };
  cleanReadyId?: string;
};

async function json(response: Response): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text };
}

async function readyRoom(t: Setup, token: string): Promise<View> {
  const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
  const roomId = (started.body.room as View).id;
  const ready = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
  return ready.body.room as View;
}

async function clean(t: Setup, token: string, roomId: string, objectIds: unknown, ip?: string) {
  const answer = await json(await handleKoshoyRoomClean(post("room-clean", { roomId, objectIds }, token, ip), t.ctx));
  return { ...answer, room: answer.body.room as View };
}

async function cleanStatus(t: Setup, token: string, roomId: string) {
  const answer = await json(await handleKoshoyRoomCleanStatus(post("room-clean-status", { roomId }, token), t.ctx));
  return { ...answer, room: answer.body.room as View };
}

const finish = (t: Setup, job: string) =>
  t.tag.state.cleanJobs.set(job, { status: "completed", result: cleanResult(job) });

describe("koshoy item removal from the room photo (/room-clean)", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  it("lists the removable items of a ready room and serves their object map", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    assert.equal(room.status, "ready");
    assert.deepEqual(room.objects, [
      { id: "2", label: "Koltuk", parts: [2, 3], box: [0.4, 0.45, 0.8, 0.8] },
      { id: "4", label: "Halı", parts: [4], box: [0.2, 0.75, 0.9, 1] },
      { id: "6", label: "Perde", parts: [6], box: [0.85, 0, 1, 0.7] },
      { id: "5", label: "Lamba", parts: [5], box: [0.1, 0.2, 0.15, 0.6] },
    ]);
    assert.equal(room.clean, undefined);
    assert.equal(room.cleanReadyId, undefined);
    assert.equal(room.files?.objects, undefined, "the FE builds the link itself (CONTRACT §2.5)");

    const map = await handleKoshoyRoomFile(get(`/apps/koshoy/studio/room-file?room=${room.id}&name=objects`, token), t.ctx);
    assert.equal(map.status, 200);
    assert.equal(map.headers.get("Content-Type"), "image/png");
    assert.equal(map.headers.get("Cache-Control"), "private, max-age=3600");
  });

  it("removes the chosen items with every part, then uses the cleaned photo, depth and measurements", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);

    const started = await clean(t, token, room.id, ["4", "2"]);
    assert.equal(started.status, 200);
    assert.ok(!LEAKS.test(started.text), started.text);
    const cleanId = started.room.clean!.id;
    assert.deepEqual(started.room.clean, { id: cleanId, status: "processing", objectIds: ["2", "4"] });
    assert.equal(started.room.cleanReadyId, undefined, "the original photo stays until it is ready");

    const [input] = t.tag.calls.cleans;
    assert.match(input.imageUrl, new RegExp(`^https://cdn\\.sugartech.*/koshoy-studio/rooms/${room.id}/photo\\.jpg\\?X-Amz-Expires=900$`));
    assert.equal(input.depthUrl, ANALYSIS.depth);
    assert.equal(input.objectsUrl, ANALYSIS.masks.objects);
    assert.equal(input.furnitureUrl, ANALYSIS.masks.furniture);
    assert.deepEqual(input.objectIds, [2, 3, 4], "the sofa, its cushion and the rug");
    assert.deepEqual(input.depthScale, ANALYSIS.depthScale);
    assert.equal(input.camera.fx, 1385.6);
    assert.deepEqual(input.planes, {
      floor: { normal: [0, -1, 0], equation: [0, -1, 0, 1.3] },
      wall: { normal: [0, 0, -1], equation: [0, 0, -1, 3.1] },
    });
    assert.equal("method" in input, false, "decor-ai picks the method");

    const pending = await cleanStatus(t, token, room.id);
    assert.equal(pending.room.clean?.status, "processing");

    finish(t, "clean-job-1");
    const ready = await cleanStatus(t, token, room.id);
    assert.ok(!LEAKS.test(ready.text), ready.text);
    assert.deepEqual(ready.room.clean, { id: cleanId, status: "ready", objectIds: ["2", "4"] });
    assert.equal(ready.room.cleanReadyId, cleanId);

    // The cabinet in front of the wall is gone: one free stretch instead of two.
    const roomRow = [...t.memory.rooms.values()][0];
    const cleanRow = t.memory.cleans.get(cleanId)!;
    assert.equal(parseMeasures(roomRow.measures)?.free.length, 2);
    assert.equal(parseMeasures(cleanRow.measures)?.free.length, 1);
    assert.deepEqual(parseMeasures(cleanRow.measures)?.wall, parseMeasures(roomRow.measures)?.wall, "the wall stays");
    assert.equal(cleanRow.method, "gemini");

    const link = (name: string, id = cleanId) => `/apps/koshoy/studio/room-file?room=${room.id}&name=${name}&clean=${id}`;
    const photo = await handleKoshoyRoomFile(get(link("photo"), token), t.ctx);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("Content-Type"), "image/jpeg");
    const bytes = new Uint8Array(await photo.arrayBuffer());
    assert.ok(!Buffer.from(bytes).toString("latin1").includes("Gemini"), "provider metadata stripped");
    for (const name of ["depth", "furniture"]) {
      const file = await handleKoshoyRoomFile(get(link(name), token), t.ctx);
      assert.equal(file.status, 200, name);
      assert.equal(file.headers.get("Content-Type"), "image/png");
    }
    assert.equal((await handleKoshoyRoomFile(get(link("floor"), token), t.ctx)).status, 400, "only photo, depth, furniture");
    assert.equal((await handleKoshoyRoomFile(get(link("photo", "nope"), token), t.ctx)).status, 404);
    assert.equal((await handleKoshoyRoomFile(get(link("photo", "bad id!"), token), t.ctx)).status, 400);

    // A realistic picture is made from the cleaned room.
    const session = (await t.ctx.store.findSession(token, SHOP, t.ctx.customerId))!;
    const design = await t.ctx.store.createDesign(session.id, {
      kind: "gardirop",
      label: "Gardırop 96 cm",
      composition: cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: 960 }).composition,
    });
    const render = await handleKoshoyRender(
      post("render", { roomId: room.id, designId: design.id, composite: jpegDataUrl(), cabinet: jpegDataUrl() }, token),
      t.ctx,
    );
    assert.equal(render.status, 200);
    assert.equal(t.tag.calls.renders[0].roomImageUrl, cleanResult("clean-job-1").photo);

    // A reload restores the cleaned room.
    const restored = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    const view = restored.body.room as View;
    assert.equal(view.cleanReadyId, cleanId);
    assert.equal(view.clean?.status, "ready");
    assert.equal(view.objects?.length, 4);
  });

  it("asks again for free and brings everything back for free", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const first = await clean(t, token, room.id, ["2"]);
    finish(t, "clean-job-1");
    await cleanStatus(t, token, room.id);

    const back = await clean(t, token, room.id, []);
    assert.equal(back.status, 200);
    assert.equal(back.room.clean, undefined);
    assert.equal(back.room.cleanReadyId, undefined);

    const again = await clean(t, token, room.id, ["2", "2"]);
    assert.equal(again.status, 200, "the same selection does not count against the minute");
    assert.equal(again.room.clean?.id, first.room.clean?.id);
    assert.equal(again.room.cleanReadyId, first.room.clean?.id);
    assert.equal(t.tag.calls.cleans.length, 1, "no new job");

    const other = await clean(t, token, room.id, ["6"]);
    assert.equal(other.status, 429, "a new selection within the minute");
    assert.deepEqual(other.body, { error: "rate_limited" });
    const fresh = await openSession(t.ctx);
    const freshRoom = await readyRoom(t, fresh);
    assert.equal((await clean(t, fresh, freshRoom.id, ["6"])).status, 429, "a new session does not reset the visitor");
    assert.equal((await clean(t, fresh, freshRoom.id, ["6"], "198.51.100.7")).status, 200, "another visitor");
  });

  it("keeps the previous cleaned photo while a new one is processing or when it fails", async () => {
    const t = setup({ cleanLimit: 100 });
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const first = await clean(t, token, room.id, ["2"]);
    finish(t, "clean-job-1");
    await cleanStatus(t, token, room.id);

    const second = await clean(t, token, room.id, ["2", "4", "6"]);
    assert.equal(second.room.clean?.status, "processing");
    assert.equal(second.room.cleanReadyId, first.room.clean?.id);

    t.tag.state.cleanJobs.set("clean-job-2", { status: "failed", error: "Selected area is too large: 62% of the photo" });
    const tooLarge = await cleanStatus(t, token, room.id);
    assert.ok(!LEAKS.test(tooLarge.text), tooLarge.text);
    assert.deepEqual(tooLarge.room.clean, { id: second.room.clean!.id, status: "failed", error: "too_large", objectIds: ["2", "4", "6"] });
    assert.equal(tooLarge.room.cleanReadyId, first.room.clean?.id);

    const third = await clean(t, token, room.id, ["4"]);
    t.tag.state.cleanJobs.set("clean-job-3", { status: "failed", error: "Gemini returned no image" });
    assert.equal((await cleanStatus(t, token, room.id)).room.clean?.error, "clean_failed");
    assert.notEqual(third.room.clean?.id, first.room.clean?.id);

    // A failed selection may be tried again: a new job, not the failed row.
    const retry = await clean(t, token, room.id, ["4"]);
    assert.equal(retry.room.clean?.status, "processing");
    assert.notEqual(retry.room.clean?.id, third.room.clean?.id);
    assert.equal(t.tag.calls.cleans.length, 4);

    // Ten minutes without an answer: failed.
    t.clock.now += KOSHOY_JOB_DEADLINE_MS + 1;
    const late = await cleanStatus(t, token, room.id);
    assert.equal(late.room.clean?.error, "clean_failed");
    assert.equal(late.room.cleanReadyId, first.room.clean?.id);
  });

  it("allows five distinct removals per photo", async () => {
    const t = setup({ cleanLimit: 100 });
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const selections = [["2"], ["4"], ["5"], ["6"], ["2", "4"]];
    assert.equal(selections.length, MAX_CLEANS_PER_ROOM);
    for (const selection of selections) assert.equal((await clean(t, token, room.id, selection)).status, 200);
    const sixth = await clean(t, token, room.id, ["2", "6"]);
    assert.equal(sixth.status, 400);
    assert.deepEqual(sixth.body, { error: "clean_limit" });
    assert.equal((await clean(t, token, room.id, ["4"])).status, 200, "one asked before is still free");
    assert.equal((await clean(t, token, room.id, [])).status, 200);
    assert.equal(t.tag.calls.cleans.length, MAX_CLEANS_PER_ROOM);
  });

  it("turns a refused start into a failed removal", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    t.tag.state.cleanStart = { ok: false, status: 503, error: "busy" };
    const refused = await clean(t, token, room.id, ["2"]);
    assert.equal(refused.status, 200);
    assert.equal(refused.room.clean?.status, "failed");
    assert.equal(refused.room.clean?.error, "clean_failed");
  });

  it("refuses unknown items, rooms that are not ready and rooms of other sessions", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    assert.equal((await clean(t, token, room.id, ["3"])).status, 400, "a cushion is part of the sofa, not an item");
    assert.equal((await clean(t, token, room.id, ["99"])).status, 400);
    assert.equal((await clean(t, token, room.id, "2")).status, 400);
    assert.equal((await clean(t, token, room.id, Array.from({ length: 13 }, (_, i) => String(i)))).status, 400);
    assert.equal((await clean(t, token, room.id, ["bad id!"])).status, 400);
    assert.equal(t.tag.calls.cleans.length, 0);

    const other = await openSession(t.ctx);
    assert.deepEqual((await clean(t, other, room.id, ["2"])).body, { error: "not_found" });
    assert.equal((await cleanStatus(t, other, room.id)).status, 404);

    t.tag.state.roomJob = { status: "processing" };
    const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, other, "198.51.100.8"), t.ctx));
    const processing = (started.body.room as View).id;
    assert.deepEqual((await clean(t, other, processing, ["2"])).body, { error: "invalid_input" });
    const status = await cleanStatus(t, other, processing);
    assert.deepEqual(status.body, { room: { id: processing, status: "processing" } });
  });
});
