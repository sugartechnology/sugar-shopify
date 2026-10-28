import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKoshoyDataStore, KOSHOY_DATA_DEFAULTS, KOSHOY_DATA_KEYS } from "./data.server";
import { handleKoshoyDataRequest, type KoshoyDataApiDeps } from "./data-api.server";
import { recordKoshoyEvent } from "./journey-events.server";
import { createMemoryDataDb, createMemoryEventDb } from "./memory-data-db";

const KEY = "test-data-key-0123456789";
const BASE = "https://koshoy.test";

function setup(apiKey: string | undefined = KEY) {
  const data = createMemoryDataDb();
  const events = createMemoryEventDb();
  const deps: KoshoyDataApiDeps = { apiKey, data: createKoshoyDataStore(data.db), events: events.db };
  const call = async (method: string, path: string, body?: unknown, key: string | null = KEY) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key !== null) headers.Authorization = `Bearer ${key}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    const response = await handleKoshoyDataRequest(new Request(BASE + path, init), deps);
    return { status: response.status, body: await response.json() };
  };
  return { deps, data, events, call };
}

const TEXTS = { customMadeWarning: "Özel üretim.", promiseLine: "Sepette göreceksin." };

describe("koshoy data api", () => {
  it("is off (503) without KOSHOY_DATA_API_KEY", async () => {
    const { call } = setup("");
    assert.equal((await call("GET", "/api/koshoy/data")).status, 503);
    assert.equal((await call("GET", "/api/koshoy/funnel")).status, 503);
  });

  it("answers 401 for a missing or wrong key", async () => {
    const { call } = setup();
    assert.equal((await call("GET", "/api/koshoy/data", undefined, null)).status, 401);
    assert.equal((await call("GET", "/api/koshoy/data", undefined, "wrong")).status, 401);
    assert.equal((await call("GET", "/api/koshoy/data", undefined, `${KEY}x`)).status, 401);
    assert.equal((await call("PUT", "/api/koshoy/data/texts", TEXTS, "wrong")).status, 401);
  });

  it("lists every document with version and source", async () => {
    const { call } = setup();
    const { status, body } = await call("GET", "/api/koshoy/data");
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.docs), [...KOSHOY_DATA_KEYS]);
    assert.deepEqual(body.docs.levels, { version: 0, source: "default", value: KOSHOY_DATA_DEFAULTS.levels });
  });

  it("unknown document or address → 404, wrong method → 405", async () => {
    const { call } = setup();
    assert.equal((await call("GET", "/api/koshoy/data/prices")).status, 404);
    assert.equal((await call("PUT", "/api/koshoy/data/prices", {})).status, 404);
    assert.equal((await call("GET", "/api/koshoy/data/texts/other")).status, 404);
    assert.equal((await call("GET", "/api/koshoy/data/texts/history/x")).status, 404);
    assert.equal((await call("POST", "/api/koshoy/data/texts", TEXTS)).status, 405);
    assert.equal((await call("GET", "/api/koshoy/data/texts/validate")).status, 405);
  });

  it("validate checks without saving", async () => {
    const { call, data } = setup();
    const good = await call("POST", "/api/koshoy/data/texts/validate", { ...TEXTS, extra: 1 });
    assert.deepEqual(good, { status: 200, body: { ok: true, value: TEXTS } });
    const bad = await call("POST", "/api/koshoy/data/levels/validate", [{ id: "a", label: "En ucuz", crown: "auto", front: "auto" }]);
    assert.equal(bad.status, 422);
    assert.equal(bad.body.ok, false);
    assert.ok(bad.body.errors[0].includes("ucuz"));
    assert.equal(data.docs.size, 0);
  });

  it("put saves versions, invalid bodies change nothing, history lists them", async () => {
    const { call } = setup();
    assert.deepEqual(await call("PUT", "/api/koshoy/data/texts", TEXTS), { status: 200, body: { ok: true, version: 1 } });
    const invalid = await call("PUT", "/api/koshoy/data/texts", { customMadeWarning: "" });
    assert.equal(invalid.status, 422);
    assert.ok(invalid.body.errors.length >= 2);
    assert.equal((await call("PUT", "/api/koshoy/data/texts", "{oops")).status, 400);
    assert.deepEqual(await call("PUT", "/api/koshoy/data/texts", { ...TEXTS, promiseLine: "Yeni." }), {
      status: 200,
      body: { ok: true, version: 2 },
    });

    const one = await call("GET", "/api/koshoy/data/texts");
    assert.deepEqual(one.body, { key: "texts", version: 2, source: "db", value: { ...TEXTS, promiseLine: "Yeni." } });
    const history = await call("GET", "/api/koshoy/data/texts/history");
    assert.deepEqual(history.body.history.map((row: { version: number }) => row.version), [2, 1]);
    assert.deepEqual(history.body.history[1].value, TEXTS);
  });

  it("rejects bodies over 64 KB", async () => {
    const { call } = setup();
    const response = await call("PUT", "/api/koshoy/data/scope", { outOfScope: ["x".repeat(70_000)], unsaid: [] });
    assert.equal(response.status, 413);
  });

  it("audit lists stored documents that no longer validate", async () => {
    const { call, data } = setup();
    assert.deepEqual((await call("GET", "/api/koshoy/data/audit")).body, { audit: [] });
    data.docs.set("levels", { key: "levels", version: 4, json: "[]", updatedAt: new Date() });
    const audit = await call("GET", "/api/koshoy/data/audit");
    assert.equal(audit.body.audit[0].key, "levels");
    assert.ok(audit.body.audit[0].errors.length > 0);
    const levels = await call("GET", "/api/koshoy/data/levels");
    assert.equal(levels.body.source, "default");
  });

  it("funnel takes Türkiye days, both inclusive", async () => {
    const { call, events } = setup();
    // 28 Oct 2026 00:30 in Türkiye is 27 Oct 21:30 UTC.
    const at = Date.UTC(2026, 9, 27, 21, 30);
    await recordKoshoyEvent(events.db, { sessionId: "a", name: "card_clicked", device: "phone" }, { now: () => at });
    await recordKoshoyEvent(events.db, { sessionId: "a", name: "first_message", device: "phone" }, { now: () => at });

    const day = await call("GET", "/api/koshoy/funnel?from=2026-10-28&to=2026-10-28");
    assert.equal(day.status, 200);
    assert.equal(day.body.from, "2026-10-28");
    assert.equal(day.body.steps[0].sessions, 1);
    assert.equal(day.body.steps[1].rateFromPrevious, 1);
    const before = await call("GET", "/api/koshoy/funnel?from=2026-10-27&to=2026-10-27");
    assert.equal(before.body.steps[0].sessions, 0);

    assert.equal((await call("GET", "/api/koshoy/funnel")).status, 400);
    assert.equal((await call("GET", "/api/koshoy/funnel?from=2026-02-31&to=2026-03-01")).status, 400);
    assert.equal((await call("GET", "/api/koshoy/funnel?from=2026-10-28&to=2026-10-01")).status, 400);
  });
});
