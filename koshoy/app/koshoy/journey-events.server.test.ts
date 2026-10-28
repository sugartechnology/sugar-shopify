import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deviceFromUserAgent,
  KOSHOY_JOURNEY_EVENTS,
  koshoyFunnel,
  recordKoshoyEvent,
  type KoshoyEventDb,
} from "./journey-events.server";
import { createMemoryEventDb } from "./memory-data-db";

const DAY = 24 * 60 * 60 * 1000;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

describe("koshoy journey events", () => {
  it("phones and tablets are phone, the rest desktop", () => {
    assert.equal(deviceFromUserAgent(IPHONE), "phone");
    assert.equal(deviceFromUserAgent(ANDROID_TABLET), "phone");
    assert.equal(deviceFromUserAgent(MAC), "desktop");
    assert.equal(deviceFromUserAgent(null), "desktop");
  });

  it("stores small flat props only, never e-mail or phone numbers", async () => {
    const { db, events } = createMemoryEventDb();
    const props: Record<string, unknown> = {
      room: "salon",
      count: 3,
      email: "a@b.com",
      phone: "0532 123 45 67",
      nested: { a: 1 },
      list: [1],
      long: "x".repeat(300),
      "bad key": "x",
      nan: Number.NaN,
    };
    for (let i = 0; i < 12; i += 1) props[`p${i}`] = i;
    await recordKoshoyEvent(db, { sessionId: "s1", name: "room_chosen", device: "phone", props });
    const stored = JSON.parse(events[0].props ?? "{}");
    assert.equal(stored.room, "salon");
    assert.equal(stored.count, 3);
    assert.equal(stored.long.length, 200);
    for (const key of ["email", "phone", "nested", "list", "bad key", "nan"]) assert.ok(!(key in stored), key);
    assert.equal(Object.keys(stored).length, 10);
  });

  it("never throws; unknown names are skipped", async () => {
    const broken: KoshoyEventDb = {
      koshoyEvent: {
        create: async () => {
          throw new Error("db down");
        },
        deleteMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
    };
    await recordKoshoyEvent(broken, { sessionId: "s1", name: "cart_sent", device: "desktop" });
    const { db, events } = createMemoryEventDb();
    await recordKoshoyEvent(db, { sessionId: "s1", name: "hacked" as never, device: "desktop" });
    assert.equal(events.length, 0);
  });

  it("prunes rows older than 180 days at most every 10 minutes", async () => {
    const { db, events } = createMemoryEventDb();
    let now = 200 * DAY;
    const record = () => recordKoshoyEvent(db, { sessionId: "s", name: "first_message", device: "desktop" }, { now: () => now });
    events.push({ id: "old", at: new Date(now - 181 * DAY), sessionId: "o", name: "first_message", device: "desktop", props: null });
    await record();
    assert.ok(!events.some((row) => row.id === "old"));

    events.push({ id: "old2", at: new Date(now - 181 * DAY), sessionId: "o", name: "first_message", device: "desktop", props: null });
    now += 60_000;
    await record();
    assert.ok(events.some((row) => row.id === "old2"), "not again within 10 minutes");
    now += 10 * 60_000;
    await record();
    assert.ok(!events.some((row) => row.id === "old2"));
  });

  it("funnel counts distinct sessions per step and device, with the rate from the step before", async () => {
    const { db } = createMemoryEventDb();
    const now = Date.UTC(2026, 9, 28, 12);
    const record = (sessionId: string, name: (typeof KOSHOY_JOURNEY_EVENTS)[number], device: "phone" | "desktop") =>
      recordKoshoyEvent(db, { sessionId, name, device }, { now: () => now });
    await record("a", "card_clicked", "phone");
    await record("a", "card_clicked", "phone");
    await record("b", "card_clicked", "desktop");
    await record("c", "card_clicked", "desktop");
    await record("d", "card_clicked", "phone");
    await record("a", "first_message", "phone");
    await record("b", "first_message", "desktop");
    await record("a", "cart_sent", "phone");

    const funnel = await koshoyFunnel(db, { from: new Date(now - DAY), to: new Date(now + DAY) });
    assert.deepEqual(funnel.steps.map((step) => step.name), [...KOSHOY_JOURNEY_EVENTS]);
    const step = (name: string) => funnel.steps.find((row) => row.name === name);
    assert.deepEqual(step("card_clicked"), { name: "card_clicked", sessions: 4, phone: 2, desktop: 2, rateFromPrevious: null });
    assert.deepEqual(step("first_message"), { name: "first_message", sessions: 2, phone: 1, desktop: 1, rateFromPrevious: 0.5 });
    assert.equal(step("room_chosen")?.rateFromPrevious, 0);
    assert.equal(step("structure_photo")?.rateFromPrevious, null, "nothing to compare after 0");
    assert.equal(funnel.truncated, false);

    const empty = await koshoyFunnel(db, { from: new Date(now + DAY), to: new Date(now + 2 * DAY) });
    assert.ok(empty.steps.every((row) => row.sessions === 0));
  });
});
