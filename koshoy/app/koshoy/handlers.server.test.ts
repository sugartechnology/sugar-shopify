import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import { cabinetEngine, type CabinComposition } from "./engine";
import type { PublicEvent } from "./events";
import {
  handleKoshoyCart,
  handleKoshoyEdit,
  handleKoshoySelect,
  handleKoshoySession,
  handleKoshoyTurn,
  koshoyTurnError,
  type KoshoyRequestContext,
} from "./handlers.server";
import { createMemoryKoshoyDb, createMemoryRoomSessionsDb } from "./memory-db";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import { createBusyLock, createRateLimiter } from "./rate-limit.server";
import { handleKoshoySessionDelete, handleKoshoySessions } from "./room-sessions-handlers.server";
import { createKoshoyStore } from "./store.server";
import type { KoshoyStreamFn } from "./turn.server";

const SHOP = "koshoy.myshopify.com";
const LEAKS = /sqlite|prisma|shopify\.com|openai|sugar|stack|GOVDE|tagservice/i;

/** CONTRACT §6 golden design: 15.958,14 TL with the spike price table. */
const GOLDEN: CabinComposition = {
  units: [
    {
      id: "cabin-1",
      widthMm: 960,
      heightMm: 2304,
      fittings: [
        { id: "fit-1", kind: "shelf" },
        { id: "fit-2", kind: "hanger" },
      ],
      hasDoor: true,
      color: "wood",
    },
    { id: "cabin-2", widthMm: 960, heightMm: 2304, fittings: [], hasDoor: false, color: "wood" },
  ],
  depthMm: 640,
  hasPlinth: true,
  color: "wood",
};

function makeCtx(overrides: Partial<KoshoyRequestContext> = {}): KoshoyRequestContext {
  const koshoyDb = createMemoryKoshoyDb();
  const store = createKoshoyStore(koshoyDb.db);
  const loose = () => createRateLimiter({ limit: 100, windowMs: 60_000 });
  return {
    shop: SHOP,
    enabled: true,
    store,
    engine: cabinetEngine,
    pricer: createKoshoyPricer(
      cabinetEngine,
      createMockSkuResolver([{ pattern: "*", price: "100.00" }]),
    ),
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
    },
    busy: createBusyLock(),
    chatConfig: async () => ({ apiKey: "", mock: true }),
    journeyData: async () => KOSHOY_DATA_DEFAULTS,
    customerId: "c1",
    roomSessions: createMemoryRoomSessionsDb(koshoyDb),
    ...overrides,
  };
}

function post(
  path: string,
  body: unknown,
  options: { token?: string; accept?: string; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.accept) headers.Accept = options.accept;
  if (options.ip) headers["X-Forwarded-For"] = `${options.ip}, 23.227.38.1`;
  return new Request(`https://app.test/apps/koshoy/studio/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function parseSse(text: string): PublicEvent[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const [eventLine, dataLine] = frame.split("\n");
      const event = JSON.parse(dataLine.slice("data: ".length)) as PublicEvent;
      assert.equal(eventLine, `event: ${event.type}`);
      return event;
    });
}

async function openSession(ctx: KoshoyRequestContext) {
  const response = await handleKoshoySession(post("session", {}), ctx);
  return (await response.json()) as { session: string };
}

/** The customer approved every design as it is now; the cart takes approved products only. */
async function approveAll(ctx: KoshoyRequestContext, token: string) {
  const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
  assert.ok(session);
  for (const design of await ctx.store.listDesigns(session.id)) {
    session.journey.approvals[design.id] = { status: "approved", version: design.version };
  }
  await ctx.store.saveSession(session);
}

async function approvedCart(ctx: KoshoyRequestContext, token: string, body: Record<string, unknown>) {
  await approveAll(ctx, token);
  return handleKoshoyCart(post("cart", body, { token }), ctx);
}

async function planGardirop(ctx: KoshoyRequestContext, token: string) {
  const response = await handleKoshoyTurn(
    post("turn", { input: { type: "message", text: "2 metre gardırop" } }, { token, accept: "application/json" }),
    ctx,
  );
  const { events } = (await response.json()) as { events: PublicEvent[] };
  const scene = events.find((event) => event.type === "scene");
  assert.ok(scene?.type === "scene");
  return scene;
}

describe("koshoy studio handlers", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  it("opens, resumes and resets a session with an opaque token", async () => {
    const ctx = makeCtx();
    const response = await handleKoshoySession(post("session", {}), ctx);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.enabled, true);
    assert.match(String(body.session), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.activeDesignId, null);
    assert.deepEqual(body.designs, []);
    assert.deepEqual(body.events, []);
    assert.ok((body.welcome as { cards: unknown[] }).cards.length >= 2);
    assert.deepEqual(Object.keys(body).sort(), [
      "activeDesignId",
      "designs",
      "enabled",
      "events",
      "session",
      "welcome",
    ]);

    const token = String(body.session);
    const scene = await planGardirop(ctx, token);
    const resumed = (await (
      await handleKoshoySession(post("session", {}, { token }), ctx)
    ).json()) as Record<string, unknown>;
    assert.equal(resumed.session, token);
    assert.equal(resumed.activeDesignId, scene.designId);
    const types = (resumed.events as PublicEvent[]).map((event) => event.type);
    assert.deepEqual(types.slice(-2), ["scene", "price"], "hydrates the active design");

    const reset = (await (
      await handleKoshoySession(post("session", { reset: true }, { token }), ctx)
    ).json()) as Record<string, unknown>;
    assert.notEqual(reset.session, token);
    assert.deepEqual(reset.designs, []);
  });

  it("accepts the session token in the body when the proxy drops headers", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const resumed = (await (
      await handleKoshoySession(post("session", { session: token }), ctx)
    ).json()) as Record<string, unknown>;
    assert.equal(resumed.session, token);
    const response = await handleKoshoyTurn(
      post("turn", { session: token, input: { type: "message", text: "Merhaba" } }, { accept: "application/json" }),
      ctx,
    );
    assert.equal(response.status, 200);
  });

  it("reports a disabled shop without creating anything", async () => {
    const body = (await (await handleKoshoySession(post("session", {}), makeCtx({ enabled: false }))).json()) as Record<string, unknown>;
    assert.equal(body.enabled, false);
    assert.equal(body.session, "");
  });

  it("streams a turn as SSE and falls back to JSON", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const sse = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Komodin istiyorum" } }, { token }),
      ctx,
    );
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get("Content-Type") ?? "", /text\/event-stream/);
    const streamed = parseSse(await sse.text());
    assert.equal(streamed.at(-1)?.type, "done");
    assert.ok(streamed.some((event) => event.type === "scene"));

    const json = await handleKoshoyTurn(
      post("turn", { input: { type: "choice", selected: "color_blue" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.match(json.headers.get("Content-Type") ?? "", /application\/json/);
    const { events } = (await json.json()) as { events: PublicEvent[] };
    assert.equal(events.at(-1)?.type, "done");
  });

  it("maps turn failures to error codes with matching statuses", async () => {
    const ctx = makeCtx({ limits: { ...makeCtx().limits, turn: createRateLimiter({ limit: 1, windowMs: 60_000 }) } });
    const noSession = await handleKoshoyTurn(post("turn", { input: { type: "message", text: "x" } }), ctx);
    assert.equal(noSession.status, 401);
    assert.deepEqual(parseSse(await noSession.text()), [
      { type: "error", code: "session_expired" },
      { type: "done" },
    ]);

    const { session: token } = await openSession(ctx);
    const invalid = await handleKoshoyTurn(
      post("turn", { input: { type: "tool_call", name: "plan_cabinet" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      events: [{ type: "error", code: "invalid_input" }, { type: "done" }],
    });

    await handleKoshoyTurn(post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }), ctx);
    const limited = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.equal(limited.status, 429);
  });

  it("hides internal failures behind 'unavailable' and releases the turn lock", async () => {
    let fail = true;
    const ctx = makeCtx({
      chatConfig: async () => {
        if (fail) throw new Error("Shop API key is not configured for sugar tagservice");
        return { apiKey: "", mock: true };
      },
    });
    const { session: token } = await openSession(ctx);
    const failed = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Kitaplık" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.equal(failed.status, 503);
    const text = await failed.text();
    assert.ok(!LEAKS.test(text), text);
    assert.match(text, /"code":"unavailable"/);

    fail = false;
    const retry = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Kitaplık" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.equal(retry.status, 200, "lock was released");

    const broken = makeCtx();
    broken.store.findSession = async () => {
      throw new Error("SQLITE_BUSY: database is locked (prisma/dev.sqlite)");
    };
    const dbDown = await handleKoshoySession(post("session", {}, { token }), broken);
    assert.equal(dbDown.status, 503);
    const dbText = await dbDown.text();
    assert.ok(!LEAKS.test(dbText), dbText);
  });

  it("applies panel edits, rejects stale or invalid ones with the latest state", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);

    const ok = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 1, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
      ctx,
    );
    const okBody = (await ok.json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(okBody.ok, true);
    assert.deepEqual(okBody.events.map((event) => event.type), ["scene", "price", "text"]);
    const [nextScene, nextPrice, line] = okBody.events;
    assert.ok(nextScene.type === "scene" && nextPrice.type === "price" && line.type === "text");
    assert.equal(nextScene.version, 2);
    assert.equal(nextPrice.version, 2);
    assert.equal(line.text, "Panelden: 2. gövdeye küçük çekmece eklendi.");

    const stale = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 1, op: { action: "set_depth", depthMm: 480 } }, { token }),
      ctx,
    );
    const staleBody = (await stale.json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(staleBody.ok, false);
    assert.deepEqual(staleBody.events.map((event) => event.type), ["error", "scene", "price"]);
    assert.deepEqual(staleBody.events[0], { type: "error", code: "edit_rejected" });
    assert.ok(staleBody.events[1].type === "scene" && staleBody.events[1].version === 2);

    const rejected = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 2, op: { action: "set_total_width", widthMm: 30000 } }, { token }),
      ctx,
    );
    const rejectedBody = (await rejected.json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(rejected.status, 200);
    assert.equal(rejectedBody.ok, false);
    assert.deepEqual(rejectedBody.events.map((event) => event.type), ["error", "scene", "price"]);
    assert.ok(rejectedBody.events[1].type === "scene" && rejectedBody.events[1].version === 2);

    const invalid = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 2, op: { action: "set_price", value: 1 } }, { token }),
      ctx,
    );
    assert.equal(invalid.status, 400);

    const foreign = await handleKoshoyEdit(
      post("edit", { designId: "someoneElse1", version: 1, op: { action: "set_depth", depthMm: 480 } }, { token }),
      ctx,
    );
    assert.equal(foreign.status, 400);

    const noToken = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 2, op: { action: "set_depth", depthMm: 480 } }),
      ctx,
    );
    assert.equal(noToken.status, 401);
    assert.deepEqual(await noToken.json(), {
      ok: false,
      error: "session_expired",
      events: [{ type: "error", code: "session_expired" }],
    });
  });

  it("snaps panel sizes with the core and reports what it had to change", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);

    const snapped = (await (
      await handleKoshoyEdit(
        post("edit", { designId: scene.designId, version: 1, op: { action: "set_unit_width", unit: 0, widthMm: 500 } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(snapped.ok, true);
    const [view, , line] = snapped.events;
    assert.ok(view.type === "scene" && line.type === "text");
    assert.deepEqual(view.view.units.map((unit) => unit.widthMm), [480, 960]);
    assert.equal(view.label, "Gardırop 144 cm");
    assert.equal(line.text, "Panelden: 1. gövdenin genişliği 48 cm oldu.");

    const lowered = (await (
      await handleKoshoyEdit(
        post("edit", { designId: scene.designId, version: 2, op: { action: "set_unit_height", unit: 1, heightMm: 544 } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(lowered.ok, true);
    const loweredText = lowered.events.find((event) => event.type === "text");
    assert.deepEqual(loweredText, {
      type: "text",
      // One 320 drawer stays (front grid 480); its 157 mm door stays too; a low body gets a crown.
      text: "Panelden: 2. gövdenin yüksekliği 54,4 cm oldu. Sığmayan iç parçalar çıkarıldı. Gövde alçaldığı için üstüne taç eklendi.",
    });

    // A valid op that changes nothing is an idempotent success at the same version.
    const same = (await (
      await handleKoshoyEdit(
        post("edit", { designId: scene.designId, version: 3, op: { action: "set_color", target: "all", color: "wood" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(same.ok, true);
    assert.deepEqual(same.events.map((event) => event.type), ["scene", "price"]);
    assert.ok(same.events[0].type === "scene" && same.events[0].version === 3);

    const doorTooShort = (await (
      await handleKoshoyEdit(
        // 320 + 160 mm of drawers fill the 544 body's front grid: no room left for the door.
        post("edit", { designId: scene.designId, version: 3, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(doorTooShort.ok, false);
    assert.deepEqual(doorTooShort.events[0], { type: "error", code: "edit_rejected" });
    assert.ok(!LEAKS.test(JSON.stringify(doorTooShort)));
    assert.ok(!JSON.stringify(doorTooShort).includes("door_too_short"));
  });

  it("switches the door series and draws it (Mat kapak 18 mm), never naming shop parts", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);
    const body = (await (
      await handleKoshoyEdit(
        post("edit", { designId: scene.designId, version: 1, op: { action: "set_front_series", series: "kapak-18" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(body.ok, true);
    const [view, , line] = body.events;
    assert.ok(view.type === "scene" && line.type === "text");
    assert.equal(view.view.frontSeries, "kapak-18");
    assert.equal(line.text, "Panelden: Kapaklar mat kapak (18 mm) oldu.");
    assert.ok(!/Aruuke|Acıbay/.test(JSON.stringify(body)));
  });

  it("shows the product card again when a panel edit changes an approved product", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    const design = await ctx.store.createDesign(session.id, {
      kind: "kitaplik",
      label: "Kitaplık",
      composition: cabinetEngine.planCabinet({ kind: "kitaplik" }).composition,
    });
    session.brief.room = "Salon";
    Object.assign(session.journey, { structure: "skip", roomApprovedAt: 1, shownStage: "cart" });
    Object.assign(session.journey.style, { level: "en_iyisi", panel: "ivory", front: "kapak-18", crown: "on" });
    session.journey.approvals[design.id] = { status: "approved", version: design.version };
    await ctx.store.saveSession(session);
    const body = (await (
      await handleKoshoyEdit(
        post("edit", { designId: design.id, version: design.version, op: { action: "add_fitting", unit: 0, kind: "shelf" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(body.ok, true);
    const card = body.events.find((event) => event.type === "product_card");
    assert.ok(card?.type === "product_card", "the changed product is decided again");
    assert.equal(card.status, "pending");
  });

  it("takes only an approved product, as it is now, into the cart (ClickUp z8qu5d7rdv)", async () => {
    const ctx = makeCtx({ pricer: createKoshoyPricer(cabinetEngine, createMockSkuResolver()) });
    const { session: token } = await openSession(ctx);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    const design = await ctx.store.createDesign(session.id, { kind: "gardirop", label: "Gardırop 192 cm", composition: GOLDEN });
    const cart = async () =>
      (await (await handleKoshoyCart(post("cart", { designId: design.id, version: 1 }, { token }), ctx)).json()) as {
        ok: boolean;
        error?: string;
      };
    assert.deepEqual(await cart(), { ok: false, error: "not_approved", lines: [] });
    session.journey.approvals[design.id] = { status: "later", version: 1 };
    await ctx.store.saveSession(session);
    assert.equal((await cart()).error, "not_approved", "\"sonra\" is not an approval");
    session.journey.approvals[design.id] = { status: "approved", version: 1 };
    await ctx.store.saveSession(session);
    assert.equal((await cart()).ok, true);
  });

  it("recomputes the golden cart from the stored design, ignoring browser data", async () => {
    const ctx = makeCtx({ pricer: createKoshoyPricer(cabinetEngine, createMockSkuResolver()) });
    const { session: token } = await openSession(ctx);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    const design = await ctx.store.createDesign(session.id, {
      kind: "gardirop",
      label: "Gardırop 192 cm",
      composition: GOLDEN,
    });

    await approveAll(ctx, token);
    const response = await handleKoshoyCart(
      post(
        "cart",
        {
          designId: design.id,
          version: 1,
          // Anything else the browser sends is ignored.
          display: "1,00 TL",
          lines: [{ variantId: 1, quantity: 99 }],
          composition: { units: [] },
        },
        { token },
      ),
      ctx,
    );
    const body = (await response.json()) as {
      ok: boolean;
      display: string;
      lines: Array<{ variantId: number; quantity: number; properties: Record<string, string> }>;
    };
    assert.equal(body.ok, true);
    assert.equal(body.display, "15.958,14 TL");
    assert.deepEqual(body.lines.map((line) => line.quantity), [2, 2, 1, 1]);
    assert.equal(new Set(body.lines.map((line) => line.variantId)).size, 4);
    assert.ok(body.lines.every((line) => line.properties._tasarim === design.id));

    // The cart follows the saved edit: one more shelf = one more RAF line unit.
    const edited = (await (
      await handleKoshoyEdit(
        post("edit", { designId: design.id, version: 1, op: { action: "add_fitting", unit: 1, kind: "shelf" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(edited.ok, true);
    const price = edited.events.find((event) => event.type === "price");
    assert.ok(price?.type === "price");
    assert.equal(price.display, "16.531,42 TL");

    const after = (await (
      await approvedCart(ctx, token, { designId: design.id, version: 2 })
    ).json()) as typeof body;
    assert.equal(after.display, "16.531,42 TL");
    assert.deepEqual(after.lines.map((line) => line.quantity), [2, 2, 2, 1]);

    const stale = (await (
      await approvedCart(ctx, token, { designId: design.id, version: 1 })
    ).json()) as { ok: boolean; error: string; lines: unknown[] };
    assert.deepEqual([stale.ok, stale.error, stale.lines], [false, "cart_failed", []]);
  });

  it("builds cart lines server-side and refuses unresolved or stale designs", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);

    const ok = (await (
      await approvedCart(ctx, token, { designId: scene.designId, version: 1 })
    ).json()) as {
      ok: boolean;
      display: string;
      lines: Array<{ variantId: number; quantity: number; properties: Record<string, string> }>;
    };
    assert.equal(ok.ok, true);
    assert.match(ok.display, /,\d{2} TL$/);
    assert.ok(ok.lines.length > 0);
    for (const line of ok.lines) {
      assert.ok(Number.isSafeInteger(line.variantId));
      assert.ok(line.quantity >= 1);
      assert.deepEqual(line.properties, { _tasarim: scene.designId });
      assert.deepEqual(Object.keys(line).sort(), ["properties", "quantity", "variantId"]);
    }

    const stale = (await (
      await approvedCart(ctx, token, { designId: scene.designId, version: 7 })
    ).json()) as { ok: boolean; error: string; lines: unknown[] };
    assert.deepEqual([stale.ok, stale.error, stale.lines], [false, "cart_failed", []]);

    const partial = makeCtx({
      pricer: createKoshoyPricer(
        cabinetEngine,
        createMockSkuResolver([{ pattern: "GOVDE-*", price: "100.00" }]),
      ),
    });
    const partialToken = (await openSession(partial)).session;
    const partialScene = await planGardirop(partial, partialToken);
    const unresolved = (await (
      await approvedCart(partial, partialToken, { designId: partialScene.designId, version: 1 })
    ).json()) as { ok: boolean; error: string; display: string; lines: unknown[] };
    assert.deepEqual(
      [unresolved.ok, unresolved.error, unresolved.display, unresolved.lines],
      [false, "cart_failed", "[FİYAT]", []],
    );
  });

  it("maps pricing crashes in edit to 'unavailable' without details", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);
    ctx.pricer = {
      async quote() {
        throw new Error("Shopify 502 from https://koshoy.myshopify.com/admin/api");
      },
    };
    const response = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 1, op: { action: "set_depth", depthMm: 480 } }, { token }),
      ctx,
    );
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.ok(!LEAKS.test(text), text);
  });
  it("limits new sessions per visitor and per shop, never resumes", async () => {
    const ctx = makeCtx({
      limits: {
        ...makeCtx().limits,
        session: createRateLimiter({ limit: 2, windowMs: 60_000 }),
        shopSession: createRateLimiter({ limit: 3, windowMs: 60_000 }),
      },
    });
    const first = (await (await handleKoshoySession(post("session", {}, { ip: "198.51.100.7" }), ctx)).json()) as {
      session: string;
    };
    await handleKoshoySession(post("session", {}, { ip: "198.51.100.7" }), ctx);
    const limited = await handleKoshoySession(post("session", {}, { ip: "198.51.100.7" }), ctx);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), {
      ok: false,
      error: "rate_limited",
      events: [{ type: "error", code: "rate_limited" }],
    });
    // Resuming an existing session is not a new row and is not limited.
    const resumed = await handleKoshoySession(post("session", {}, { token: first.session, ip: "198.51.100.7" }), ctx);
    assert.equal(resumed.status, 200);
    // Another visitor still gets one, until the shop budget is spent.
    assert.equal((await handleKoshoySession(post("session", {}, { ip: "203.0.113.9" }), ctx)).status, 200);
    assert.equal((await handleKoshoySession(post("session", {}, { ip: "192.0.2.1" }), ctx)).status, 429);
  });

  it("limits turns per visitor across fresh sessions", async () => {
    const ctx = makeCtx({
      limits: { ...makeCtx().limits, client: createRateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    const a = (await (await handleKoshoySession(post("session", {}, { ip: "198.51.100.7" }), ctx)).json()) as { session: string };
    const b = (await (await handleKoshoySession(post("session", {}, { ip: "198.51.100.7" }), ctx)).json()) as { session: string };
    const say = (token: string) =>
      handleKoshoyTurn(
        post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json", ip: "198.51.100.7" }),
        ctx,
      );
    assert.equal((await say(a.session)).status, 200);
    const limited = await say(b.session);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { events: [{ type: "error", code: "rate_limited" }, { type: "done" }] });
  });

  it("ends route-level /turn errors with done in both transports", async () => {
    const sse = koshoyTurnError(post("turn", {}), "unavailable", 401);
    assert.equal(sse.status, 401);
    assert.match(sse.headers.get("Content-Type") ?? "", /text\/event-stream/);
    assert.deepEqual(parseSse(await sse.text()), [{ type: "error", code: "unavailable" }, { type: "done" }]);
    const json = koshoyTurnError(post("turn", {}, { accept: "application/json" }), "invalid_input", 405);
    assert.equal(json.status, 405);
    assert.deepEqual(await json.json(), { events: [{ type: "error", code: "invalid_input" }, { type: "done" }] });
  });

  it("refuses a panel edit while a turn is running, with the latest state", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    assert.ok(ctx.busy.acquire(session.id), "simulated running turn");
    const refused = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 1, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
      ctx,
    );
    const body = (await refused.json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(body.ok, false);
    assert.deepEqual(body.events.map((event) => event.type), ["error", "scene", "price"]);
    assert.ok(body.events[1].type === "scene" && body.events[1].version === 1, "design untouched");
    ctx.busy.release(session.id);

    const ok = await handleKoshoyEdit(
      post("edit", { designId: scene.designId, version: 1, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
      ctx,
    );
    assert.equal(((await ok.json()) as { ok: boolean }).ok, true);
    assert.ok(ctx.busy.acquire(session.id), "edit released its lock");
  });

  it("stops the model loop and frees the session when the SSE reader cancels", async () => {
    // The first turn's upstream never answers (whether it is reached before the cancel or not).
    const stream: KoshoyStreamFn = (_apiKey, body, onEvent) => {
      if (String(body.message).includes("Bekle")) return new Promise(() => {});
      onEvent({ event: "text", data: { text: "Merhaba!" } });
      return Promise.resolve();
    };
    const ctx = makeCtx({ chatConfig: async () => ({ apiKey: "k", mock: false }), stream });
    const { session: token } = await openSession(ctx);
    const response = await handleKoshoyTurn(post("turn", { input: { type: "message", text: "Bekle" } }, { token }), ctx);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retry = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.equal(retry.status, 200, "lock released after cancel");
    const { events } = (await retry.json()) as { events: PublicEvent[] };
    assert.deepEqual(events.filter((event) => event.type === "text"), [{ type: "text", text: "Merhaba!" }]);
  });

  it("bills exactly what the scene draws: shelf edits stop at the per-unit cap", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const planned = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Kitaplık" } }, { token, accept: "application/json" }),
      ctx,
    );
    const first = ((await planned.json()) as { events: PublicEvent[] }).events.find((event) => event.type === "scene");
    assert.ok(first?.type === "scene");
    let scene = first;
    let rejected = 0;
    for (let i = 0; i < 20; i += 1) {
      const body = (await (
        await handleKoshoyEdit(
          post("edit", { designId: scene.designId, version: scene.version, op: { action: "add_fitting", unit: 0, kind: "shelf" } }, { token }),
          ctx,
        )
      ).json()) as { ok: boolean; events: PublicEvent[] };
      if (!body.ok) {
        rejected += 1;
        assert.deepEqual(body.events[0], { type: "error", code: "edit_rejected" });
      }
      const next = body.events.find((event) => event.type === "scene");
      assert.ok(next?.type === "scene", "every answer carries the scene");
      scene = next;
    }
    assert.ok(rejected > 0, "the cap refused further shelves");

    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    const design = await ctx.store.getDesign(session!.id, scene.designId);
    assert.ok(design);
    assert.deepEqual(
      scene.view.units.map((unit) => unit.fittings.length),
      design.composition.units.map((unit) => unit.fittings.length),
      "the scene carries every stored fitting",
    );
    const bom = cabinetEngine.toBom(design.composition);
    const billed = (part: string) => bom.filter((line) => line.part === part).reduce((sum, line) => sum + line.qty, 0);
    const drawn = (kinds: string[]) =>
      scene.view.units.flatMap((unit) => unit.fittings).filter((item) => kinds.includes(item.kind)).length;
    assert.equal(billed("RAF"), drawn(["shelf"]));
    assert.equal(billed("ASKI"), drawn(["hanger"]));
    assert.equal(billed("CEKMECE"), drawn(["drawer160", "drawer320"]));

    const cart = (await (
      await approvedCart(ctx, token, { designId: scene.designId, version: scene.version })
    ).json()) as { ok: boolean; lines: Array<{ quantity: number }> };
    assert.equal(cart.ok, true);
    assert.equal(
      cart.lines.reduce((sum, line) => sum + line.quantity, 0),
      bom.reduce((sum, line) => sum + line.qty, 0),
    );
  });

  it("refuses a cart for a stored design the scene cannot carry in full", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    const shelves = Array.from({ length: 24 }, (_, i) => ({ id: `fit-${i + 1}`, kind: "shelf" as const }));
    const design = await ctx.store.createDesign(session!.id, {
      kind: "kitaplik",
      label: "Kitaplık 96 cm",
      composition: {
        units: [{ id: "cabin-1", widthMm: 960, heightMm: 1984, fittings: shelves, hasDoor: false, color: "wood" }],
        depthMm: 320,
        hasPlinth: true,
        color: "wood",
      },
    });
    const body = (await (
      await approvedCart(ctx, token, { designId: design.id, version: 1 })
    ).json()) as { ok: boolean; error: string; lines: unknown[] };
    assert.deepEqual([body.ok, body.error, body.lines], [false, "cart_failed", []]);
  });

  it("keys visitors by the address the proxy added, not one the browser sent", async () => {
    const ctx = makeCtx({
      limits: { ...makeCtx().limits, session: createRateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    const open = (forwardedFor: string) =>
      handleKoshoySession(
        new Request("https://app.test/apps/koshoy/studio/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor },
          body: "{}",
        }),
        ctx,
      );
    assert.equal((await open("198.51.100.7, 23.227.38.1")).status, 200);
    // A forged left-hand entry does not make the same visitor new again.
    assert.equal((await open("203.0.113.50, 198.51.100.7, 23.227.38.1")).status, 429);
    assert.equal((await open("10.1.2.3, 192.0.2.99, 198.51.100.7, 23.227.38.1")).status, 429);
    assert.equal((await open("203.0.113.9, 23.227.38.1")).status, 200, "another visitor");
  });

  it("keeps the turn budget when new-session spam spends the session budget", async () => {
    const ctx = makeCtx({
      limits: { ...makeCtx().limits, shopSession: createRateLimiter({ limit: 1, windowMs: 60_000 }) },
    });
    const { session: token } = await openSession(ctx);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await handleKoshoySession(post("session", {}, { ip: `203.0.113.${i + 1}` }), ctx)).status, 429);
    }
    const said = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }),
      ctx,
    );
    assert.equal(said.status, 200);
  });

  it("re-reads the session under the lock so an edit never undoes a finished turn", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);
    const findSession = ctx.store.findSession.bind(ctx.store);
    let raced = false;
    let turnStatus = 0;
    // The edit's first read happens, then a whole turn runs before it gets the lock.
    ctx.store.findSession = async (presented, shop, customerId) => {
      const copy = await findSession(presented, shop, customerId);
      if (!raced) {
        raced = true;
        const turned = await handleKoshoyTurn(
          post("turn", { input: { type: "message", text: "Bir de komodin" } }, { token, accept: "application/json" }),
          ctx,
        );
        turnStatus = turned.status;
      }
      return copy;
    };
    const edit = (await (
      await handleKoshoyEdit(
        post("edit", { designId: scene.designId, version: 1, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean };
    ctx.store.findSession = findSession;
    assert.equal(turnStatus, 200);
    assert.equal(edit.ok, true);

    const session = await findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    assert.equal((await ctx.store.listDesigns(session.id)).length, 2);
    const transcript = session.events.map((event) => (event.type === "text" ? event.text : "")).join("\n");
    assert.match(transcript, /komodin/i, "the turn's reply survived the edit");
    assert.match(transcript, /Panelden: 2\. gövdeye küçük çekmece eklendi\./);
  });

  it("refuses a turn that starts while an edit holds the session", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);
    const getDesign = ctx.store.getDesign.bind(ctx.store);
    let raced = false;
    let turnStatus = 0;
    ctx.store.getDesign = async (sessionId, designId) => {
      if (!raced) {
        raced = true;
        const turned = await handleKoshoyTurn(
          post("turn", { input: { type: "message", text: "Bir de komodin" } }, { token, accept: "application/json" }),
          ctx,
        );
        turnStatus = turned.status;
      }
      return getDesign(sessionId, designId);
    };
    const edit = (await (
      await handleKoshoyEdit(
        post("edit", { designId: scene.designId, version: 1, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
        ctx,
      )
    ).json()) as { ok: boolean };
    ctx.store.getDesign = getDesign;
    assert.equal(edit.ok, true);
    assert.equal(turnStatus, 429, "the turn waits for the edit instead of racing it");
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.equal((await ctx.store.listDesigns(session!.id)).length, 1);
  });

  it("re-reads the session under the lock so a turn never undoes a finished edit", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const scene = await planGardirop(ctx, token);
    const findSession = ctx.store.findSession.bind(ctx.store);
    let raced = false;
    ctx.store.findSession = async (presented, shop, customerId) => {
      const copy = await findSession(presented, shop, customerId);
      if (!raced) {
        raced = true;
        await handleKoshoyEdit(
          post("edit", { designId: scene.designId, version: 1, op: { action: "add_fitting", unit: 1, kind: "drawer160" } }, { token }),
          ctx,
        );
      }
      return copy;
    };
    const turned = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }),
      ctx,
    );
    ctx.store.findSession = findSession;
    assert.equal(turned.status, 200);
    const session = await findSession(token, SHOP, ctx.customerId);
    const transcript = session!.events.map((event) => (event.type === "text" ? event.text : "")).join("\n");
    assert.match(transcript, /Panelden: 2\. gövdeye küçük çekmece eklendi\./, "the edit's line survived the turn");
  });

  it("switches the active design from a tab and returns its scene and price", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const wardrobe = await planGardirop(ctx, token);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    const plan = cabinetEngine.planCabinet({ kind: "kitaplik" });
    const shelf = await ctx.store.createDesign(session.id, {
      kind: "kitaplik",
      label: plan.label,
      composition: plan.composition,
    });

    const response = await handleKoshoySelect(post("select", { designId: shelf.id }, { token }), ctx);
    const body = (await response.json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(body.ok, true);
    assert.deepEqual(body.events.map((event) => event.type), ["designs", "scene", "price"]);
    const [designs, scene] = body.events;
    assert.ok(designs.type === "designs" && scene.type === "scene");
    assert.deepEqual(
      designs.items.map((item) => [item.designId, item.active]),
      [
        [wardrobe.designId, false],
        [shelf.id, true],
      ],
    );
    assert.equal(scene.designId, shelf.id);
    assert.deepEqual(scene.unitWidthsMm, [320, 480, 640]);
    assert.equal((await ctx.store.findSession(token, SHOP, ctx.customerId))?.activeDesignId, shelf.id);
    assert.ok(!LEAKS.test(JSON.stringify(body)));

    const unknown = await handleKoshoySelect(post("select", { designId: "nope" }, { token }), ctx);
    assert.equal(unknown.status, 400);
    const malformed = await handleKoshoySelect(post("select", { designId: "bad id!" }, { token }), ctx);
    assert.equal(malformed.status, 400);
    const anonymous = await handleKoshoySelect(post("select", { designId: shelf.id }), ctx);
    assert.equal(anonymous.status, 401);

    // A running turn would save over the switch.
    assert.ok(ctx.busy.acquire(session.id));
    const busy = await handleKoshoySelect(post("select", { designId: wardrobe.designId }, { token }), ctx);
    assert.equal(busy.status, 429);
    ctx.busy.release(session.id);
    assert.equal((await ctx.store.findSession(token, SHOP, ctx.customerId))?.activeDesignId, shelf.id);
  });

  it("applies the kind's size rules to panel edits", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    const session = await ctx.store.findSession(token, SHOP, ctx.customerId);
    assert.ok(session);
    const plan = cabinetEngine.planCabinet({ kind: "kitaplik" });
    const shelf = await ctx.store.createDesign(session.id, {
      kind: "kitaplik",
      label: plan.label,
      composition: plan.composition,
    });
    const wide = await handleKoshoyEdit(
      post(
        "edit",
        { designId: shelf.id, version: shelf.version, op: { action: "set_unit_width", unit: 0, widthMm: 960 } },
        { token },
      ),
      ctx,
    );
    const body = (await wide.json()) as { ok: boolean; events: PublicEvent[] };
    assert.equal(body.ok, false);
    assert.equal(body.events[0].type, "error");
  });
});

describe("room sessions endpoints (CONTRACT §2.8)", () => {
  type RoomList = { rooms: Array<{ ref: string; key?: string; name: string }>; account: boolean; max: number };
  const listRooms = async (ctx: KoshoyRequestContext, keys: string[]) =>
    (await (await handleKoshoySessions(post("sessions", { keys }), ctx)).json()) as RoomList;

  it("joins a guest's room to the account on sign-in and hides it after sign-out", async () => {
    const tracked: string[] = [];
    const guest = makeCtx({ customerId: null });
    const { session: token } = await openSession(guest);
    const signedIn: KoshoyRequestContext = { ...guest, customerId: "c1", track: (_id, name) => tracked.push(name) };
    const same = (await (await handleKoshoySession(post("session", {}, { token }), signedIn)).json()) as { session: string };
    assert.equal(same.session, token, "the same room goes on");
    assert.deepEqual(tracked, ["signed_in"]);

    const signedOut = (await (await handleKoshoySession(post("session", {}, { token }), guest)).json()) as { session: string };
    assert.notEqual(signedOut.session, token, "a new room starts");
    const turn = await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }),
      guest,
    );
    assert.equal(turn.status, 401);
    assert.deepEqual((await listRooms(guest, [token])).rooms, []);
  });

  it("opens an account room on another device with a token of its own", async () => {
    const ctx = makeCtx();
    const { session: token } = await openSession(ctx);
    // A used room: an unused one shows only in the browser that opened it.
    await handleKoshoyTurn(
      post("turn", { input: { type: "message", text: "Merhaba" } }, { token, accept: "application/json" }),
      ctx,
    );
    const list = await listRooms(ctx, []);
    assert.deepEqual([list.account, list.max, list.rooms.length], [true, 10, 1]);
    assert.equal(list.rooms[0].key, undefined, "not this device's room yet");

    const opened = (await (await handleKoshoySession(post("session", { open: list.rooms[0].ref }), ctx)).json()) as {
      session: string;
    };
    assert.ok(opened.session);
    assert.notEqual(opened.session, token);
    assert.equal((await listRooms(ctx, [opened.session])).rooms[0].key, opened.session);

    const guest = await handleKoshoySession(post("session", { open: list.rooms[0].ref }), { ...ctx, customerId: null });
    assert.equal(guest.status, 401);
    const unknown = await handleKoshoySession(post("session", { open: "no-such-room" }), ctx);
    assert.equal(unknown.status, 401);
  });

  it("lists this browser's rooms and deletes one with its token", async () => {
    const ctx = makeCtx({ customerId: null });
    const first = (await openSession(ctx)).session;
    const second = (
      (await (await handleKoshoySession(post("session", { reset: true }, { token: first }), ctx)).json()) as {
        session: string;
      }
    ).session;
    const list = await listRooms(ctx, [first, second, "not-a-token"]);
    assert.deepEqual(list.rooms.map((room) => [room.name, room.key]).sort(), [
      ["Yeni oda", first],
      ["Yeni oda 2", second],
    ].sort());
    assert.equal(list.account, false);

    const ref = list.rooms.find((room) => room.key === first)!.ref;
    const deleted = await handleKoshoySessionDelete(post("session-delete", { ref, key: first }), ctx);
    assert.deepEqual(await deleted.json(), { ok: true });
    assert.deepEqual((await listRooms(ctx, [first, second])).rooms.map((room) => room.key), [second]);
    const again = await handleKoshoySessionDelete(post("session-delete", { ref, key: first }), ctx);
    assert.equal(again.status, 401);
    const bad = await handleKoshoySessionDelete(post("session-delete", { ref: "../x" }), ctx);
    assert.equal(bad.status, 400);
  });
});
