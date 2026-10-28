import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KoshoyFile, KoshoyFileStore } from "../services/s3.server";
import type { KoshoyTagService, RoomAnalysisJob } from "../services/tag-service.server";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import { cabinetEngine } from "./engine";
import { handleKoshoySession, type KoshoyRequestContext } from "./handlers.server";
import { createMemoryKoshoyDb, createMemoryPhoneDb, createMemoryRoomDb } from "./memory-db";
import {
  handleKoshoyPhoneCheck,
  handleKoshoyPhoneLink,
  handleKoshoyPhoneLinkStatus,
  handleKoshoyPhonePhoto,
} from "./phone-handlers.server";
import { KOSHOY_PHONE_LINK_TTL_MS, KOSHOY_PHONE_SEND_GRACE_MS, type KoshoyPhoneDeps } from "./phone-link.server";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import { createBusyLock, createRateLimiter, KOSHOY_LIMITS } from "./rate-limit.server";
import { handleKoshoyRoomStatus } from "./room-handlers.server";
import type { KoshoyRoomDeps } from "./room.server";
import { createKoshoyStore } from "./store.server";

const SHOP = "koshoy.myshopify.com";
const STOREFRONT = "https://koshoy.com";
const PAGE = "/pages/tasarla";
/** Anything that would tell the browser where files live or who made them. */
const LEAKS = /amazonaws|mncdn|x-amz|sugar|decor|koshoy-studio\/|tag-?service|tokenHash|sessionId/i;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const jpegDataUrl = () => `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`;

function setup(options: { failUpload?: boolean } = {}) {
  const clock = { now: Date.parse("2026-10-23T12:00:00Z") };
  const now = () => clock.now;
  const rooms: Array<{ photo: Uint8Array; fovDegrees?: number }> = [];
  const state = { roomJob: { status: "processing" } as RoomAnalysisJob, failUpload: options.failUpload ?? false };
  const tagService: KoshoyTagService = {
    async startRoomAnalysis(photo, fovDegrees) {
      rooms.push({ photo, fovDegrees });
      return { ok: true, jobId: "room-job-1" };
    },
    async getRoomAnalysis() {
      return state.roomJob;
    },
    async startRender() {
      return { ok: true, jobId: "render-job-1" };
    },
    async getRender() {
      return { status: "processing" };
    },
  };
  const objects = new Map<string, KoshoyFile>();
  const files: KoshoyFileStore = {
    async put(name, file) {
      if (state.failUpload) throw new Error("AccessDenied amazonaws");
      objects.set(`koshoy-studio/${name}`, file);
      return `koshoy-studio/${name}`;
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async signedUrl(key) {
      return `https://cdn.sugartech.s3.amazonaws.com/${key}`;
    },
  };
  const roomDb = createMemoryRoomDb(now);
  const room: KoshoyRoomDeps = {
    db: roomDb.db,
    files,
    tagService: async () => tagService,
    download: async () => null,
    now,
  };
  const phoneDb = createMemoryPhoneDb(now);
  const phone: KoshoyPhoneDeps = {
    db: phoneDb.db,
    storefrontOrigin: async () => STOREFRONT,
    limits: {
      create: createRateLimiter(KOSHOY_LIMITS.phoneLink),
      check: createRateLimiter(KOSHOY_LIMITS.phoneCheck),
    },
    now,
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
      room: createRateLimiter(KOSHOY_LIMITS.room),
      render: loose(),
      roomRead: loose(),
      layout: loose(),
    },
    busy: createBusyLock(),
    chatConfig: async () => ({ apiKey: "", mock: true }),
    journeyData: async () => KOSHOY_DATA_DEFAULTS,
    customerId: "c1",
    room,
    phone,
  };
  return { ctx, clock, rooms, state, roomDb, phoneDb };
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

async function json(response: Response): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text };
}

async function openSession(t: Setup): Promise<string> {
  const response = await handleKoshoySession(post("session", {}), t.ctx);
  return ((await response.json()) as { session: string }).session;
}

interface LinkBody {
  id: string;
  url: string;
  qr: string;
  expiresInMs: number;
}

async function newLink(t: Setup, session: string): Promise<LinkBody & { token: string }> {
  const res = await json(await handleKoshoyPhoneLink(post("phone-link", { page: PAGE }, session), t.ctx));
  assert.equal(res.status, 200);
  const link = res.body.link as LinkBody;
  return { ...link, token: link.url.split("#telefon=")[1] };
}

const status = async (t: Setup, session: string, linkId: string) =>
  json(await handleKoshoyPhoneLinkStatus(post("phone-link-status", { linkId }, session), t.ctx));

const photo = async (t: Setup, link: string, extra: Record<string, unknown> = {}, ip = "10.0.0.2") =>
  json(
    await handleKoshoyPhonePhoto(
      post("phone-photo", { link, image: jpegDataUrl(), consent: true, ...extra }, undefined, ip),
      t.ctx,
    ),
  );

describe("phone link", () => {
  it("makes a 5-minute link on the storefront page, with the token in the fragment and a QR", async () => {
    const t = setup();
    const session = await openSession(t);
    const res = await json(await handleKoshoyPhoneLink(post("phone-link", { page: PAGE }, session), t.ctx));

    assert.equal(res.status, 200);
    const link = res.body.link as LinkBody;
    assert.deepEqual(Object.keys(link).sort(), ["expiresInMs", "id", "qr", "url"]);
    assert.match(link.url, /^https:\/\/koshoy\.com\/pages\/tasarla#telefon=[A-Za-z0-9_-]{43}$/);
    assert.equal(link.expiresInMs, KOSHOY_PHONE_LINK_TTL_MS);
    assert.equal(KOSHOY_PHONE_LINK_TTL_MS, 5 * 60 * 1000);
    assert.match(link.qr, /^data:image\/svg\+xml;base64,/);
    assert.match(Buffer.from(link.qr.split(",")[1], "base64").toString("utf8"), /^<svg/);
    // The link token is not the session token, and only its hash is stored.
    const token = link.url.split("#telefon=")[1];
    assert.notEqual(token, session);
    const row = [...t.phoneDb.links.values()][0];
    assert.notEqual(row.tokenHash, token);
    assert.doesNotMatch(res.text.replace(link.qr, ""), LEAKS);
  });

  it("needs the session and a plain page path", async () => {
    const t = setup();
    const session = await openSession(t);
    assert.equal((await handleKoshoyPhoneLink(post("phone-link", { page: PAGE }), t.ctx)).status, 401);
    for (const page of ["/", "/en", "/pages/tasarla"]) {
      const res = await json(await handleKoshoyPhoneLink(post("phone-link", { page }, session), t.ctx));
      assert.equal(res.status, 200, page);
      assert.ok((res.body.link as LinkBody).url.startsWith(`${STOREFRONT}${page}#telefon=`));
    }
    for (const page of ["https://evil.test/x", "/pages/x?y=1", "//evil.test", "/Pages/X", "/x/", "", 5]) {
      const res = await handleKoshoyPhoneLink(post("phone-link", { page }, session), t.ctx);
      assert.equal(res.status, 400, String(page));
    }
  });

  it("is off without the room feature", async () => {
    const t = setup();
    const session = await openSession(t);
    t.ctx.room = undefined;
    const res = await json(await handleKoshoyPhoneLink(post("phone-link", { page: PAGE }, session), t.ctx));
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: "unavailable" });
  });

  it("limits new links per session", async () => {
    const t = setup();
    const session = await openSession(t);
    for (let i = 0; i < KOSHOY_LIMITS.phoneLink.limit; i += 1) await newLink(t, session);
    const res = await handleKoshoyPhoneLink(post("phone-link", { page: PAGE }, session), t.ctx);
    assert.equal(res.status, 429);
  });
});

describe("phone check", () => {
  it("opens a fresh link and refuses unknown, replaced and expired ones the same way", async () => {
    const t = setup();
    const session = await openSession(t);
    const first = await newLink(t, session);

    const open = await json(await handleKoshoyPhoneCheck(post("phone-check", { link: first.token }), t.ctx));
    assert.equal(open.status, 200);
    assert.deepEqual(open.body, { phone: { status: "open", expiresInMs: KOSHOY_PHONE_LINK_TTL_MS } });

    const refused = async (link: unknown) => {
      const res = await json(await handleKoshoyPhoneCheck(post("phone-check", { link }), t.ctx));
      assert.equal(res.status, 410);
      assert.deepEqual(res.body, { error: "link_expired" });
    };
    await refused("A".repeat(43));
    await refused(session); // the session token is not a link
    await refused(undefined);

    const second = await newLink(t, session);
    await refused(first.token); // a new QR replaces the old one

    t.clock.now += KOSHOY_PHONE_LINK_TTL_MS;
    await refused(second.token);
  });

  it("does not open another shop's link", async () => {
    const t = setup();
    const session = await openSession(t);
    const link = await newLink(t, session);
    t.ctx.shop = "other.myshopify.com";
    const res = await handleKoshoyPhoneCheck(post("phone-check", { link: link.token }), t.ctx);
    assert.equal(res.status, 410);
  });
});

describe("phone photo", () => {
  it("puts the photo into the desktop session as a room, and the desktop sees it", async () => {
    const t = setup();
    const session = await openSession(t);
    const link = await newLink(t, session);
    assert.deepEqual((await status(t, session, link.id)).body, { phone: { status: "waiting" } });

    const sent = await photo(t, link.token, { fovDegrees: 65 });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { ok: true });
    assert.deepEqual(t.rooms, [{ photo: JPEG, fovDegrees: 65 }]);

    const desk = await status(t, session, link.id);
    const phone = desk.body.phone as { status: string; roomId: string };
    assert.equal(phone.status, "sent");
    const roomRow = t.roomDb.rooms.get(phone.roomId);
    assert.ok(roomRow);
    const sessionRow = await t.ctx.store.findSession(session, SHOP);
    assert.equal(roomRow.sessionId, sessionRow?.id);
    assert.ok(roomRow.consentAt, "consent is recorded like a desktop photo");

    // From here the desktop goes on with the normal room flow.
    const roomStatus = await json(
      await handleKoshoyRoomStatus(post("room-status", { roomId: phone.roomId }, session), t.ctx),
    );
    assert.equal(roomStatus.status, 200);
    assert.equal((roomStatus.body.room as { status: string }).status, "processing");
  });

  it("takes one photo per link", async () => {
    const t = setup();
    const session = await openSession(t);
    const link = await newLink(t, session);
    assert.equal((await photo(t, link.token, {}, "10.0.0.2")).status, 200);
    const again = await photo(t, link.token, {}, "10.0.0.3");
    assert.equal(again.status, 410);
    assert.equal(t.rooms.length, 1);
    const check = await handleKoshoyPhoneCheck(post("phone-check", { link: link.token }), t.ctx);
    assert.equal(check.status, 410);
  });

  it("needs consent and a JPEG", async () => {
    const t = setup();
    const session = await openSession(t);
    const link = await newLink(t, session);
    assert.equal((await photo(t, link.token, { consent: false })).status, 400);
    assert.equal((await photo(t, link.token, { consent: undefined })).status, 400);
    assert.equal((await photo(t, link.token, { image: "data:image/png;base64,AAAA" })).status, 400);
    assert.equal(t.rooms.length, 0);
    // A refused photo does not use up the link.
    assert.equal((await photo(t, link.token)).status, 200);
  });

  it("refuses after 5 minutes", async () => {
    const t = setup();
    const session = await openSession(t);
    const link = await newLink(t, session);
    t.clock.now += KOSHOY_PHONE_LINK_TTL_MS;
    assert.equal((await photo(t, link.token)).status, 410);
    assert.deepEqual((await status(t, session, link.id)).body, { phone: { status: "expired" } });
  });

  it("counts against the per-visitor analysis limit", async () => {
    const t = setup();
    const session = await openSession(t);
    const first = await newLink(t, session);
    assert.equal((await photo(t, first.token, {}, "10.0.0.9")).status, 200);
    const second = await newLink(t, session);
    assert.equal((await photo(t, second.token, {}, "10.0.0.9")).status, 429);
    // The refused photo leaves the link open for a retry.
    const check = await handleKoshoyPhoneCheck(post("phone-check", { link: second.token }), t.ctx);
    assert.equal(check.status, 200);
    assert.equal(t.rooms.length, 1);
  });

  it("gives the link back when the upload fails, without telling the phone why", async () => {
    const t = setup({ failUpload: true });
    const session = await openSession(t);
    const link = await newLink(t, session);
    const failed = await photo(t, link.token, {}, "10.0.0.4");
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { error: "unavailable" });
    assert.deepEqual((await status(t, session, link.id)).body, { phone: { status: "waiting" } });

    t.state.failUpload = false;
    assert.equal((await photo(t, link.token, {}, "10.0.0.5")).status, 200);
  });
});

describe("phone link status", () => {
  it("shows a photo on its way, then gives up after the grace time", async () => {
    const t = setup();
    const session = await openSession(t);
    const link = await newLink(t, session);
    const row = t.phoneDb.links.get(link.id);
    assert.ok(row);
    row.usedAt = new Date(t.clock.now + KOSHOY_PHONE_LINK_TTL_MS - 1000);
    t.clock.now += KOSHOY_PHONE_LINK_TTL_MS;
    assert.deepEqual((await status(t, session, link.id)).body, { phone: { status: "sending" } });
    t.clock.now += KOSHOY_PHONE_SEND_GRACE_MS;
    assert.deepEqual((await status(t, session, link.id)).body, { phone: { status: "expired" } });
  });

  it("is only for the session that made the link", async () => {
    const t = setup();
    const owner = await openSession(t);
    const other = await openSession(t);
    const link = await newLink(t, owner);
    assert.equal((await status(t, other, link.id)).status, 404);
    assert.equal((await status(t, owner, "not a valid id!")).status, 400);
    const anonymous = await handleKoshoyPhoneLinkStatus(post("phone-link-status", { linkId: link.id }), t.ctx);
    assert.equal(anonymous.status, 401);
  });
});
