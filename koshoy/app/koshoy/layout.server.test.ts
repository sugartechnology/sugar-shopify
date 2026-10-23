import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cabinetEngine } from "./engine";
import {
  applyLayoutOp,
  designSizes,
  fitStudioTarget,
  gapAround,
  layoutTarget,
  settleItems,
  STUDIO_TARGET,
  targetView,
  wantedPlace,
  type DesignSize,
  type LayoutTarget,
} from "./layout-solver";
import { changeLayout, readLayout, updateLayout } from "./layout.server";
import type { LayoutItemView, LayoutPlaceView } from "./events";
import { createMemoryRoomDb, sampleReadyRoom } from "./memory-db";
import { floorRow, floorToImage, imageXToAlong } from "./room-layout";
import { measureRoom } from "./room-measure.server";
import { roomView } from "./room.server";
import type { KoshoyDesign } from "./store.server";

const metre = (widthM: number, depthM = 0.6): DesignSize => ({ widthM, depthM });
const sizes = new Map<string, DesignSize>([
  ["a", metre(1)],
  ["b", metre(1)],
  ["c", metre(2)],
]);
const wallItem = (designId: string, alongM: number): LayoutItemView => ({
  designId,
  place: { surface: "wall", alongM },
});

/** The sample room: wall 3.1 m ahead, visible about ±1.84 m. */
function roomTarget(): LayoutTarget {
  return layoutTarget(roomView(sampleReadyRoom("r1", "s1")));
}

/** The sample room without its wall plane: cabinets stand on the floor. */
function floorTarget(): LayoutTarget {
  const row = sampleReadyRoom("r2", "s1");
  const planes = JSON.parse(row.planes!) as Record<string, unknown>;
  delete planes.wall;
  return layoutTarget(roomView({ ...row, planes: JSON.stringify(planes), measures: null }));
}

describe("koshoy room layout", () => {
  it("picks the room wall, the room floor or the studio wall", () => {
    const wall = roomTarget();
    assert.equal(wall.surface, "wall");
    assert.equal(wall.roomId, "r1");
    assert.ok(wall.surface === "wall" && Math.abs(wall.bounds.toM - 1.8365) < 0.001);
    assert.equal(floorTarget().surface, "floor");
    assert.deepEqual(layoutTarget(null), STUDIO_TARGET);
    const noFloor = sampleReadyRoom("r3", "s1");
    const view = roomView({ ...noFloor, planes: JSON.stringify({ wall: JSON.parse(noFloor.planes!).wall }) });
    assert.equal(layoutTarget(view).roomId, null, "no usable floor: the 3D view stays in the studio");
  });

  it("adds, moves and removes on the wall without overlaps", () => {
    let items: LayoutItemView[] = [];
    const add = applyLayoutOp(items, { op: "add", designId: "a" }, STUDIO_TARGET, sizes);
    assert.equal(add.outcome, "placed");
    assert.deepEqual(add.place, { surface: "wall", alongM: 0 }, "the middle of the wall by default");
    items = add.items;

    const second = applyLayoutOp(items, { op: "add", designId: "b" }, STUDIO_TARGET, sizes);
    assert.equal(second.outcome, "moved_nearby");
    assert.ok(second.place?.surface === "wall" && Math.abs(Math.abs(second.place.alongM) - 1) < 1e-9, "next to a");
    items = second.items;

    const onTop = applyLayoutOp(items, { op: "move", designId: "b", place: { surface: "wall", alongM: 0.2 } }, STUDIO_TARGET, sizes);
    assert.equal(onTop.outcome, "moved_nearby");
    assert.ok(onTop.place?.surface === "wall" && Math.abs(onTop.place.alongM - 1) < 1e-9, "never on top of a");

    const removed = applyLayoutOp(onTop.items, { op: "remove", designId: "a" }, STUDIO_TARGET, sizes);
    assert.deepEqual(removed.items.map((item) => item.designId), ["b"]);
    assert.equal(applyLayoutOp(removed.items, { op: "move", designId: "a", place: { surface: "wall", alongM: 0 } }, STUDIO_TARGET, sizes).outcome, "not_in_layout");
    assert.equal(
      applyLayoutOp(removed.items, { op: "add", designId: "a", place: { surface: "floor", xM: 0, forwardM: 2, rotDeg: 0 } }, STUDIO_TARGET, sizes).outcome,
      "wrong_surface",
    );
  });

  it("holds at most 8 designs and refuses a cabinet the wall cannot take", () => {
    const many = new Map<string, DesignSize>(Array.from({ length: 9 }, (_, i) => [`d${i}`, metre(0.5)]));
    let items: LayoutItemView[] = [];
    for (let i = 0; i < 8; i += 1) items = applyLayoutOp(items, { op: "add", designId: `d${i}` }, STUDIO_TARGET, many).items;
    assert.equal(items.length, 8);
    const ninth = applyLayoutOp(items, { op: "add", designId: "d8" }, STUDIO_TARGET, many);
    assert.equal(ninth.outcome, "layout_full");
    assert.equal(ninth.items.length, 8);

    const wide = new Map([["w", metre(9)]]);
    assert.equal(applyLayoutOp([], { op: "add", designId: "w" }, STUDIO_TARGET, wide).outcome, "no_space");
  });

  it("lines new cabinets up side by side on a floor without a wall", () => {
    const floor = floorTarget();
    const first = applyLayoutOp([], { op: "add", designId: "a" }, floor, sizes);
    const second = applyLayoutOp(first.items, { op: "add", designId: "b" }, floor, sizes);
    assert.ok(first.place?.surface === "floor" && second.place?.surface === "floor");
    assert.ok(Math.abs(second.place.forwardM - first.place.forwardM) < 1e-9, "same row, not behind");
    assert.ok(Math.abs(Math.abs(second.place.xM - first.place.xM) - 1) < 0.051, "beside it (1 m cabinets)");
  });

  it("settles a wider cabinet with the least shift and keeps the order", () => {
    const items = [wallItem("a", -1), wallItem("b", 0), wallItem("c", 1.5)];
    const wider = new Map(sizes).set("b", metre(1.6));
    const settled = settleItems(items, STUDIO_TARGET, wider);
    const centers = settled.map((item) => (item.place?.surface === "wall" ? item.place.alongM : NaN));
    assert.deepEqual(settled.map((item) => item.designId), ["a", "b", "c"]);
    for (let i = 1; i < centers.length; i += 1) {
      const gap = centers[i] - centers[i - 1] - (wider.get(settled[i].designId)!.widthM + wider.get(settled[i - 1].designId)!.widthM) / 2;
      assert.ok(gap >= -1e-9, "no overlap");
    }
    // b grew 0.3 m into each neighbour: b stays, a and c step aside by 0.3 m.
    assert.ok(Math.abs(centers[0] + 1.3) < 1e-9 && centers[1] === 0 && Math.abs(centers[2] - 1.8) < 1e-9, centers.join(","));
  });

  it("grows the studio wall for a set wider than 8 m, never a room wall (ClickUp z8qu5d6gef)", () => {
    const long = new Map<string, DesignSize>([
      ["wardrobe", metre(9.92, 0.64)],
      ["nightstand", metre(0.48, 0.54)],
    ]);
    // The wardrobe was just widened to 9.92 m: on the 8 m studio wall it loses its place.
    const standing: LayoutItemView[] = [
      { designId: "wardrobe", place: { surface: "wall", alongM: 0 } },
      { designId: "nightstand", place: { surface: "wall", alongM: 3 } },
    ];
    const dropped = settleItems(standing, STUDIO_TARGET, long);
    assert.equal(dropped.find((item) => item.designId === "wardrobe")?.place, null);

    const grown = fitStudioTarget(STUDIO_TARGET, long);
    assert.ok(grown.surface === "wall" && grown.bounds.toM - grown.bounds.fromM >= 10.4);
    const settled = settleItems(standing, grown, long);
    assert.ok(settled.every((item) => item.place !== null), "every design stands in the row");
    assert.deepEqual(targetView(grown), { surface: "wall", wall: { fromM: -5.7, toM: 5.7 } });

    // Up to 8 m nothing changes; a real room wall never grows.
    assert.equal(fitStudioTarget(STUDIO_TARGET, sizes), STUDIO_TARGET);
    const roomTarget = { ...STUDIO_TARGET, roomId: "room1" } as LayoutTarget;
    assert.equal(fitStudioTarget(roomTarget, long), roomTarget);
  });

  it("moves a studio layout into the room, the last one out when it does not fit", () => {
    const items = [wallItem("a", -2), wallItem("b", 0), wallItem("c", 2)];
    const settled = settleItems(items, roomTarget(), sizes);
    assert.deepEqual(settled.map((item) => item.designId), ["a", "b", "c"]);
    assert.ok(settled[0].place && settled[1].place, "a and b fit the 3.7 m wall");
    assert.equal(settled[2].place, null, "c (2 m) does not: it waits as a preview");

    const onFloor = settleItems(items.slice(0, 2), floorTarget(), sizes);
    assert.ok(onFloor.every((item) => item.place?.surface === "floor"));
  });

  it("saves versions optimistically and retries a lost race", async () => {
    const { db } = createMemoryRoomDb();
    const first = await changeLayout(db, "s1", STUDIO_TARGET, sizes, { op: "add", designId: "a" });
    assert.equal(first.layout.version, 1);
    const second = await changeLayout(db, "s1", STUDIO_TARGET, sizes, { op: "add", designId: "b" });
    assert.equal(second.layout.version, 2);

    // Another writer saves between our read and our write, once.
    let raced = false;
    const racing = {
      koshoyLayout: {
        ...db.koshoyLayout,
        async updateMany(args: Parameters<typeof db.koshoyLayout.updateMany>[0]) {
          if (!raced) {
            raced = true;
            await db.koshoyLayout.updateMany({
              where: args.where,
              data: { ...args.data, items: JSON.stringify([wallItem("a", -1.5)]) },
            });
          }
          return db.koshoyLayout.updateMany(args);
        },
      },
    };
    const retried = await changeLayout(racing, "s1", STUDIO_TARGET, sizes, { op: "add", designId: "c" });
    assert.equal(retried.layout.version, 4, "saved on top of the other writer's version 3");
    assert.deepEqual(retried.layout.items.map((item) => item.designId), ["a", "c"]);

    const alwaysLosing = {
      koshoyLayout: { ...db.koshoyLayout, updateMany: async () => ({ count: 0 }) },
    };
    await assert.rejects(updateLayout(alwaysLosing, "s1", (current) => current));
    assert.equal((await readLayout(db, "s1")).version, 4);
  });

  it("turns every place_in_room request into a wanted place", () => {
    const target = roomTarget();
    assert.ok(target.surface === "wall" && target.frame);
    const items = [wallItem("a", 0)];
    const ask = (request: Parameters<typeof wantedPlace>[4], designId = "b") =>
      wantedPlace(target, items, sizes, designId, request);

    assert.equal(ask({ at: "free" }).place, undefined, "free: keep or take the default spot");
    assert.deepEqual(ask({ at: "left_of", refDesignId: "a" }).place, { surface: "wall", alongM: -1 });
    assert.deepEqual(ask({ at: "right_of", refDesignId: "a" }).place, { surface: "wall", alongM: 1 });
    assert.equal(ask({ at: "right_of", refDesignId: "c" }).error, "ref_not_placed");

    const atWindow = imageXToAlong(target.frame, target.line, 0.58)!;
    const rightEdge = ask({ at: "photo_x", photoX: 0.58, align: "right_edge" }).place;
    assert.ok(rightEdge?.surface === "wall" && Math.abs(rightEdge.alongM - (atWindow - 0.5)) < 1e-9, "its right edge at the window");
    const leftEdge = ask({ at: "wall_cm", wallCm: 40, align: "left_edge" }).place;
    assert.ok(leftEdge?.surface === "wall" && Math.abs(leftEdge.alongM - (target.bounds.fromM + 0.4 + 0.5)) < 1e-9);
    assert.match(ask({ at: "floor", rotateDeg: 30 }).notes.join(" "), /dönmez/);

    assert.equal(wantedPlace(STUDIO_TARGET, items, sizes, "b", { at: "photo_x", photoX: 0.5 }).error, "no_room");
    assert.deepEqual(wantedPlace(STUDIO_TARGET, items, sizes, "b", { at: "wall_cm", wallCm: 100 }).place, {
      surface: "wall",
      alongM: -4 + 1,
    });

    const floor = floorTarget();
    const turned = wantedPlace(floor, [], sizes, "b", { at: "floor", rotateDeg: 45 }).place;
    assert.ok(turned?.surface === "floor" && turned.rotDeg === 45);
    assert.equal(wantedPlace(floor, [], sizes, "b", { at: "wall_cm", wallCm: 10 }).error, "no_wall");
    const atPhoto = wantedPlace(floor, [], sizes, "b", { at: "photo_x", photoX: 0.2 }).place;
    assert.ok(atPhoto?.surface === "floor" && atPhoto.xM < 0, "left of the photo is left of the camera");
  });

  it("measures the stretch of wall a cabinet stands in", () => {
    const target = roomTarget();
    assert.ok(target.surface === "wall");
    const layout = { version: 1, roomId: "r1", items: [wallItem("a", -1), wallItem("b", 0.6)] };
    const gap = gapAround(layout, target, sizes, "b")!;
    assert.ok(Math.abs(gap - (target.bounds.toM - -0.5)) < 1e-9, "from a's right edge to the wall's end");
  });

  it("treats a side wall as no wall: the room is a floor target without wall measures", () => {
    // The sample room with its wall turned 70° away from the camera.
    const row = sampleReadyRoom("r4", "s1");
    const camera = JSON.parse(row.camera!);
    const planes = JSON.parse(row.planes!);
    planes.wall = { normal: [0.94, 0, -0.342], equation: [0.94, 0, -0.342, 2] };
    const room = { width: 1600, height: 1200, camera, planes, depthScale: { min: 0.8, max: 6.4 } };
    const measures = measureRoom(room, { depth: null, furniture: null, ceiling: null });
    assert.equal(measures.wall, null, "no wall measures for a side wall");
    const view = roomView({ ...row, planes: JSON.stringify(planes), measures: JSON.stringify(measures) });
    assert.equal(view.wall, undefined);
    assert.equal(layoutTarget(view).surface, "floor");

    // A usable wall seen at 60° from far away: its visible stretch is cut to 8 m.
    planes.wall = { normal: [0.866, 0, -0.5], equation: [0.866, 0, -0.5, 6] };
    const far = measureRoom({ ...room, planes }, { depth: null, furniture: null, ceiling: null });
    assert.ok(far.wall && far.wall.toM - far.wall.fromM <= 8 + 1e-9, JSON.stringify(far.wall));
  });

  it("starts floor cabinets where their bases are in the photo (the core's floorRow)", () => {
    const floor = floorTarget();
    assert.ok(floor.surface === "floor");
    const baseInPhoto = (place: LayoutPlaceView | null, size: DesignSize) => {
      assert.ok(place?.surface === "floor");
      for (const dx of [-0.5, 0.5]) {
        for (const df of [-0.5, 0.5]) {
          const p = floorToImage(floor.frame, place.xM + dx * size.widthM, place.forwardM + df * size.depthM);
          assert.ok(p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, JSON.stringify({ place, p }));
        }
      }
    };
    const added = applyLayoutOp([], { op: "add", designId: "a" }, floor, sizes);
    assert.deepEqual(added.place, { surface: "floor", ...floorRow(floor.frame, [sizes.get("a")!])[0], rotDeg: 0 });
    baseInPhoto(added.place, sizes.get("a")!);

    // A wall layout moved to a room without a wall: one row, same order, bases in the photo.
    const fromWall = settleItems([wallItem("c", 1.5), wallItem("a", -1), wallItem("b", 0)], floor, sizes);
    const places = fromWall.map((item) => item.place as Extract<LayoutPlaceView, { surface: "floor" }>);
    assert.deepEqual(fromWall.map((item) => item.designId), ["c", "a", "b"], "items keep their list order");
    assert.ok(places[1].xM < places[2].xM && places[2].xM < places[0].xM, "left to right as on the wall");
    assert.ok(places.every((place) => Math.abs(place.forwardM - places[0].forwardM) < 1e-9), "one row");
    fromWall.forEach((item) => baseInPhoto(item.place, sizes.get(item.designId)!));
  });

  it("puts new designs on empty stretches of wall first (not behind the sofa)", () => {
    const base = roomTarget();
    assert.ok(base.surface === "wall");
    // The sofa stands in front of −0.8 … 0.5 m; the wall is empty left and right of it.
    const target: LayoutTarget = { ...base, free: [{ fromM: -1.8, toM: -0.8 }, { fromM: 0.5, toM: 1.8 }] };
    const sizes96 = new Map([["a", metre(0.96)], ["b", metre(0.96)], ["c", metre(0.96)]]);
    let items: LayoutItemView[] = [];
    const centers: number[] = [];
    for (const id of ["a", "b", "c"]) {
      const added = applyLayoutOp(items, { op: "add", designId: id }, target, sizes96);
      items = added.items;
      centers.push(added.place?.surface === "wall" ? added.place.alongM : NaN);
    }
    assert.ok(Math.abs(centers[0] - 0.98) < 1e-9, "the stretch nearest the middle");
    assert.ok(Math.abs(centers[1] + 1.28) < 1e-9, "then the other stretch");
    assert.equal(centers[2], 0, "both full: the middle, as before");

    // place_in_room at "free": out of the sofa's way, or stays when already in a stretch.
    const behindSofa = [wallItem("a", 0)];
    assert.deepEqual(wantedPlace(target, behindSofa, sizes96, "a", { at: "free" }).place, { surface: "wall", alongM: 0.98 });
    const inStretch = [wallItem("a", 1.2)];
    assert.equal(wantedPlace(target, inStretch, sizes96, "a", { at: "free" }).place, undefined, "stays");
    // A drag is the customer's choice: never moved to a stretch.
    const dragged = applyLayoutOp(behindSofa, { op: "move", designId: "a", place: { surface: "wall", alongM: 0.1 } }, target, sizes96);
    assert.deepEqual(dragged.place, { surface: "wall", alongM: 0.1 });
  });

  it("puts a floor cabinet on the floor point seen at photoX, photoY", () => {
    const floor = floorTarget();
    assert.ok(floor.surface === "floor");
    const near = wantedPlace(floor, [], sizes, "a", { at: "photo_x", photoX: 0.5, photoY: 0.95 }).place;
    const far = wantedPlace(floor, [], sizes, "a", { at: "photo_x", photoX: 0.5, photoY: 0.75 }).place;
    assert.ok(near?.surface === "floor" && far?.surface === "floor");
    assert.ok(near.forwardM < far.forwardM, "lower in the photo is closer");
    assert.ok(Math.abs(near.forwardM - 1.3 / Math.tan(Math.atan((0.45 * 1200) / floor.frame.focalPx))) < 1e-6);
    assert.equal(wantedPlace(floor, [], sizes, "a", { at: "photo_x", photoX: 0.5, photoY: 0.3 }).error, "outside_photo", "above the horizon");
  });

  it("tells the storefront where the layout stands", () => {
    const wall = roomTarget();
    assert.ok(wall.surface === "wall");
    assert.deepEqual(targetView(wall), { surface: "wall", wall: { fromM: wall.bounds.fromM, toM: wall.bounds.toM } });
    assert.deepEqual(targetView(floorTarget()), { surface: "floor" });
    assert.deepEqual(targetView(STUDIO_TARGET), { surface: "wall", wall: { fromM: -4, toM: 4 } });
  });

  it("deletes a session's layout with the session", () => {
    // Checked against SQLite with the migration (cascade on the session id); this guards the schema.
    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    const model = schema.slice(schema.indexOf("model KoshoyLayout"));
    assert.match(model.slice(0, model.indexOf("}")), /@relation\(fields: \[sessionId\], references: \[id\], onDelete: Cascade\)/);
  });

  it("sizes designs from their composition", () => {
    const composition = cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: 1920 }).composition;
    const design: KoshoyDesign = { id: "g", kind: "gardirop", label: "Gardırop 192 cm", version: 1, composition };
    assert.deepEqual(designSizes([design]).get("g"), { widthM: 1.92, depthM: composition.depthMm / 1000 });
  });
});
