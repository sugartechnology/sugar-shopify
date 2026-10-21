import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cabinetEngine } from "./engine";
import { createMemoryKoshoyDb } from "./memory-db";
import { appendTranscriptEvent, createKoshoyStore } from "./store.server";
import { hashKoshoyToken } from "./token.server";

const SHOP = "koshoy.myshopify.com";

function setup(start = 1_000_000) {
  let now = start;
  const memory = createMemoryKoshoyDb(() => now);
  const store = createKoshoyStore(memory.db, { now: () => now, ttlMs: 60_000 });
  return { ...memory, store, advance: (ms: number) => (now += ms) };
}

describe("koshoy session store", () => {
  it("stores only the token hash and finds the session by token", async () => {
    const { store, sessions } = setup();
    const { session, token } = await store.createSession(SHOP);
    const row = sessions.get(session.id);
    assert.ok(row);
    assert.equal(row.tokenHash, hashKoshoyToken(token));
    assert.ok(!JSON.stringify(row).includes(token), "raw token never persisted");
    const found = await store.findSession(token, SHOP);
    assert.equal(found?.id, session.id);
    assert.equal(found?.activeDesignId, null);
  });

  it("rejects another shop, malformed and expired tokens", async () => {
    const { store, advance } = setup();
    const { token } = await store.createSession(SHOP);
    assert.equal(await store.findSession(token, "other.myshopify.com"), null);
    assert.equal(await store.findSession("not-a-token", SHOP), null);
    advance(61_000);
    assert.equal(await store.findSession(token, SHOP), null);
  });

  it("slides expiry and round-trips conversation state", async () => {
    const { store, advance } = setup();
    const { session, token } = await store.createSession(SHOP);
    session.brief.room = "yatak odası";
    session.brief.color = "ivory";
    session.pendingAskUser = { id: "call_1", question: "Renk?", options: [{ id: "opt_1", label: "A", value: "a" }] };
    session.pendingTools = [{ id: "call_1", name: "ask_user", payload: { question: "Renk?" } }];
    appendTranscriptEvent(session, { type: "text", text: "Merhaba" });
    advance(50_000);
    await store.saveSession(session);
    advance(50_000);
    const found = await store.findSession(token, SHOP);
    assert.ok(found, "save extended the expiry");
    assert.equal(found.brief.room, "yatak odası");
    assert.equal(found.brief.color, "ivory");
    assert.equal(found.pendingAskUser?.id, "call_1");
    assert.equal(found.pendingTools[0]?.id, "call_1");
    assert.deepEqual(found.events, [{ type: "text", text: "Merhaba" }]);
    assert.equal(found.modelSessionId, session.modelSessionId);
  });

  it("gives unused sessions a short life and used ones the full TTL", async () => {
    let now = 1_000_000;
    const memory = createMemoryKoshoyDb(() => now);
    const store = createKoshoyStore(memory.db, { now: () => now, ttlMs: 60_000, freshTtlMs: 10_000 });
    const unused = await store.createSession(SHOP);
    const used = await store.createSession(SHOP);
    await store.saveSession(used.session);
    now += 11_000;
    assert.equal(await store.findSession(unused.token, SHOP), null, "page view only: expired");
    assert.ok(await store.findSession(used.token, SHOP), "saved session keeps the full TTL");
  });

  it("creates, lists and versions designs with optimistic updates", async () => {
    const { store } = setup();
    const { session } = await store.createSession(SHOP);
    const plan = cabinetEngine.planCabinet({ kind: "komodin" });
    const first = await store.createDesign(session.id, {
      kind: "komodin",
      label: plan.label,
      composition: plan.composition,
    });
    const second = await store.createDesign(session.id, {
      kind: "kitaplik",
      label: "Kitaplık 96 cm",
      composition: cabinetEngine.planCabinet({ kind: "kitaplik" }).composition,
    });
    assert.match(first.id, /^[A-Za-z0-9_-]{16}$/);
    assert.deepEqual(
      (await store.listDesigns(session.id)).map((design) => design.id),
      [first.id, second.id],
    );

    const updated = await store.updateDesign(session.id, first, {
      label: "Komodin 48 cm",
      composition: { ...first.composition, depthMm: 320 },
    });
    assert.equal(updated?.version, 2);
    assert.equal((await store.getDesign(session.id, first.id))?.composition.depthMm, 320);
    // the same base version again is stale
    assert.equal(
      await store.updateDesign(session.id, first, { label: "x", composition: first.composition }),
      null,
    );

    const { session: other } = await store.createSession(SHOP);
    assert.equal(await store.getDesign(other.id, first.id), null, "designs are session scoped");
  });

  it("prunes expired sessions together with their designs", async () => {
    const { store, sessions, designs, advance } = setup();
    const { session } = await store.createSession(SHOP);
    await store.createDesign(session.id, {
      kind: "komodin",
      label: "Komodin 48 cm",
      composition: cabinetEngine.planCabinet({ kind: "komodin" }).composition,
    });
    advance(11 * 60 * 1000);
    await store.createSession(SHOP);
    assert.equal(sessions.has(session.id), false);
    assert.equal(designs.size, 0);
  });

  it("keeps only text and choice in the transcript and merges text pieces", () => {
    const session = {
      id: "s",
      shop: SHOP,
      activeDesignId: null,
      modelSessionId: "m",
      brief: { room: "", style: "", level: "" as const, color: "" as const, notes: "" },
      events: [],
      pendingAskUser: null,
      pendingTools: [],
    };
    appendTranscriptEvent(session, { type: "status", key: "thinking" });
    appendTranscriptEvent(session, { type: "text", text: "Hazırladım." });
    appendTranscriptEvent(session, { type: "text", text: "Fiyatı [FİYAT]." });
    appendTranscriptEvent(session, { type: "done" });
    appendTranscriptEvent(session, { type: "choice", options: [{ id: "a", label: "A" }] });
    assert.deepEqual(session.events, [
      { type: "text", text: "Hazırladım.\n\nFiyatı [FİYAT]." },
      { type: "choice", options: [{ id: "a", label: "A" }] },
    ]);
  });
});
