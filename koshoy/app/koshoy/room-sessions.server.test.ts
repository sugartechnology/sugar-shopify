import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeletableFolder, type KoshoyFileStore } from "../services/s3.server";
import { cabinetEngine } from "./engine";
import { createMemoryKoshoyDb, createMemoryRoomDb, createMemoryRoomSessionsDb, sampleReadyRoom } from "./memory-db";
import {
  cleanJobFolder,
  deleteRoomSession,
  listRoomSessions,
  numberRoomNames,
  roomTypeName,
  type KoshoyRoomSessionsDeps,
} from "./room-sessions.server";
import { createKoshoyStore } from "./store.server";

const SHOP = "koshoy.myshopify.com";
const ROOM_TYPES = [
  { id: "yatak_odasi", label: "Yatak odası", synonyms: [] },
  { id: "salon", label: "Salon", synonyms: ["oturma odası"] },
];

function setup() {
  let now = 1_000_000;
  const koshoy = createMemoryKoshoyDb(() => now);
  const rooms = createMemoryRoomDb(() => now);
  const store = createKoshoyStore(koshoy.db, { now: () => now });
  const deleted: string[] = [];
  const deletedFolders: string[] = [];
  const files: KoshoyFileStore = {
    put: async (name) => name,
    get: async () => null,
    signedUrl: async (key) => key,
    delete: async (key) => {
      deleted.push(key);
    },
    deleteFolder: async (prefix) => {
      deletedFolders.push(prefix);
    },
  };
  const deps: KoshoyRoomSessionsDeps = {
    db: createMemoryRoomSessionsDb(koshoy, rooms),
    store,
    files,
    roomTypes: ROOM_TYPES,
    now: () => now,
  };
  /** A room the customer used: the assistant knows its type and it has a design. */
  const usedRoom = async (type: string, customerId: string | null = null) => {
    const { session, token } = await store.createSession(SHOP, customerId);
    session.brief.room = type;
    session.events.push({ type: "text", text: "Merhaba" });
    await store.saveSession(session);
    const plan = cabinetEngine.planCabinet({ kind: "gardirop" });
    await store.createDesign(session.id, { kind: "gardirop", label: plan.label, composition: plan.composition });
    return { session, token };
  };
  return { koshoy, rooms, store, deps, deleted, deletedFolders, usedRoom, advance: (ms: number) => (now += ms) };
}

describe("room names", () => {
  it("uses Akın's room label by id, label or synonym, else the customer's words", () => {
    assert.equal(roomTypeName("yatak_odasi", ROOM_TYPES), "Yatak odası");
    assert.equal(roomTypeName("SALON", ROOM_TYPES), "Salon");
    assert.equal(roomTypeName("oturma odası", ROOM_TYPES), "Salon");
    assert.equal(roomTypeName("çalışma odası", ROOM_TYPES), "Çalışma odası");
    assert.equal(roomTypeName("  ", ROOM_TYPES), "Yeni oda");
  });

  it("numbers rooms of the same type in the order they were opened", () => {
    assert.deepEqual(
      numberRoomNames([
        { type: "Salon", createdAt: 30 },
        { type: "Yatak odası", createdAt: 20 },
        { type: "Salon", createdAt: 10 },
      ]),
      ["Salon 2", "Yatak odası", "Salon"],
    );
  });
});

describe("room sessions in the store", () => {
  it("opens an account room only for its own customer", async () => {
    const { store } = setup();
    const { token } = await store.createSession(SHOP, "c1");
    assert.ok(await store.findSession(token, SHOP, "c1"));
    assert.equal(await store.findSession(token, SHOP, null), null, "signed out");
    assert.equal(await store.findSession(token, SHOP, "c2"), null, "someone else");
  });

  it("gives another device its own token and keeps at most five", async () => {
    const { store, koshoy } = setup();
    const { session, token } = await store.createSession(SHOP, "c1");
    assert.equal(await store.openOnDevice(session.id, SHOP, "c2"), null);
    const opened = await store.openOnDevice(session.id, SHOP, "c1");
    assert.ok(opened);
    assert.notEqual(opened.token, token);
    assert.equal((await store.findSession(opened.token, SHOP, "c1"))?.id, session.id);
    assert.equal((await store.findSession(token, SHOP, "c1"))?.id, session.id, "first token still works");
    for (let i = 0; i < 6; i += 1) await store.openOnDevice(session.id, SHOP, "c1");
    assert.equal(koshoy.keys.size, 5);
    assert.equal(await store.findSession(opened.token, SHOP, "c1"), null, "oldest key dropped");
  });

  it("an attached used room lives 180 days, an unused one keeps its short life", async () => {
    const { store, usedRoom, advance } = setup();
    const used = await usedRoom("salon");
    const fresh = await store.createSession(SHOP);
    await store.attachCustomer(used.session, "c1");
    await store.attachCustomer(fresh.session, "c1");
    advance(25 * 60 * 60 * 1000); // past the 24 h of an unused session
    assert.equal(await store.findSession(fresh.token, SHOP, "c1"), null);
    advance(100 * 24 * 60 * 60 * 1000); // past the 30 days of a browser-only room
    assert.ok(await store.findSession(used.token, SHOP, "c1"));
  });
});

describe("room list", () => {
  it("lists this browser's rooms with names, counts and its own tokens", async () => {
    const { deps, usedRoom, advance } = setup();
    const salon = await usedRoom("salon");
    advance(1000);
    const bedroom = await usedRoom("yatak_odasi");
    advance(1000);
    const salon2 = await usedRoom("oturma odası");
    const list = await listRoomSessions(deps, {
      shop: SHOP,
      customerId: null,
      keys: [salon.token, bedroom.token, salon2.token, "x".repeat(43)],
    });
    assert.deepEqual(
      list.map((room) => [room.name, room.key, room.designs, room.account]),
      [
        ["Salon 2", salon2.token, 1, false],
        ["Yatak odası", bedroom.token, 1, false],
        ["Salon", salon.token, 1, false],
      ],
    );
  });

  it("shows the photo and the room approval", async () => {
    const { deps, store, usedRoom } = setup();
    const { session, token } = await usedRoom("salon");
    await store.setRoom(session.id, "room1");
    session.journey.roomApprovedAt = 5;
    await store.saveSession({ ...session, roomId: "room1" });
    const [room] = await listRoomSessions(deps, { shop: SHOP, customerId: null, keys: [token] });
    assert.equal(room.photo, "room1");
    assert.equal(room.approved, true);
  });

  it("joins the browser's rooms to the account when the customer signs in", async () => {
    const { deps, usedRoom } = setup();
    const { session, token } = await usedRoom("salon");
    const attached: string[] = [];
    const list = await listRoomSessions(deps, {
      shop: SHOP,
      customerId: "c1",
      keys: [token],
      onAttach: (id) => attached.push(id),
    });
    assert.deepEqual(attached, [session.id]);
    assert.equal(list[0].account, true);
    const again = await listRoomSessions(deps, { shop: SHOP, customerId: "c1", keys: [token] });
    assert.equal(again.length, 1);
    assert.deepEqual(attached, [session.id], "attached once");
  });

  it("brings account rooms from another device without a token, hides them when signed out", async () => {
    const { deps, usedRoom } = setup();
    const other = await usedRoom("yatak_odasi", "c1");
    const here = await usedRoom("salon");
    const signedIn = await listRoomSessions(deps, { shop: SHOP, customerId: "c1", keys: [here.token] });
    const remote = signedIn.find((room) => room.ref === other.session.id);
    assert.ok(remote);
    assert.equal(remote.key, undefined);
    assert.equal(remote.photo, undefined);

    const signedOut = await listRoomSessions(deps, {
      shop: SHOP,
      customerId: null,
      keys: [here.token, other.token],
    });
    assert.deepEqual(signedOut, [], "both rooms are in the account now");
    const someoneElse = await listRoomSessions(deps, { shop: SHOP, customerId: "c2", keys: [other.token] });
    assert.deepEqual(someoneElse, []);
  });

  it("shows an unused account room only in the browser that opened it", async () => {
    const { deps, store } = setup();
    const unused = await store.createSession(SHOP, "c1");
    const elsewhere = await listRoomSessions(deps, { shop: SHOP, customerId: "c1", keys: [] });
    assert.deepEqual(elsewhere, []);
    const here = await listRoomSessions(deps, { shop: SHOP, customerId: "c1", keys: [unused.token] });
    assert.deepEqual(here.map((room) => room.name), ["Yeni oda"]);
  });

  it("returns nothing without tokens or a customer", async () => {
    const { deps } = setup();
    assert.deepEqual(await listRoomSessions(deps, { shop: SHOP, customerId: null, keys: [] }), []);
  });
});

describe("room delete", () => {
  it("deletes the session, its rows and the files in S3 with the room's own token", async () => {
    const { deps, koshoy, rooms, usedRoom, deleted } = setup();
    const { session, token } = await usedRoom("salon");
    const room = sampleReadyRoom("room1", session.id);
    rooms.rooms.set(room.id, room);
    rooms.renders.set("r1", {
      id: "r1",
      sessionId: session.id,
      shop: SHOP,
      roomId: room.id,
      designIds: "[]",
      status: "ready",
      error: null,
      jobId: null,
      compositeKey: "koshoy-studio/renders/r1/composite.jpg",
      cabinetKey: "koshoy-studio/renders/r1/cabinet.jpg",
      resultKey: "koshoy-studio/renders/r1/result.jpg",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keep = await usedRoom("yatak_odasi");

    assert.equal(await deleteRoomSession(deps, { shop: SHOP, customerId: null, ref: session.id, key: keep.token }), false);
    assert.equal(await deleteRoomSession(deps, { shop: SHOP, customerId: null, ref: session.id, key: token }), true);
    assert.deepEqual(deleted.sort(), [
      "koshoy-studio/renders/r1/cabinet.jpg",
      "koshoy-studio/renders/r1/composite.jpg",
      "koshoy-studio/renders/r1/result.jpg",
      "koshoy-studio/rooms/room1/photo.jpg",
    ]);
    assert.equal(koshoy.sessions.has(session.id), false);
    assert.equal([...koshoy.designs.values()].some((row) => row.sessionId === session.id), false);
    assert.equal(rooms.rooms.size, 0);
    assert.equal(rooms.renders.size, 0);
    assert.ok(koshoy.sessions.has(keep.session.id), "other room untouched");
  });

  it("deletes the furniture-removal folder of every clean job, and nothing else", async () => {
    const { deps, rooms, usedRoom, deletedFolders } = setup();
    const { session, token } = await usedRoom("salon");
    const room = sampleReadyRoom("room1", session.id);
    rooms.rooms.set(room.id, room);
    const clean = (id: string, jobId: string | null) => ({
      id,
      roomId: room.id,
      sessionId: session.id,
      shop: SHOP,
      objectIds: "[]",
      parts: "[]",
      status: "ready",
      error: null,
      jobId,
      photoUrl: null,
      depthUrl: null,
      furnitureUrl: null,
      measures: null,
      method: null,
      model: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rooms.cleans.set("c1", clean("c1", "0b6f1c2e-6a49-4c2b-9d1e-3f5a7b8c9d01"));
    rooms.cleans.set("c2", clean("c2", null));
    rooms.cleans.set("c3", clean("c3", "../designs"));

    assert.equal(await deleteRoomSession(deps, { shop: SHOP, customerId: null, ref: session.id, key: token }), true);
    assert.deepEqual(deletedFolders, ["room-analysis/clean/0b6f1c2e-6a49-4c2b-9d1e-3f5a7b8c9d01/"]);
    assert.equal(rooms.cleans.size, 0, "clean rows go with their room");
  });

  it("only ever deletes a decor-ai clean job folder", () => {
    assert.equal(cleanJobFolder("job-1"), "room-analysis/clean/job-1/");
    assert.equal(cleanJobFolder(""), null);
    assert.equal(cleanJobFolder("a/b"), null);
    assert.equal(cleanJobFolder("../x"), null);
    assert.equal(isDeletableFolder("room-analysis/clean/job-1/"), true);
    assert.equal(isDeletableFolder("room-analysis/clean/"), false);
    assert.equal(isDeletableFolder("room-analysis/clean/job-1"), false);
    assert.equal(isDeletableFolder("room-analysis/../designs/"), false);
    assert.equal(isDeletableFolder("room-analysis//x/"), false);
  });

  it("deletes an account room without its token only for its customer", async () => {
    const { deps, koshoy, usedRoom } = setup();
    const { session } = await usedRoom("salon", "c1");
    assert.equal(await deleteRoomSession(deps, { shop: SHOP, customerId: "c2", ref: session.id, key: null }), false);
    assert.equal(await deleteRoomSession(deps, { shop: SHOP, customerId: null, ref: session.id, key: null }), false);
    assert.equal(await deleteRoomSession(deps, { shop: SHOP, customerId: "c1", ref: session.id, key: null }), true);
    assert.equal(koshoy.sessions.has(session.id), false);
  });

  it("keeps the rows when S3 fails, so nothing is left behind", async () => {
    const { deps, koshoy, rooms, usedRoom } = setup();
    const { session, token } = await usedRoom("salon");
    const room = sampleReadyRoom("room1", session.id);
    rooms.rooms.set(room.id, room);
    const failing: KoshoyRoomSessionsDeps = {
      ...deps,
      files: { ...deps.files!, delete: async () => Promise.reject(new Error("AccessDenied")) },
    };
    await assert.rejects(deleteRoomSession(failing, { shop: SHOP, customerId: null, ref: session.id, key: token }));
    assert.ok(koshoy.sessions.has(session.id));
    assert.equal(rooms.rooms.size, 1);
  });
});
