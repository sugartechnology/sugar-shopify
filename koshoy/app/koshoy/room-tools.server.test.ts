import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import type { ClientInput } from "./input";
import { cabinetEngine } from "./engine";
import type { LayoutItemView, PublicEvent } from "./events";
import { readLayout } from "./layout.server";
import { createMemoryKoshoyDb, createMemoryRoomDb, sampleReadyRoom } from "./memory-db";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import type { KoshoyRoomDeps } from "./room.server";
import { createKoshoyStore, type KoshoySessionState } from "./store.server";
import { runKoshoyTurn, type KoshoyStreamFn } from "./turn.server";

const SHOP = "koshoy.myshopify.com";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
type Hop = Array<{ event: string; data: unknown }>;
type ToolResult = { id: string; name: string; payload: Record<string, unknown> };

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  event: "tool_call",
  data: { callId: id, name, arguments: JSON.stringify(args) },
});

function scripted(hops: Hop[]) {
  const bodies: Array<Record<string, unknown>> = [];
  const stream: KoshoyStreamFn = async (_key, body, onEvent) => {
    bodies.push(structuredClone(body));
    for (const event of hops.shift() ?? []) onEvent(event);
  };
  return { stream, bodies };
}

async function setup(options: { withRoom?: boolean } = {}) {
  const store = createKoshoyStore(createMemoryKoshoyDb().db);
  const { session, token } = await store.createSession(SHOP);
  const rooms = createMemoryRoomDb();
  const room: KoshoyRoomDeps = {
    db: rooms.db,
    files: {
      put: async (name) => name,
      get: async (key) => (key.endsWith("photo.jpg") ? { bytes: PHOTO, contentType: "image/jpeg" } : null),
      signedUrl: async (key) => key,
      delete: async () => {},
    },
    tagService: async () => {
      throw new Error("no upstream here");
    },
    download: async () => null,
  };
  if (options.withRoom !== false) {
    rooms.rooms.set("room_1", sampleReadyRoom("room_1", session.id));
    await store.setRoom(session.id, "room_1");
  }
  const pricer = createKoshoyPricer(cabinetEngine, createMockSkuResolver([{ pattern: "*", price: "100.00" }]));
  const fresh = async () => (await store.findSession(token, SHOP)) as KoshoySessionState;
  return { store, room, rooms, pricer, session: await fresh(), fresh };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function turn(t: Setup, text: string, hops: Hop[], session?: KoshoySessionState) {
  const { stream, bodies } = scripted(hops);
  const events: PublicEvent[] = [];
  await runKoshoyTurn({
    client: { type: "message", text },
    session: session ?? (await t.fresh()),
    deps: { store: t.store, engine: cabinetEngine, pricer: t.pricer, apiKey: "k", mock: false, stream, room: t.room, data: KOSHOY_DATA_DEFAULTS },
    emit: (event) => events.push(event),
  });
  return { events, bodies };
}

async function design(t: Setup, widthMm = 960) {
  const composition = cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: widthMm }).composition;
  return t.store.createDesign(t.session.id, { kind: "gardirop", label: `Gardırop ${widthMm / 10} cm`, composition });
}

const results = (bodies: Array<Record<string, unknown>>, hop: number) => bodies[hop].toolResults as ToolResult[];
const layouts = (events: PublicEvent[]) =>
  events.filter((event): event is Extract<PublicEvent, { type: "layout" }> => event.type === "layout");
const center = (items: LayoutItemView[], id: string) => {
  const place = items.find((item) => item.designId === id)?.place;
  return place?.surface === "wall" ? place.alongM : NaN;
};

function assertNoLeak(value: unknown) {
  const json = JSON.stringify(value);
  for (const marker of ["room_1", "photo.jpg", "amazonaws", "scaleSource", "measures", "place_in_room", "alongM\":null"]) {
    assert.ok(!json.includes(marker), `leaked ${marker}`);
  }
}

describe("koshoy room tools in the chat", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
    mock.method(console, "warn", () => {});
  });
  afterEach(() => mock.restoreAll());

  it("places a design by every kind of request and reports its stretch of wall", async () => {
    const t = await setup();
    const a = await design(t, 960);
    const b = await design(t, 480);
    const { events, bodies } = await turn(t, "Yerleştir", [
      [
        call("c1", "place_in_room", { designId: a.id, at: "free" }),
        call("c2", "place_in_room", { designId: b.id, at: "right_of", refDesignId: a.id }),
      ],
      [
        call("c3", "place_in_room", { designId: b.id, at: "left_of", refDesignId: a.id }),
        call("c4", "place_in_room", { designId: a.id, at: "wall_cm", wallCm: 270, align: "left_edge" }),
      ],
      [call("c5", "place_in_room", { designId: b.id, at: "photo_x", photoX: 0.9, align: "right_edge", rotateDeg: 20 })],
      [{ event: "text", data: { text: "Yerleştirdim." } }],
    ]);

    const [free, right] = results(bodies, 1);
    assert.equal(free.payload.ok, true);
    // Middle of the 3.67 m wall; each edge rounded to 10 cm on its own (136 → 140, 231.6 → 230).
    assert.deepEqual(free.payload.place, { fromCm: 140, toCm: 230 });
    assert.deepEqual(free.payload.wall, { fromCm: 0, toCm: 370 });
    assert.deepEqual(right.payload.place, { fromCm: 230, toCm: 280 });

    const [left, atCm] = results(bodies, 2);
    assert.deepEqual(left.payload.place, { fromCm: 90, toCm: 140 });
    assert.equal(atCm.payload.ok, true);
    assert.deepEqual(atCm.payload.place, { fromCm: 270, toCm: 370 }, "its left edge 270 cm from the wall's start");
    assert.equal(atCm.payload.notes, undefined, "exactly where asked");

    // b's right edge at 90 % of the photo would overlap a: the nearest free spot is just left of a.
    const [atPhoto] = results(bodies, 3);
    assert.equal(atPhoto.payload.ok, true);
    const notes = (atPhoto.payload.notes as string[]).join(" ");
    assert.match(notes, /dönmez/);
    assert.match(notes, /en yakın boş yere/);
    const last = layouts(events).at(-1)!;
    assert.equal(last.items.length, 2);
    assert.ok(Math.abs(center(last.items, b.id) + 0.24 - (center(last.items, a.id) - 0.48)) < 1e-6, "touches a, no overlap");
    assertNoLeak(events);
    assert.equal(layouts(events).length, 5, "one layout event per change");
    // Positions are measurements: they may be quoted only as "yaklaşık".
    const instructions = String(bodies[3].instructions);
    assert.match(instructions, /Yerleşim \(sistem bilgisi, soldan sağa\)/);
    assert.match(instructions, /Oda \(sistem bilgisi, ölçüler yaklaşık\)/);
  });

  it("never says a room size, not even 'yaklaşık' (ClickUp z8qu5d7rdp)", async () => {
    const t = await setup();
    await design(t, 1920);
    const { events, bodies } = await turn(t, "Sığar mı?", [
      [{ event: "text", data: { text: "Duvar 370 cm. Duvar yaklaşık 3,7 m görünüyor. Gardırop rahatça sığar." } }],
    ]);
    const text = events.filter((event) => event.type === "text").map((event) => (event.type === "text" ? event.text : ""));
    assert.deepEqual(text, ["Gardırop rahatça sığar."]);
    assert.doesNotMatch(String(bodies[0].instructions), /"yaklaşık" diyerek/);
  });

  it("asks for the first realistic picture by itself when the room summary comes, once", async () => {
    const t = await setup();
    await design(t);
    const session = await t.fresh();
    session.brief.room = "Yatak odası";
    Object.assign(session.journey.style, { level: "en_iyisi", panel: "ivory", front: "kapak-18", crown: "on" });
    // The colour pick ends the style decisions: the room summary comes, with the picture request.
    session.journey.style.panel = "";
    session.pendingAskUser = {
      id: "s1",
      question: "Renk?",
      options: [{ id: "opt_1", label: "Kırık beyaz", value: "style:panel:ivory" }],
    };
    const { stream } = scripted([[{ event: "text", data: { text: "Özetin ekranda." } }], [{ event: "text", data: { text: "Tamam." } }]]);
    const run = async (client: ClientInput) => {
      const events: PublicEvent[] = [];
      await runKoshoyTurn({
        client,
        session,
        deps: { store: t.store, engine: cabinetEngine, pricer: t.pricer, apiKey: "k", mock: false, stream, room: t.room, data: KOSHOY_DATA_DEFAULTS },
        emit: (event) => events.push(event),
      });
      return events;
    };
    const first = await run({ type: "choice", selected: "opt_1" });
    assert.ok(first.some((event) => event.type === "room_summary"));
    assert.equal(first.filter((event) => event.type === "render_request").length, 1);
    const second = await run({ type: "journey", action: "change_room" });
    assert.equal(second.filter((event) => event.type === "render_request").length, 0, "only once");
  });

  it("does not offer to show the room when the room is already there", async () => {
    const t = await setup();
    const withRoom = await turn(t, "Merhaba", [[{ event: "text", data: { text: "Merhaba." } }]]);
    assert.match(String(withRoom.bodies[0].instructions), /odanın içinde görmek ister misin.*sorma/);
    const studio = await setup({ withRoom: false });
    const noRoom = await turn(studio, "Merhaba", [[{ event: "text", data: { text: "Merhaba." } }]]);
    assert.ok(!String(noRoom.bodies[0].instructions).includes("odanın içinde görmek"));
  });

  it("lets a newly planned design walk into a ready room, and not into the studio", async () => {
    const t = await setup();
    const planned = await turn(t, "Gardırop", [[call("p1", "plan_cabinet", { kind: "gardirop", targetWidthCm: 96 })], []]);
    const [result] = results(planned.bodies, 1);
    assert.equal(result.payload.room, "Tasarım odaya yerleşti.");
    assert.equal(layouts(planned.events).length, 1);
    assert.equal((await readLayout(t.room.db, t.session.id)).items.length, 1);

    const studio = await setup({ withRoom: false });
    const inStudio = await turn(studio, "Gardırop", [[call("p1", "plan_cabinet", { kind: "gardirop" })], []]);
    assert.equal(layouts(inStudio.events).length, 0, "today's single design view stays");
    assert.equal(results(inStudio.bodies, 1)[0].payload.room, undefined);
  });

  it("works on the studio's virtual wall without a room, except at a photo position", async () => {
    const t = await setup({ withRoom: false });
    const a = await design(t);
    const { events, bodies } = await turn(t, "Koy", [
      [
        call("c1", "place_in_room", { designId: a.id, at: "wall_cm", wallCm: 100, align: "left_edge" }),
        call("c2", "place_in_room", { designId: a.id, at: "photo_x", photoX: 0.5 }),
      ],
      [],
    ]);
    const [atCm, atPhoto] = results(bodies, 1);
    assert.equal(atCm.payload.ok, true);
    assert.deepEqual(atCm.payload.place, { fromCm: 100, toCm: 200 }, "studio wall, 8 m");
    assert.equal(atPhoto.payload.error, "no_room");
    assert.equal(layouts(events)[0].items[0].place?.surface, "wall");
    const shown = await turn(t, "Odamda göster", [[call("s1", "show_in_room", { designId: a.id })], []]);
    assert.equal(results(shown.bodies, 1)[0].payload.error, "no_room");
    assert.ok(!shown.events.some((event) => event.type === "room_show"));
  });

  it("removes a design, refuses a ninth one and re-settles after a wider edit", async () => {
    const t = await setup();
    const a = await design(t, 960);
    const b = await design(t, 960);
    await turn(t, "Koy", [
      [call("c1", "place_in_room", { designId: a.id, at: "free" }), call("c2", "place_in_room", { designId: b.id, at: "right_of", refDesignId: a.id })],
      [],
    ]);
    const before = await readLayout(t.room.db, t.session.id);

    // a gets wider: b is pushed right as little as needed.
    const edited = await turn(t, "Genişlet", [
      [call("e1", "edit_design", { designId: a.id, op: { action: "set_total_width", widthMm: 1440 } })],
      [],
    ]);
    const settled = layouts(edited.events).at(-1)!;
    assert.ok(settled.version > before.version);
    const gap = center(settled.items, b.id) - center(settled.items, a.id);
    assert.ok(Math.abs(gap - (1.44 + 0.96) / 2) < 1e-6, String(gap));

    const removed = await turn(t, "Çıkar", [[call("r1", "remove_from_room", { designId: a.id })], []]);
    assert.deepEqual(layouts(removed.events).at(-1)!.items.map((item) => item.designId), [b.id]);

    for (let i = 0; i < 7; i += 1) {
      const extra = await design(t, 160);
      await turn(t, "Koy", [[call(`x${i}`, "place_in_room", { designId: extra.id, at: "free" })], []]);
    }
    const ninth = await design(t, 160);
    const full = await turn(t, "Koy", [[call("n1", "place_in_room", { designId: ninth.id, at: "free" })], []]);
    assert.equal(results(full.bodies, 1)[0].payload.error, "layout_full");
  });

  it("sends the room photo once per room and model conversation", async () => {
    const t = await setup();
    await design(t);
    const first = await turn(t, "Merhaba", [[call("c1", "quote")], [{ event: "text", data: { text: "Tamam." } }]]);
    assert.deepEqual(first.bodies[0].image, {
      contentBase64: Buffer.from(PHOTO).toString("base64"),
      mimeType: "image/jpeg",
    });
    assert.equal(first.bodies[1].image, undefined, "not with tool results");
    const second = await turn(t, "Peki", [[{ event: "text", data: { text: "Tamam." } }]]);
    assert.equal(second.bodies[0].image, undefined, "already seen");

    t.rooms.rooms.set("room_2", sampleReadyRoom("room_2", t.session.id));
    await t.store.setRoom(t.session.id, "room_2");
    const newRoom = await turn(t, "Yeni oda", [[{ event: "text", data: { text: "Tamam." } }]]);
    assert.ok(newRoom.bodies[0].image, "a new room is shown again");
  });

  it("keeps the first design in the room when a second one walks in", async () => {
    const t = await setup();
    await turn(t, "Gardırop", [[call("p1", "plan_cabinet", { kind: "gardirop", targetWidthCm: 96 })], []]);
    await turn(t, "Komodin", [[call("p2", "plan_cabinet", { kind: "komodin" })], []]);
    const layout = await readLayout(t.room.db, t.session.id);
    assert.equal(layout.items.length, 2);
    assert.ok(layout.items.every((item) => item.place?.surface === "wall"));
  });

  it("marks the photo seen only after the model answered without an error", async () => {
    const t = await setup();
    await design(t);
    const failed = await turn(t, "Merhaba", [[{ event: "error", data: { message: "upstream down" } }]]);
    assert.ok(failed.bodies[0].image, "sent");
    assert.equal((await t.fresh()).photoSentRoomId, null, "but not seen");
    const retried = await turn(t, "Merhaba", [[{ event: "text", data: { text: "Merhaba." } }]]);
    assert.ok(retried.bodies[0].image, "sent again");
    assert.equal((await t.fresh()).photoSentRoomId, "room_1");

    const late = await setup();
    const { stream, bodies } = scripted([]);
    const stalled: KoshoyStreamFn = async (key, body, onEvent) => {
      await stream(key, body, onEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    await runKoshoyTurn({
      client: { type: "message", text: "Merhaba" },
      session: await late.fresh(),
      deps: { store: late.store, engine: cabinetEngine, pricer: late.pricer, apiKey: "k", mock: false, stream: stalled, room: late.room, timeoutMs: 10, data: KOSHOY_DATA_DEFAULTS },
      emit: () => {},
    });
    assert.ok(bodies[0].image);
    assert.equal((await late.fresh()).photoSentRoomId, null, "a timed-out hop leaves it unseen");
  });

  it("says a photo without a usable floor is the problem, not a missing photo", async () => {
    const t = await setup({ withRoom: false });
    const row = sampleReadyRoom("room_f", t.session.id);
    const planes = JSON.parse(row.planes!) as Record<string, unknown>;
    delete planes.floor;
    t.rooms.rooms.set("room_f", { ...row, planes: JSON.stringify(planes) });
    await t.store.setRoom(t.session.id, "room_f");
    const a = await design(t);
    const { events, bodies } = await turn(t, "Odaya koy", [
      [
        call("c1", "place_in_room", { designId: a.id, at: "free" }),
        call("c2", "show_in_room", { designId: a.id }),
        call("c3", "render_room", { designId: a.id }),
      ],
      [],
    ]);
    for (const result of results(bodies, 1)) {
      assert.equal(result.payload.error, "no_floor", result.name);
      assert.match(String(result.payload.hint), /zemin/);
    }
    assert.equal(layouts(events).length, 0);
    const instructions = String(bodies[0].instructions);
    assert.match(instructions, /zemin bulunamadı/);
    assert.ok(!instructions.includes("fotoğraf düğmesiyle"), "never 'upload a photo'");
    assert.ok(instructions.includes("Oda ölçüsü söylemezsin"), "no usable room: the old room rule");
  });

  it("reports a placement lost to another writer as an error", async () => {
    const t = await setup();
    const a = await design(t);
    await turn(t, "Koy", [[call("c1", "place_in_room", { designId: a.id, at: "free" })], []]);
    // The customer takes it out ("×") between the tool's read and its write.
    // Reads in the next turn: 1 hop context, 2 the tool, 3 the save's re-read.
    const layouts = t.room.db.koshoyLayout;
    const findUnique = layouts.findUnique.bind(layouts);
    let reads = 0;
    layouts.findUnique = async (args) => {
      const row = await findUnique(args);
      reads += 1;
      if (reads !== 3 || !row) return row;
      const items = (JSON.parse(row.items) as Array<{ designId: string }>).filter((item) => item.designId !== a.id);
      return { ...row, items: JSON.stringify(items) };
    };
    const moved = await turn(t, "Kaydır", [[call("c2", "place_in_room", { designId: a.id, at: "wall_cm", wallCm: 50 })], []]);
    const [result] = results(moved.bodies, 1);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "not_placed");
  });

  it("lets a new design walk into an empty stretch of wall, not behind the furniture", async () => {
    const t = await setup({ withRoom: false });
    const row = sampleReadyRoom("room_s", t.session.id);
    const measures = JSON.parse(row.measures!);
    measures.free = [{ fromM: 0.6, toM: 1.8 }]; // the rest of the wall is behind a sofa
    t.rooms.rooms.set("room_s", { ...row, measures: JSON.stringify(measures) });
    await t.store.setRoom(t.session.id, "room_s");
    await turn(t, "Komodin", [[call("p1", "plan_cabinet", { kind: "komodin" })], []]);
    const [item] = (await readLayout(t.room.db, t.session.id)).items;
    assert.ok(item.place?.surface === "wall" && item.place.alongM >= 0.6 && item.place.alongM <= 1.8, JSON.stringify(item));
  });

  it("places on the floor at a photo point and says when nothing moved", async () => {
    const t = await setup({ withRoom: false });
    const row = sampleReadyRoom("room_n", t.session.id);
    const planes = JSON.parse(row.planes!);
    delete planes.wall;
    t.rooms.rooms.set("room_n", { ...row, planes: JSON.stringify(planes), measures: null });
    await t.store.setRoom(t.session.id, "room_n");
    const a = await design(t);
    const ask = { designId: a.id, at: "photo_x", photoX: 0.3, photoY: 0.9 };
    const first = await turn(t, "Şuraya koy", [[call("c1", "place_in_room", ask)], []]);
    const [placed] = results(first.bodies, 1);
    assert.equal(placed.payload.ok, true);
    const place = layouts(first.events).at(-1)!.items[0].place;
    assert.ok(place?.surface === "floor" && place.xM < 0, "left of the camera, where the photo shows");

    const again = await turn(t, "Şuraya koy", [[call("c2", "place_in_room", ask)], []]);
    const [unchanged] = results(again.bodies, 1);
    assert.equal(unchanged.payload.ok, false);
    assert.equal(unchanged.payload.error, "unchanged");
    assert.match(String(unchanged.payload.hint), /yerleştirdim deme/);
  });
});
