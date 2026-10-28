import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { KoshoyFile, KoshoyFileStore } from "../services/s3.server";
import type {
  KoshoyRenderInput,
  KoshoyTagService,
  RenderJob,
  RoomAnalysisJob,
  StartResult,
} from "../services/tag-service.server";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import { cabinetEngine, type CabinComposition } from "./engine";
import { handleKoshoyEdit, handleKoshoySession, type KoshoyRequestContext } from "./handlers.server";
import { createMemoryKoshoyDb, createMemoryRoomDb, sampleReadyRoom } from "./memory-db";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import { createBusyLock, createRateLimiter, KOSHOY_LIMITS } from "./rate-limit.server";
import { cabinetDescription, renderDescription } from "./render.server";
import {
  handleKoshoyLayout,
  handleKoshoyRender,
  handleKoshoyRenderFile,
  handleKoshoyRenderStatus,
  handleKoshoyRoom,
  handleKoshoyRoomFile,
  handleKoshoyRoomStatus,
} from "./room-handlers.server";
import { KOSHOY_JOB_DEADLINE_MS, type KoshoyRoomDeps } from "./room.server";
import { createKoshoyStore } from "./store.server";

const SHOP = "koshoy.myshopify.com";
/** Anything that would tell the browser where files live or who made them. */
const LEAKS =
  /amazonaws|mncdn|x-amz|sugar|decor|ihom|koshoy-render|koshoy-studio\/|pipeline|onnx|model|warning|fovSource|scaleSource|hand_height|phone_26mm|inlierRatio|tag-?service|ECONN|AccessDenied/i;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6]);
const jpegDataUrl = (bytes: Uint8Array = JPEG) =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

const ANALYSIS_LINK = "https://ihom.s3.eu-central-1.amazonaws.com/room-analysis/job-1";
/** A completed decor-ai answer, as tag-service passes it through. */
const ANALYSIS = {
  width: 1600,
  height: 1200,
  camera: {
    fovXDegrees: 60,
    fovYDegrees: 47.9,
    aspect: 1.3333,
    fx: 1385.6,
    fy: 1385.6,
    cx: 800,
    cy: 600,
    fovSource: "exif",
    axes: "x right, y down, z forward",
  },
  status: "partial",
  warnings: ["wall plane weak (decor-ai onnx)"],
  masks: {
    floor: `${ANALYSIS_LINK}/floor.png`,
    wall: `${ANALYSIS_LINK}/wall.png`,
    ceiling: `${ANALYSIS_LINK}/ceiling.png`,
    furniture: `${ANALYSIS_LINK}/furniture.png`,
  },
  depth: `${ANALYSIS_LINK}/depth.png`,
  depthScale: { min: 0.8, max: 6.4 },
  planes: {
    floor: { normal: [0, -1, 0], equation: [0, -1, 0, 1.3], inlierRatio: 0.92 },
    wall: { normal: [0, 0, -1], equation: [0, 0, -1, 3.1], inlierRatio: 0.71 },
  },
  projection: { type: "homography", direction: "image_to_floor", floorHomography: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  processingMs: 4200,
  pipelineVersion: "onnx-1.0.0",
};
const RENDER_LINK = "https://ihom.s3.eu-central-1.amazonaws.com/pipelines/koshoy-render/out.png";

function fakeTagService() {
  const calls = {
    rooms: [] as Array<{ photo: Uint8Array; fovDegrees?: number }>,
    renders: [] as KoshoyRenderInput[],
  };
  const state = {
    roomStart: { ok: true, jobId: "room-job-1" } as StartResult,
    roomJob: { status: "processing" } as RoomAnalysisJob,
    renderStart: { ok: true, jobId: "render-job-1" } as StartResult,
    renderJob: { status: "processing" } as RenderJob,
    readError: null as Error | null,
  };
  const service: KoshoyTagService = {
    async startRoomAnalysis(photo, fovDegrees) {
      calls.rooms.push({ photo, fovDegrees });
      return state.roomStart;
    },
    async getRoomAnalysis() {
      if (state.readError) throw state.readError;
      return state.roomJob;
    },
    async startRender(input) {
      calls.renders.push(input);
      return state.renderStart;
    },
    async getRender() {
      if (state.readError) throw state.readError;
      return state.renderJob;
    },
  };
  return { service, calls, state };
}

function fakeFiles() {
  const objects = new Map<string, KoshoyFile>();
  const files: KoshoyFileStore = {
    async put(name, file) {
      const key = `koshoy-studio/${name}`;
      objects.set(key, file);
      return key;
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async signedUrl(key, seconds) {
      return `https://cdn.sugartech.s3.eu-central-1.amazonaws.com/${key}?X-Amz-Expires=${seconds}&X-Amz-Signature=abc`;
    },
  };
  return { files, objects };
}

function setup(
  options: { roomLimit?: number; renderLimit?: number; readLimit?: number; layoutLimit?: number } = {},
) {
  const tag = fakeTagService();
  const storage = fakeFiles();
  const memory = createMemoryRoomDb();
  const downloads = new Map<string, Uint8Array>([
    [ANALYSIS.depth, PNG],
    [ANALYSIS.masks.floor, PNG],
    [RENDER_LINK, PNG],
  ]);
  const room: KoshoyRoomDeps = {
    db: memory.db,
    files: storage.files,
    tagService: async () => tag.service,
    download: async (url) => {
      const bytes = downloads.get(url);
      return bytes ? { bytes, contentType: "binary/octet-stream" } : null;
    },
  };
  const loose = () => createRateLimiter({ limit: 100, windowMs: 60_000 });
  const ctx: KoshoyRequestContext = {
    shop: SHOP,
    enabled: true,
    store: createKoshoyStore(createMemoryKoshoyDb().db),
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
      room: createRateLimiter({ ...KOSHOY_LIMITS.room, limit: options.roomLimit ?? KOSHOY_LIMITS.room.limit }),
      render: createRateLimiter({ ...KOSHOY_LIMITS.render, limit: options.renderLimit ?? KOSHOY_LIMITS.render.limit }),
      roomRead: createRateLimiter({ ...KOSHOY_LIMITS.roomRead, limit: options.readLimit ?? KOSHOY_LIMITS.roomRead.limit }),
      layout: createRateLimiter({ ...KOSHOY_LIMITS.layout, limit: options.layoutLimit ?? KOSHOY_LIMITS.layout.limit }),
    },
    busy: createBusyLock(),
    chatConfig: async () => ({ apiKey: "", mock: true }),
    journeyData: async () => KOSHOY_DATA_DEFAULTS,
    customerId: "c1",
    room,
  };
  return { ctx, room, tag, storage, memory, downloads };
}

type Setup = ReturnType<typeof setup>;

/** `ip` is the visitor address as the App Proxy forwards it. */
function post(path: string, body: unknown, token?: string, ip?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers["X-Forwarded-For"] = `${ip}, 23.227.38.1`;
  return new Request(`https://app.test/apps/koshoy/studio/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function get(pathAndQuery: string, token?: string): Request {
  return new Request(`https://app.test${pathAndQuery}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function openSession(ctx: KoshoyRequestContext): Promise<string> {
  const response = await handleKoshoySession(post("session", {}), ctx);
  return ((await response.json()) as { session: string }).session;
}

async function json(response: Response): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text };
}

/** Room photo sent and analysed: returns the ready RoomView. */
async function readyRoom(t: Setup, token: string) {
  t.tag.state.roomJob = { status: "processing" };
  const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
  const roomId = (started.body.room as { id: string }).id;
  t.tag.state.roomJob = { status: "completed", result: ANALYSIS };
  const ready = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
  assert.equal((ready.body.room as { status: string }).status, "ready");
  return ready.body.room as { id: string; files: Record<string, string> };
}

async function designFor(t: Setup, token: string, widthMm = 1920) {
  const session = await t.ctx.store.findSession(token, SHOP);
  assert.ok(session);
  return t.ctx.store.createDesign(session.id, {
    kind: "gardirop",
    label: "Gardırop 192 cm",
    composition: cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: widthMm }).composition,
  });
}

async function startRenderFor(t: Setup, token: string, roomId: string, designId: string, ip?: string) {
  return json(
    await handleKoshoyRender(
      post("render", { roomId, designId, composite: jpegDataUrl(), cabinet: jpegDataUrl() }, token, ip),
      t.ctx,
    ),
  );
}

describe("koshoy room photo and render endpoints", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  it("analyses a room photo and returns only whitelisted fields and its own file links", async () => {
    const t = setup();
    const token = await openSession(t.ctx);

    const started = await json(
      await handleKoshoyRoom(post("room", { image: jpegDataUrl(), fovDegrees: 63.5 }, token), t.ctx),
    );
    assert.equal(started.status, 200);
    const room = started.body.room as { id: string; status: string };
    assert.deepEqual(Object.keys(room).sort(), ["id", "status"]);
    assert.equal(room.status, "processing");
    assert.deepEqual(t.storage.objects.get(`koshoy-studio/rooms/${room.id}/photo.jpg`)?.bytes, JPEG);
    assert.deepEqual(t.tag.calls.rooms, [{ photo: JPEG, fovDegrees: 63.5 }]);

    const pending = await json(await handleKoshoyRoomStatus(post("room-status", { roomId: room.id }, token), t.ctx));
    assert.deepEqual(pending.body, { room: { id: room.id, status: "processing" } });

    t.tag.state.roomJob = { status: "completed", result: ANALYSIS };
    const ready = await json(await handleKoshoyRoomStatus(post("room-status", { roomId: room.id }, token), t.ctx));
    const link = (name: string) => `/apps/koshoy/studio/room-file?room=${room.id}&name=${name}`;
    // Visible wall: the wall 3.1 m ahead, seen across the photo width (focal from fovY 47.9°);
    // the test masks cannot be read, so the geometric range stays.
    const { wall, ...view } = ready.body.room as { wall: { fromM: number; toM: number } };
    const halfWall = (3.1 * 800) / (600 / Math.tan((47.9 * Math.PI) / 360));
    assert.ok(Math.abs(wall.fromM + halfWall) < 1e-6 && Math.abs(wall.toM - halfWall) < 1e-6, JSON.stringify(wall));
    assert.deepEqual({ room: view }, {
      room: {
        id: room.id,
        status: "ready",
        width: 1600,
        height: 1200,
        camera: { fovXDegrees: 60, fovYDegrees: 47.9, aspect: 1.3333, fx: 1385.6, fy: 1385.6, cx: 800, cy: 600 },
        planes: {
          floor: { normal: [0, -1, 0], equation: [0, -1, 0, 1.3] },
          wall: { normal: [0, 0, -1], equation: [0, 0, -1, 3.1] },
        },
        depthScale: { min: 0.8, max: 6.4 },
        files: {
          photo: link("photo"),
          depth: link("depth"),
          floor: link("floor"),
          wall: link("wall"),
          ceiling: link("ceiling"),
          furniture: link("furniture"),
        },
      },
    });
    assert.ok(!LEAKS.test(ready.text), ready.text);
    assert.equal((await t.ctx.store.findSession(token, SHOP))?.roomId, room.id, "session keeps the ready room");

    const photo = await handleKoshoyRoomFile(get(link("photo"), token), t.ctx);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("Content-Type"), "image/jpeg");
    assert.equal(photo.headers.get("Cache-Control"), "private, max-age=3600");
    assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), JPEG);

    const depth = await handleKoshoyRoomFile(get(link("depth"), token), t.ctx);
    assert.equal(depth.status, 200);
    assert.equal(depth.headers.get("Content-Type"), "image/png", "type from the bytes, not upstream");
    assert.deepEqual(new Uint8Array(await depth.arrayBuffer()), PNG);
    for (const [name, value] of depth.headers) assert.ok(!LEAKS.test(`${name}: ${value}`));

    const gone = await handleKoshoyRoomFile(get(link("wall"), token), t.ctx);
    assert.equal(gone.status, 404, "a file the analysis lost is a plain 404");
    const unknown = await handleKoshoyRoomFile(get(`/apps/koshoy/studio/room-file?room=${room.id}&name=projection`, token), t.ctx);
    assert.equal(unknown.status, 400);
  });

  it("allows each visitor one analysis and two renders a minute, whatever the session", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);

    const again = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
    assert.equal(again.status, 429);
    assert.deepEqual(again.body, { error: "rate_limited" });
    const fresh = await openSession(t.ctx);
    const newSession = await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, fresh), t.ctx);
    assert.equal(newSession.status, 429, "a new session does not reset the visitor's budget");
    assert.equal(t.tag.calls.rooms.length, 1);
    assert.equal(t.storage.objects.size, 1, "a refused request stores nothing");

    const otherVisitor = await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, fresh, "198.51.100.7"), t.ctx);
    assert.equal(otherVisitor.status, 200, "another address has its own budget");

    const design = await designFor(t, token);
    assert.equal((await startRenderFor(t, token, room.id, design.id)).status, 200, "renders have their own budget");
    assert.equal((await startRenderFor(t, token, room.id, design.id)).status, 200);
    const third = await startRenderFor(t, token, room.id, design.id);
    assert.equal(third.status, 429);
    assert.deepEqual(third.body, { error: "rate_limited" });
    assert.equal(t.tag.calls.renders.length, 2);
  });

  it("caps status polls and file reads per session", async () => {
    const t = setup({ readLimit: 3 });
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token); // one status poll
    assert.equal((await handleKoshoyRoomFile(get(room.files.photo, token), t.ctx)).status, 200);
    assert.equal((await handleKoshoyRoomFile(get(room.files.depth, token), t.ctx)).status, 200);
    const limited = await json(await handleKoshoyRoomStatus(post("room-status", { roomId: room.id }, token), t.ctx));
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: "rate_limited" });
    const other = await openSession(t.ctx);
    const otherPoll = await handleKoshoyRoomStatus(post("room-status", { roomId: room.id }, other), t.ctx);
    assert.equal(otherPoll.status, 404, "another session polls on its own budget");
  });

  it("records consent, retries a failed session update and returns the room with the session", async () => {
    const t = setup({ roomLimit: 100 });
    const token = await openSession(t.ctx);
    const withoutRoom = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    assert.equal("room" in withoutRoom.body, false);

    const consented = await json(
      await handleKoshoyRoom(post("room", { image: jpegDataUrl(), consent: true }, token), t.ctx),
    );
    const roomId = (consented.body.room as { id: string }).id;
    assert.ok(t.memory.rooms.get(roomId)?.consentAt instanceof Date);
    for (const consent of [undefined, false, "yes"]) {
      const response = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl(), consent }, token), t.ctx));
      assert.equal(response.status, 200);
      assert.equal(t.memory.rooms.get((response.body.room as { id: string }).id)?.consentAt, null);
    }

    const setRoom = t.ctx.store.setRoom;
    let failOnce = true;
    t.ctx.store.setRoom = async (sessionId, id) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("SQLITE_BUSY");
      }
      return setRoom(sessionId, id);
    };
    t.tag.state.roomJob = { status: "completed", result: ANALYSIS };
    const poll = () => handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx);
    const first = await json(await poll());
    assert.equal((first.body.room as { status: string }).status, "ready", "the customer still gets the room");
    assert.equal((await t.ctx.store.findSession(token, SHOP))?.roomId, null);
    const retried = await json(await poll());
    assert.equal(retried.status, 200);
    assert.equal((await t.ctx.store.findSession(token, SHOP))?.roomId, roomId, "the next poll writes it");

    const resumed = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    assert.deepEqual(resumed.body.room, retried.body.room);
    assert.ok(!LEAKS.test(resumed.text), resumed.text);
  });

  it("answers 404 for rooms and renders of another session", async () => {
    const t = setup();
    const owner = await openSession(t.ctx);
    const room = await readyRoom(t, owner);
    const design = await designFor(t, owner);
    const render = (await startRenderFor(t, owner, room.id, design.id)).body.render as { id: string };

    const stranger = await openSession(t.ctx);
    const strangerDesign = await designFor(t, stranger);
    const notFound = { error: "not_found" };

    const status = await json(await handleKoshoyRoomStatus(post("room-status", { roomId: room.id }, stranger), t.ctx));
    assert.equal(status.status, 404);
    assert.deepEqual(status.body, notFound);
    const file = await handleKoshoyRoomFile(get(room.files.photo, stranger), t.ctx);
    assert.equal(file.status, 404);
    const renderInTheirRoom = await startRenderFor(t, stranger, room.id, strangerDesign.id);
    assert.equal(renderInTheirRoom.status, 404);
    const theirDesign = await startRenderFor(t, owner, room.id, strangerDesign.id);
    assert.equal(theirDesign.status, 404, "a design of another session is not found either");
    const renderStatus = await json(await handleKoshoyRenderStatus(post("render-status", { renderId: render.id }, stranger), t.ctx));
    assert.equal(renderStatus.status, 404);
    assert.deepEqual(renderStatus.body, notFound);
    const renderFile = await handleKoshoyRenderFile(get(`/apps/koshoy/studio/render-file?render=${render.id}`, stranger), t.ctx);
    assert.equal(renderFile.status, 404);
    assert.equal(t.tag.calls.renders.length, 1);
  });

  it("rejects bad input, missing sessions and an unconfigured backend", async () => {
    const t = setup({ roomLimit: 100, renderLimit: 100 });
    const token = await openSession(t.ctx);
    const status = async (response: Promise<Response>) => (await response).status;

    const noSession = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }), t.ctx));
    assert.equal(noSession.status, 401);
    assert.deepEqual(noSession.body, { error: "session_expired" });
    assert.equal(await status(handleKoshoyRoomFile(get("/apps/koshoy/studio/room-file?room=abc&name=photo"), t.ctx)), 401);

    const png = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    for (const body of [
      {},
      { image: png },
      { image: "data:image/jpeg;base64,iVBORw0KGgo=" },
      { image: jpegDataUrl(), fovDegrees: 10 },
      { image: jpegDataUrl(), fovDegrees: "60" },
    ]) {
      const bad = await json(await handleKoshoyRoom(post("room", body, token), t.ctx));
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.deepEqual(bad.body, { error: "invalid_input" });
    }
    assert.equal(t.tag.calls.rooms.length, 0);
    assert.equal(await status(handleKoshoyRoomStatus(post("room-status", { roomId: "../x" }, token), t.ctx)), 400);

    // A render needs a ready room and two JPEG captures.
    const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
    const roomId = (started.body.room as { id: string }).id;
    const design = await designFor(t, token);
    assert.equal((await startRenderFor(t, token, roomId, design.id)).status, 400, "room still processing");
    const noCapture = await handleKoshoyRender(
      post("render", { roomId, designId: design.id, composite: jpegDataUrl(), cabinet: png }, token),
      t.ctx,
    );
    assert.equal(noCapture.status, 400);

    const unconfigured = await json(
      await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), { ...t.ctx, room: undefined }),
    );
    assert.equal(unconfigured.status, 503);
    assert.deepEqual(unconfigured.body, { error: "unavailable" });
    const disabled = await handleKoshoyRenderStatus(post("render-status", { renderId: "abc" }, token), { ...t.ctx, enabled: false });
    assert.equal(disabled.status, 503);
  });

  it("maps upstream failures to generic codes and never passes upstream text on", async () => {
    const t = setup({ roomLimit: 100 });
    const token = await openSession(t.ctx);
    const send = async () => {
      const response = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
      assert.ok(!LEAKS.test(response.text), response.text);
      return response.body.room as { id: string; status: string; error?: string };
    };
    const check = async (roomId: string) => {
      const response = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
      assert.ok(!LEAKS.test(response.text), response.text);
      return response.body.room as { id: string; status: string; error?: string };
    };

    t.tag.state.roomStart = { ok: false, status: 503 };
    const refused = await send();
    assert.deepEqual(refused, { id: refused.id, status: "failed", error: "analysis_failed" });
    assert.ok(t.storage.objects.has(`koshoy-studio/rooms/${refused.id}/photo.jpg`), "stored photo keeps its row");
    assert.equal(t.memory.rooms.get(refused.id)?.status, "failed");

    t.tag.state.roomStart = { ok: true, jobId: "room-job-2" };
    const failing = await send();
    t.tag.state.roomJob = { status: "failed" };
    assert.deepEqual(await check(failing.id), { id: failing.id, status: "failed", error: "analysis_failed" });

    const expiring = await send();
    t.tag.state.roomJob = { status: "expired" };
    assert.deepEqual(await check(expiring.id), { id: expiring.id, status: "failed", error: "expired" });

    const unusable = await send();
    t.tag.state.roomJob = { status: "completed", result: { ...ANALYSIS, depth: "http://10.0.0.5/depth.png" } };
    assert.deepEqual(await check(unusable.id), { id: unusable.id, status: "failed", error: "analysis_failed" });

    const flaky = await send();
    t.tag.state.readError = new Error("connect ECONNREFUSED tagservice:8080");
    assert.deepEqual(await check(flaky.id), { id: flaky.id, status: "processing" }, "a hiccup keeps polling");
    t.tag.state.readError = null;

    const s3Down = setup();
    s3Down.storage.files.put = async () => {
      throw new Error("AccessDenied: bucket cdn.sugartech");
    };
    const s3Token = await openSession(s3Down.ctx);
    const down = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, s3Token), s3Down.ctx));
    assert.equal(down.status, 503);
    assert.deepEqual(down.body, { error: "unavailable" });
    assert.equal(s3Down.tag.calls.rooms.length, 0, "no analysis without a stored photo");
  });

  it("renders through short-lived signed links and serves the result itself", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const design = await designFor(t, token);

    const started = await startRenderFor(t, token, room.id, design.id);
    assert.equal(started.status, 200);
    const render = started.body.render as { id: string; status: string };
    assert.deepEqual(render, { id: render.id, status: "processing" });
    assert.ok(!LEAKS.test(started.text), started.text);

    const [input] = t.tag.calls.renders;
    const photoKey = t.memory.rooms.get(room.id)?.photoKey;
    assert.equal(input.roomImageUrl, await t.room.files.signedUrl(photoKey ?? "", 900));
    assert.match(input.compositeImageUrl, new RegExp(`renders/${render.id}/composite\\.jpg\\?X-Amz-Expires=900&`));
    assert.match(input.cabinetImageUrl, new RegExp(`renders/${render.id}/cabinet\\.jpg\\?X-Amz-Expires=900&`));
    assert.equal(input.cabinetDescription, cabinetDescription(cabinetEngine, design));
    assert.deepEqual(Object.keys(input).sort(), [
      "cabinetDescription",
      "cabinetImageUrl",
      "compositeImageUrl",
      "roomImageUrl",
    ]);
    assert.deepEqual(t.storage.objects.get(`koshoy-studio/renders/${render.id}/cabinet.jpg`)?.bytes, JPEG);

    const statusOf = async () =>
      json(await handleKoshoyRenderStatus(post("render-status", { renderId: render.id }, token), t.ctx));
    assert.deepEqual((await statusOf()).body, { render: { id: render.id, status: "processing" } });

    t.tag.state.renderJob = { status: "completed", imageUrl: RENDER_LINK, imageBase64: "", mimeType: "image/png" };
    const ready = await statusOf();
    assert.deepEqual(ready.body, {
      render: { id: render.id, status: "ready", file: `/apps/koshoy/studio/render-file?render=${render.id}` },
    });
    assert.ok(!LEAKS.test(ready.text), ready.text);
    assert.deepEqual(t.storage.objects.get(`koshoy-studio/renders/${render.id}/result.png`)?.bytes, PNG);

    const file = await handleKoshoyRenderFile(get(`/apps/koshoy/studio/render-file?render=${render.id}`, token), t.ctx);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG);
  });

  it("stores an inline render result and gives up a render that never finishes", async () => {
    const t = setup({ renderLimit: 100 });
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const design = await designFor(t, token);
    const statusOf = async (renderId: string) =>
      (await json(await handleKoshoyRenderStatus(post("render-status", { renderId }, token), t.ctx))).body.render;

    const inline = (await startRenderFor(t, token, room.id, design.id)).body.render as { id: string };
    // A generated JPEG names its maker in an APP11 (C2PA) block; it is dropped before storing.
    const signed = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xeb, 0x00, 0x0d]),
      Buffer.from("Google C2PA"),
      Buffer.from([0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]),
    ]);
    t.tag.state.renderJob = {
      status: "completed",
      imageUrl: "",
      imageBase64: signed.toString("base64"),
      mimeType: "image/jpeg",
    };
    assert.equal((await statusOf(inline.id) as { status: string }).status, "ready");
    const stored = t.storage.objects.get(`koshoy-studio/renders/${inline.id}/result.jpg`)!.bytes;
    assert.ok(!Buffer.from(stored).toString("latin1").includes("Google"), "metadata stripped");
    assert.deepEqual(Buffer.from(stored), Buffer.concat([signed.subarray(0, 2), signed.subarray(17)]));

    t.tag.state.renderJob = { status: "processing" };
    const stuck = (await startRenderFor(t, token, room.id, design.id)).body.render as { id: string };
    t.tag.state.readError = new Error("read timeout");
    assert.deepEqual(await statusOf(stuck.id), { id: stuck.id, status: "processing" });
    t.tag.state.readError = null;
    t.room.now = () => Date.now() + KOSHOY_JOB_DEADLINE_MS + 1;
    assert.deepEqual(await statusOf(stuck.id), { id: stuck.id, status: "failed", error: "render_failed" });

    t.room.now = undefined;
    t.tag.state.renderJob = { status: "completed", imageUrl: "", imageBase64: "bm90IGFuIGltYWdl", mimeType: "image/png" };
    const junk = (await startRenderFor(t, token, room.id, design.id)).body.render as { id: string };
    assert.deepEqual(await statusOf(junk.id), { id: junk.id, status: "failed", error: "render_failed" });
  });

  it("re-guesses the angle of a photo without EXIF and keeps the choice server-side", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
    const roomId = (started.body.room as { id: string }).id;
    t.tag.state.roomJob = {
      status: "completed",
      result: { ...ANALYSIS, camera: { ...ANALYSIS.camera, fovSource: "default" } },
    };
    const ready = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
    const room = ready.body.room as {
      camera: { fovXDegrees: number; fx: number; fy: number };
      planes: { floor: { equation: number[] }; wall: { equation: number[] } };
      depthScale: unknown;
    };
    // Floor 1.3 m under the camera (fx 1385.6) → 1.4 m at fx 1286.6, ≈ 63.75°.
    assert.ok(Math.abs(room.camera.fovXDegrees - 63.745) < 0.01, String(room.camera.fovXDegrees));
    assert.equal(room.camera.fy, room.camera.fx);
    assert.ok(Math.abs(room.planes.floor.equation[3] - 1.4) < 1e-9);
    assert.deepEqual(room.planes.wall.equation, [0, 0, -1, 3.1], "a wall facing the camera keeps its distance");
    assert.deepEqual(room.depthScale, ANALYSIS.depthScale);
    assert.ok(!LEAKS.test(ready.text), ready.text);
    assert.equal(t.memory.rooms.get(roomId)?.scaleSource, "hand_height");
  });

  it("adds, moves and removes designs in the room layout", async () => {
    const t = setup({ layoutLimit: 6 });
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const a = await designFor(t, token, 960);
    const b = await designFor(t, token, 960);
    const layout = async (body: Record<string, unknown>, who = token) =>
      json(await handleKoshoyLayout(post("layout", body, who), t.ctx));

    const added = await layout({ op: "add", designId: a.id });
    assert.equal(added.status, 200);
    const view = added.body.layout as { version: number; roomId: string; items: Array<Record<string, unknown>> };
    assert.equal(view.version, 1);
    assert.equal(view.roomId, room.id);
    assert.deepEqual(view.items, [{ designId: a.id, label: a.label, place: { surface: "wall", alongM: 0 } }]);
    assert.deepEqual((added.body.events as Array<{ type: string; designId: string }>).map((event) => [event.type, event.designId]), [["scene", a.id]]);
    assert.ok(!LEAKS.test(added.text), added.text);

    const dragged = await layout({ op: "add", designId: b.id, place: { surface: "wall", alongM: 0.1 } });
    const items = (dragged.body.layout as typeof view).items;
    assert.equal((dragged.body.layout as typeof view).version, 2);
    assert.equal(items.length, 2);
    assert.deepEqual(items[1].place, { surface: "wall", alongM: 0.96 }, "next to a, not on it");

    const moved = await layout({ op: "move", designId: a.id, place: { surface: "wall", alongM: -1 } });
    assert.equal((moved.body.layout as typeof view).version, 3);
    assert.equal((await layout({ op: "move", designId: "nobody1", place: { surface: "wall", alongM: 0 } })).status, 404);
    assert.equal((await layout({ op: "add", designId: a.id, place: { surface: "floor", xM: 0, forwardM: 2, rotDeg: 0 } })).status, 400, "this room has a wall");
    assert.equal((await layout({ op: "jump", designId: a.id })).status, 400);
    assert.equal((await layout({ op: "move", designId: a.id, place: { surface: "wall", alongM: 99 } })).status, 400, "|m| ≤ 50");
    const removed = await layout({ op: "remove", designId: a.id });
    assert.deepEqual((removed.body.layout as typeof view).items.map((item) => item.designId), [b.id]);

    const stranger = await openSession(t.ctx);
    assert.equal((await layout({ op: "add", designId: b.id }, stranger)).status, 404, "another session's design");
    const limited = await layout({ op: "remove", designId: b.id });
    assert.equal(limited.status, 429, "120 a minute in production; 6 here (malformed bodies are not counted)");
  });

  it("returns the layout and its designs' scenes with the session", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    await readyRoom(t, token);
    const a = await designFor(t, token, 960);
    const b = await designFor(t, token, 960);
    for (const design of [a, b]) await handleKoshoyLayout(post("layout", { op: "add", designId: design.id }, token), t.ctx);

    const resumed = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    const layout = resumed.body.layout as { version: number; items: Array<{ designId: string }> };
    assert.equal(layout.version, 2);
    assert.deepEqual(layout.items.map((item) => item.designId), [a.id, b.id]);
    const scenes = (resumed.body.events as Array<{ type: string; designId?: string }>).filter((event) => event.type === "scene");
    assert.deepEqual(scenes.map((event) => event.designId).sort(), [a.id, b.id].sort());
    assert.ok(!LEAKS.test(resumed.text), resumed.text);
  });

  it("brings the room photo and finished pictures back at their place in the thread", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const design = await designFor(t, token);
    const ready = (await startRenderFor(t, token, room.id, design.id)).body.render as { id: string };
    const failed = (await startRenderFor(t, token, room.id, design.id, "203.0.113.9")).body.render as { id: string };
    Object.assign(t.memory.rooms.get(room.id)!, { createdAt: new Date(2_000) });
    Object.assign(t.memory.renders.get(ready.id)!, { status: "ready", updatedAt: new Date(4_000) });
    Object.assign(t.memory.renders.get(failed.id)!, { status: "failed", updatedAt: new Date(5_000) });
    const session = await t.ctx.store.findSession(token, SHOP);
    assert.ok(session);
    session.events = [
      { type: "text", text: "Eski metin" },
      { type: "text", text: "Fotoğrafı ekler misin?", at: 1_000 },
      { type: "text", text: "Görseli hazırlıyorum.", at: 3_000 },
      { type: "text", text: "Nasıl buldun?", at: 6_000 },
    ];
    await t.ctx.store.saveSession(session);

    const resumed = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    const thread = (resumed.body.events as Array<Record<string, unknown>>).filter((event) =>
      ["text", "photo", "render"].includes(String(event.type)),
    );
    assert.deepEqual(thread, [
      { type: "text", text: "Eski metin" },
      { type: "text", text: "Fotoğrafı ekler misin?" },
      { type: "photo", roomId: room.id },
      { type: "text", text: "Görseli hazırlıyorum." },
      { type: "render", renderId: ready.id },
      { type: "text", text: "Nasıl buldun?" },
    ], "times stay on the server; a failed picture is not shown");
    assert.ok(!LEAKS.test(resumed.text), resumed.text);
  });

  it("renders every design standing in the room, left to right", async () => {
    const t = setup({ renderLimit: 100 });
    const token = await openSession(t.ctx);
    const room = await readyRoom(t, token);
    const right = await designFor(t, token, 960);
    const left = await designFor(t, token, 960);
    await handleKoshoyLayout(post("layout", { op: "add", designId: right.id, place: { surface: "wall", alongM: 0.5 } }, token), t.ctx);
    await handleKoshoyLayout(post("layout", { op: "add", designId: left.id, place: { surface: "wall", alongM: -1.4 } }, token), t.ctx);

    const started = await json(
      await handleKoshoyRender(post("render", { roomId: room.id, composite: jpegDataUrl(), cabinet: jpegDataUrl() }, token), t.ctx),
    );
    assert.equal(started.status, 200);
    const description = t.tag.calls.renders[0].cabinetDescription;
    assert.equal(description, renderDescription(cabinetEngine, [left, right]));
    assert.match(description, /^Soldan sağa:\n1\) [^\n]+\n2\) [^\n]+$/, "one line per cabinet");
    const renderId = (started.body.render as { id: string }).id;
    assert.deepEqual(JSON.parse(t.memory.renders.get(renderId)!.designIds), [left.id, right.id]);

    const empty = setup();
    const emptyToken = await openSession(empty.ctx);
    const emptyRoom = await readyRoom(empty, emptyToken);
    const nothing = await handleKoshoyRender(
      post("render", { roomId: emptyRoom.id, composite: jpegDataUrl(), cabinet: jpegDataUrl() }, emptyToken),
      empty.ctx,
    );
    assert.equal(nothing.status, 400, "an empty room and no designId: nothing to draw");
  });

  it("re-settles the room when a panel edit widens a design", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    await readyRoom(t, token);
    const a = await designFor(t, token, 960);
    const b = await designFor(t, token, 960);
    await handleKoshoyLayout(post("layout", { op: "add", designId: a.id, place: { surface: "wall", alongM: -1 } }, token), t.ctx);
    await handleKoshoyLayout(post("layout", { op: "add", designId: b.id, place: { surface: "wall", alongM: 0.6 } }, token), t.ctx);
    const edit = await json(
      await handleKoshoyEdit(
        post("edit", { designId: a.id, version: 1, op: { action: "set_total_width", widthMm: 2400 } }, token),
        t.ctx,
      ),
    );
    const layoutEvent = (edit.body.events as Array<{ type: string; items?: Array<{ designId: string; place: { alongM: number } }> }>).find(
      (event) => event.type === "layout",
    );
    assert.ok(layoutEvent?.items, "the edit answer carries the new layout");
    const [placedA, placedB] = layoutEvent.items;
    assert.ok(placedB.place.alongM - placedA.place.alongM >= (2.4 + 0.96) / 2 - 1e-6, "no overlap after widening");
  });

  it("fails a photo without a usable floor right away (no_floor)", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
    const roomId = (started.body.room as { id: string }).id;
    // A table top taken for the floor: 5 cm under the camera (the 3D view wants 30 cm).
    const tableTop = { normal: [0, -1, 0], equation: [0, -1, 0, 0.05], inlierRatio: 0.9 };
    t.tag.state.roomJob = { status: "completed", result: { ...ANALYSIS, planes: { ...ANALYSIS.planes, floor: tableTop } } };
    const status = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
    assert.deepEqual(status.body, { room: { id: roomId, status: "failed", error: "no_floor" } });
    assert.equal((await t.ctx.store.findSession(token, SHOP))?.roomId, null, "not the session's room");
  });

  it("starts the room layout when the room becomes ready, with the active design in it", async () => {
    const t = setup();
    const token = await openSession(t.ctx);
    const active = await designFor(t, token, 960);
    const session = (await t.ctx.store.findSession(token, SHOP))!;
    session.activeDesignId = active.id;
    await t.ctx.store.saveSession(session);
    const before = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    assert.equal("layout" in before.body, false, "no ready room, no layout yet");

    t.tag.state.roomJob = { status: "processing" };
    const started = await json(await handleKoshoyRoom(post("room", { image: jpegDataUrl() }, token), t.ctx));
    const roomId = (started.body.room as { id: string }).id;
    t.tag.state.roomJob = { status: "completed", result: ANALYSIS };
    const ready = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
    const layout = ready.body.layout as {
      version: number;
      roomId: string;
      items: Array<{ designId: string; place: { surface: string } }>;
      target: { surface: string; wall: { fromM: number; toM: number } };
    };
    assert.equal(layout.roomId, roomId);
    assert.deepEqual(layout.items.map((item) => [item.designId, item.place.surface]), [[active.id, "wall"]]);
    assert.equal(layout.target.surface, "wall");
    assert.deepEqual(layout.target.wall, (ready.body.room as { wall: unknown }).wall, "the room's visible wall");
    assert.deepEqual((ready.body.events as Array<{ type: string }>).map((event) => event.type), ["scene"]);
    assert.ok(!LEAKS.test(ready.text), ready.text);

    const again = await json(await handleKoshoyRoomStatus(post("room-status", { roomId }, token), t.ctx));
    assert.equal((again.body.layout as { version: number }).version, layout.version, "later polls do not write");
    const resumed = await json(await handleKoshoySession(post("session", {}, token), t.ctx));
    assert.deepEqual((resumed.body.layout as typeof layout).items.map((item) => item.designId), [active.id]);

    // Without an active design the room still starts a layout, an empty one.
    const empty = setup();
    const emptyToken = await openSession(empty.ctx);
    const emptyRoom = await readyRoom(empty, emptyToken);
    const emptySession = await json(await handleKoshoySession(post("session", {}, emptyToken), empty.ctx));
    const emptyLayout = emptySession.body.layout as typeof layout;
    assert.deepEqual(emptyLayout.items, []);
    assert.equal(emptyLayout.roomId, emptyRoom.id);
    assert.equal(emptyLayout.target.surface, "wall");
  });

  it("renders the layout moved into a room that became ready meanwhile", async () => {
    const t = setup({ renderLimit: 100 });
    const token = await openSession(t.ctx);
    const left = await designFor(t, token, 960);
    const right = await designFor(t, token, 960);
    // Laid out in the studio first (no room yet).
    for (const [design, alongM] of [[left, -1], [right, 1]] as const) {
      await handleKoshoyLayout(post("layout", { op: "add", designId: design.id, place: { surface: "wall", alongM } }, token), t.ctx);
    }
    const session = (await t.ctx.store.findSession(token, SHOP))!;
    t.memory.rooms.set("room_r", sampleReadyRoom("room_r", session.id));
    await t.ctx.store.setRoom(session.id, "room_r");

    const started = await json(
      await handleKoshoyRender(post("render", { roomId: "room_r", composite: jpegDataUrl(), cabinet: jpegDataUrl() }, token), t.ctx),
    );
    assert.equal(started.status, 200);
    assert.equal(t.tag.calls.renders[0].cabinetDescription, renderDescription(cabinetEngine, [left, right]));
    const renderId = (started.body.render as { id: string }).id;
    assert.deepEqual(JSON.parse(t.memory.renders.get(renderId)!.designIds), [left.id, right.id]);
  });

  it("describes the cabinet for the render prompt in product language", () => {
    const composition: CabinComposition = {
      units: [
        { id: "cabin-1", widthMm: 960, heightMm: 2304, fittings: [{ id: "f1", kind: "shelf" }], hasDoor: true, color: "wood" },
        { id: "cabin-2", widthMm: 960, heightMm: 2304, fittings: [], hasDoor: false, color: "wood" },
      ],
      depthMm: 640,
      hasPlinth: true,
      color: "wood",
    };
    const text = cabinetDescription(cabinetEngine, { id: "d1", kind: "gardirop", label: "Gardırop 192 cm", version: 1, composition });
    assert.match(text, /^\d+ kapaklı gardırop, ahşap, 192 cm genişlik, 230,4 cm yükseklik, 64 cm derinlik$/);
  });
});
