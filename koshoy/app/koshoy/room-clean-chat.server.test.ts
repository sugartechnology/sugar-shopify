import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import { cabinetEngine } from "./engine";
import { toPublicEvent, type PublicEvent } from "./events";
import { createMemoryKoshoyDb, createMemoryRoomDb, sampleReadyRoom } from "./memory-db";
import { buildPhotoItems } from "./photo-items";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import type { KoshoyRoomCleanRow } from "./room-clean.server";
import type { KoshoyRoomDeps } from "./room.server";
import { createKoshoyStore, type KoshoySessionState } from "./store.server";
import { koshoyTools } from "./tools";
import { runKoshoyTurn, type KoshoyStreamFn } from "./turn.server";

const SHOP = "koshoy.myshopify.com";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const CLEAN_PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);
const CLEAN_PHOTO_LINK = "https://ihom.s3.eu-central-1.amazonaws.com/room-analysis/clean/job-1/photo.jpg";
type Hop = Array<{ event: string; data: unknown }>;
type ToolResult = { id: string; name: string; payload: Record<string, unknown> };

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  event: "tool_call",
  data: { callId: id, name, arguments: JSON.stringify(args) },
});
const say = (text: string) => ({ event: "text", data: { text } });

const ITEMS = buildPhotoItems([
  { id: 2, className: "sofa", box: [0.4, 0.45, 0.8, 0.8], area: 0.12, touches: [3] },
  { id: 3, className: "cushion", box: [0.45, 0.5, 0.55, 0.6], area: 0.01, touches: [2] },
  { id: 4, className: "rug", box: [0.05, 0.75, 0.3, 1], area: 0.03, touches: [] },
]);

async function setup(options: { withRoom?: boolean; objects?: boolean } = {}) {
  const store = createKoshoyStore(createMemoryKoshoyDb().db);
  const { session, token } = await store.createSession(SHOP);
  const rooms = createMemoryRoomDb();
  const room: KoshoyRoomDeps = {
    db: rooms.db,
    files: {
      put: async (name) => name,
      get: async (key) => (key.endsWith("photo.jpg") ? { bytes: PHOTO, contentType: "image/jpeg" } : null),
      delete: async () => {},
      deleteFolder: async () => {},
      signedUrl: async (key) => key,
    },
    tagService: async () => {
      throw new Error("no upstream here");
    },
    download: async (url) => (url === CLEAN_PHOTO_LINK ? { bytes: CLEAN_PHOTO, contentType: "image/jpeg" } : null),
  };
  if (options.withRoom !== false) {
    const row = sampleReadyRoom("room_1", session.id);
    if (options.objects !== false) row.objects = JSON.stringify(ITEMS);
    rooms.rooms.set("room_1", row);
    await store.setRoom(session.id, "room_1");
  }
  const pricer = createKoshoyPricer(cabinetEngine, createMockSkuResolver([{ pattern: "*", price: "100.00" }]));
  const fresh = async () => (await store.findSession(token, SHOP)) as KoshoySessionState;
  return { store, room, rooms, pricer, session: await fresh(), fresh };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function turn(t: Setup, text: string, hops: Hop[]) {
  const bodies: Array<Record<string, unknown>> = [];
  const stream: KoshoyStreamFn = async (_key, body, onEvent) => {
    bodies.push(structuredClone(body));
    for (const event of hops.shift() ?? []) onEvent(event);
  };
  const events: PublicEvent[] = [];
  await runKoshoyTurn({
    client: { type: "message", text },
    session: await t.fresh(),
    deps: { store: t.store, engine: cabinetEngine, pricer: t.pricer, apiKey: "k", mock: false, stream, room: t.room, data: KOSHOY_DATA_DEFAULTS },
    emit: (event) => events.push(event),
  });
  return { events, bodies };
}

/** The rug removed; its cleaned room has one free stretch of 2 m in the middle of the wall. */
function readyRugClean(t: Setup): KoshoyRoomCleanRow {
  const room = t.rooms.rooms.get("room_1")!;
  const measures = JSON.parse(room.measures!) as Record<string, unknown>;
  const clean: KoshoyRoomCleanRow = {
    id: "clean_1",
    roomId: "room_1",
    sessionId: room.sessionId,
    shop: SHOP,
    objectIds: JSON.stringify(["4"]),
    text: null,
    parts: JSON.stringify([4]),
    status: "ready",
    error: null,
    jobId: "job-1",
    photoUrl: CLEAN_PHOTO_LINK,
    depthUrl: "https://ihom.s3.eu-central-1.amazonaws.com/room-analysis/clean/job-1/depth.png",
    furnitureUrl: null,
    measures: JSON.stringify({ ...measures, free: [{ fromM: -1, toM: 1 }] }),
    method: "gemini",
    model: "gemini-2.5-flash-image",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  t.rooms.cleans.set(clean.id, clean);
  Object.assign(room, { activeCleanId: clean.id, readyCleanId: clean.id });
  return clean;
}

const results = (bodies: Array<Record<string, unknown>>, hop: number) => bodies[hop].toolResults as ToolResult[];
const roomFacts = (instructions: unknown) => {
  const line = String(instructions).split("\n").find((row) => row.startsWith("Oda (sistem bilgisi"));
  return line ? (JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>) : null;
};

describe("koshoy item removal in the chat", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
    mock.method(console, "warn", () => {});
  });
  afterEach(() => mock.restoreAll());

  it("offers the tool only with the room feature", () => {
    assert.ok(koshoyTools(true).some((tool) => tool.name === "offer_photo_cleanup"));
    assert.ok(!koshoyTools(false).some((tool) => tool.name === "offer_photo_cleanup"));
  });

  it("opens the removal card with known items ticked, and removes nothing itself", async () => {
    const t = await setup();
    const { events, bodies } = await turn(t, "Halıyı fotoğraftan kaldırmak istiyorum", [
      [call("c1", "offer_photo_cleanup", { preselect: ["4", "99", 4, "4"] })],
      [say("Kaldırmak istediklerini kartta seçebilirsin.")],
    ]);
    assert.deepEqual(
      events.filter((event) => event.type === "photo_items"),
      [{ type: "photo_items", preselect: ["4"] }],
    );
    assert.deepEqual(results(bodies, 1)[0].payload, {
      ok: true,
      shown: true,
      items: [
        { id: "2", label: "Koltuk" },
        { id: "4", label: "Halı" },
      ],
    });
    assert.equal(t.rooms.cleans.size, 0, "only the customer's button removes");
    assert.equal(t.rooms.rooms.get("room_1")!.activeCleanId, null);
  });

  it("fills the card's text field with what the customer asked to remove", async () => {
    const t = await setup();
    const { events, bodies } = await turn(t, "Kanepeyi fotoğraftan kaldır", [
      [call("c1", "offer_photo_cleanup", { preselect: ["2"], text: "  kanepe " })],
      [call("c2", "offer_photo_cleanup", { text: "x".repeat(250) })],
      [call("c3", "offer_photo_cleanup", { text: 7 })],
      [say("Kartta kaldırmak istediğini görebilirsin.")],
    ]);
    assert.deepEqual(
      events.filter((event) => event.type === "photo_items"),
      [
        { type: "photo_items", preselect: ["2"], text: "kanepe" },
        { type: "photo_items", preselect: [], text: "x".repeat(200) },
        { type: "photo_items", preselect: [] },
      ],
    );
    assert.equal(results(bodies, 1)[0].payload.ok, true);
    assert.equal(t.rooms.cleans.size, 0, "only the customer's button removes");
    const tool = koshoyTools(true).find((item) => item.name === "offer_photo_cleanup")!;
    assert.match(tool.description, /own words as text/);
  });

  it("says why the card cannot open", async () => {
    const none = await setup({ withRoom: false });
    const noRoom = await turn(none, "Halıyı kaldır", [[call("c1", "offer_photo_cleanup")], [say("Önce bir oda fotoğrafı ekler misin?")]]);
    assert.deepEqual(results(noRoom.bodies, 1)[0].payload, { ok: false, reason: "no_room" });
    assert.ok(!noRoom.events.some((event) => event.type === "photo_items"));

    const empty = await setup({ objects: false });
    const noItems = await turn(empty, "Halıyı kaldır", [[call("c1", "offer_photo_cleanup")], [say("Fotoğrafta kaldırılacak bir eşya görmedim.")]]);
    assert.deepEqual(results(noItems.bodies, 1)[0].payload, { ok: false, reason: "no_items" });
  });

  it("tells the model what is in the photo and what was removed, without measurements of the items", async () => {
    const t = await setup();
    const before = await turn(t, "Merhaba", [[say("Merhaba.")]]);
    const facts = roomFacts(before.bodies[0].instructions)!;
    assert.deepEqual(facts.photoItems, [
      { id: "2", label: "Koltuk", position: "ortada", size: "büyük" },
      { id: "4", label: "Halı", position: "solda", size: "orta" },
    ]);
    assert.equal(facts.removed, undefined);
    assert.deepEqual(facts.freeStretches, [], "the room's own measurements");
    assert.match(String(before.bodies[0].instructions), /offer_photo_cleanup ile kaldırma kartını/);

    readyRugClean(t);
    const after = await turn(t, "Peki", [[say("Tamam.")]]);
    const cleaned = roomFacts(after.bodies[0].instructions)!;
    assert.deepEqual(cleaned.removed, ["Halı"]);
    t.rooms.cleans.get("clean_1")!.text = "halıyı ve masadaki vazoyu";
    const written = roomFacts((await turn(t, "Peki", [[say("Tamam.")]])).bodies[0].instructions)!;
    assert.deepEqual(written.removed, ["Halı", "halıyı ve masadaki vazoyu"], "the picked names and what the customer wrote");
    assert.deepEqual(
      (cleaned.freeStretches as Array<Record<string, number>>).map((stretch) => stretch.widthCm),
      [200],
      "measured with the cleaned furniture mask",
    );

    const none = await setup({ withRoom: false });
    const noRoom = await turn(none, "Merhaba", [[say("Merhaba.")]]);
    assert.doesNotMatch(String(noRoom.bodies[0].instructions), /offer_photo_cleanup ile/, "the rule needs a ready room");
  });

  it("shows the model each photo once: the room, then the room after a removal", async () => {
    const t = await setup();
    const first = await turn(t, "Merhaba", [[say("Merhaba.")]]);
    assert.deepEqual(first.bodies[0].image, { contentBase64: Buffer.from(PHOTO).toString("base64"), mimeType: "image/jpeg" });
    assert.equal((await t.fresh()).photoSentRoomId, "room_1");

    readyRugClean(t);
    const cleaned = await turn(t, "Halı gitti mi?", [[say("Evet, fotoğrafta artık yok.")]]);
    assert.deepEqual(cleaned.bodies[0].image, {
      contentBase64: Buffer.from(CLEAN_PHOTO).toString("base64"),
      mimeType: "image/jpeg",
    });
    assert.equal((await t.fresh()).photoSentRoomId, "room_1:clean_1");

    const again = await turn(t, "Peki", [[say("Tamam.")]]);
    assert.equal(again.bodies[0].image, undefined, "already seen");
  });

  it("whitelists the photo_items event", () => {
    const many = Array.from({ length: 20 }, (_, index) => String(index + 1));
    assert.deepEqual(toPublicEvent({ type: "photo_items", preselect: ["2", "2", "bad id!", 7, "4"], label: "Koltuk" }), {
      type: "photo_items",
      preselect: ["2", "4"],
    });
    assert.deepEqual(toPublicEvent({ type: "photo_items" }), { type: "photo_items", preselect: [] });
    assert.deepEqual(toPublicEvent({ type: "photo_items", preselect: ["2"], text: "  kanepe  " }), {
      type: "photo_items",
      preselect: ["2"],
      text: "kanepe",
    });
    assert.deepEqual(toPublicEvent({ type: "photo_items", text: "   " }), { type: "photo_items", preselect: [] });
    assert.deepEqual(toPublicEvent({ type: "photo_items", text: { a: 1 } }), { type: "photo_items", preselect: [] });
    assert.equal((toPublicEvent({ type: "photo_items", text: "y".repeat(300) }) as { text: string }).text.length, 200);
    assert.equal((toPublicEvent({ type: "photo_items", preselect: many }) as { preselect: string[] }).preselect.length, 12);
  });
});
