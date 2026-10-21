import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GreyImage } from "./png.server";
import {
  fitFor,
  measureBand,
  measureRoom,
  roomFactsForModel,
  roundedCm,
  TIGHT_FIT_SENTENCE,
} from "./room-measure.server";
import { checkReply, KOSHOY_SAFE_TOPIC_REPLY, roomNumbersIn } from "./rules";
import type { RoomCamera, RoomPlanes } from "./room.server";

/**
 * A synthetic room seen by a level camera 1.3 m above the floor: the wall
 * 3.1 m ahead (its foot at v ≈ 1181), a closer side wall on the left
 * (u < 400), an opening to a farther room on the right (u ≥ 1200), a low
 * cabinet in front of the wall (800 ≤ u < 1000) and a ceiling 2.6 m above
 * the floor (v < 100).
 * Masks and depth are 400×300 for a 1600×1200 photo (lookups scale).
 */
const FX = 1385.6;
const CAMERA: RoomCamera = {
  fovXDegrees: (2 * Math.atan(800 / FX) * 180) / Math.PI,
  fovYDegrees: (2 * Math.atan(600 / FX) * 180) / Math.PI,
  aspect: 4 / 3,
  fx: FX,
  fy: FX,
  cx: 800,
  cy: 600,
};
const PLANES: RoomPlanes = {
  floor: { normal: [0, -1, 0], equation: [0, -1, 0, 1.3] },
  wall: { normal: [0, 0, -1], equation: [0, 0, -1, 3.1] },
};
const DEPTH_SCALE = { min: 0.8, max: 6.4 };
const FOOT_V = 600 + (FX * 1.3) / 3.1;

function image(paint: (u: number, v: number) => number): GreyImage {
  const width = 400;
  const height = 300;
  const values = new Uint16Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      values[row * width + column] = paint((column + 0.5) * 4, (row + 0.5) * 4);
    }
  }
  return { width, height, values };
}

const toDepth = (z: number) => Math.round(((z - DEPTH_SCALE.min) / (DEPTH_SCALE.max - DEPTH_SCALE.min)) * 65535);
const IMAGES = {
  depth: image((u, v) => {
    if (v < 100) return toDepth((FX * 1.3) / (600 - v)); // ceiling, 1.3 m above the camera
    if (v < FOOT_V) return toDepth(u < 400 ? 1.5 : u >= 1200 ? 5 : 3.1); // side wall closer, opening farther
    return toDepth(2);
  }),
  furniture: image((u, v) => (u >= 800 && u < 1000 && v >= 900 && v < FOOT_V ? 255 : 0)),
  ceiling: image((_u, v) => (v < 100 ? 255 : 0)),
};
const ROOM = { width: 1600, height: 1200, camera: CAMERA, planes: PLANES, depthScale: DEPTH_SCALE };
const alongAt = (u: number) => ((u - 800) / FX) * 3.1;

function near(actual: number, expected: number, tolerance: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} ≉ ${expected}`);
}

describe("koshoy room measurements", () => {
  it("trims the visible wall to this wall and finds the free stretches", () => {
    const measures = measureRoom(ROOM, IMAGES);
    const step = (2 * alongAt(1600)) / 64;
    assert.ok(measures.wall);
    near(measures.wall.fromM, alongAt(400), step, "side wall cut off");
    near(measures.wall.toM, alongAt(1200), step, "opening cut off");
    assert.equal(measures.free.length, 2);
    near(measures.free[0].fromM, alongAt(400), step);
    near(measures.free[0].toM, alongAt(800), step, "up to the cabinet in front");
    near(measures.free[1].fromM, alongAt(1000), step, "after it");
    near(measures.free[1].toM, alongAt(1200), step);
    near(measures.ceilingM ?? 0, 2.6, 0.01, "ceiling");
    assert.equal(measures.cameraHeightM, 1.3);
    assert.equal(measures.wallDistanceM, 3.1);
  });

  it("keeps the geometric wall when the masks cannot be read", () => {
    const measures = measureRoom(ROOM, { depth: null, furniture: null, ceiling: null });
    assert.ok(measures.wall);
    near(measures.wall.fromM, alongAt(0), 1e-9);
    near(measures.wall.toM, alongAt(1600), 1e-9);
    assert.deepEqual(measures.free, []);
    assert.equal(measures.ceilingM, null);
    const noCeiling = measureRoom(ROOM, { ...IMAGES, ceiling: image(() => 0) });
    assert.equal(noCeiling.ceilingM, null, "too little ceiling in the photo");
  });

  it("uses a band by scale source, rounds to 10 cm and judges the fit", () => {
    assert.equal(measureBand("exif"), 0.1);
    assert.equal(measureBand("user"), 0.1);
    assert.equal(measureBand("hand_height"), 0.2);
    assert.equal(measureBand("phone_26mm"), 0.25);
    assert.equal(roundedCm(3.36), 340);
    assert.equal(roundedCm(1.92), 190);
    assert.equal(fitFor(3.4, 1.92, 0.1), "rahat");
    assert.equal(fitFor(2.0, 1.92, 0.1), "sınırda", "8 cm margin, ±20 cm band");
    assert.equal(fitFor(1.8, 1.92, 0.1), "sınırda", "12 cm short, ±18 cm band: uncertain too");
    assert.equal(fitFor(1.5, 1.92, 0.1), "sığmaz");
  });

  it("tells the model rounded, approximate facts only", () => {
    const measures = measureRoom(ROOM, IMAGES);
    const facts = roomFactsForModel(measures, "hand_height", [
      { id: "d1", label: "Komodin 48 cm", widthM: 0.48 },
      { id: "d2", label: "Gardırop 144 cm", widthM: 1.44 },
      { id: "d3", label: "Gardırop 240 cm", widthM: 2.4 },
    ]);
    assert.equal(facts.uncertaintyPercent, 20);
    assert.equal(facts.visibleWallCm, 180);
    assert.equal(facts.visibleWallM, 1.8);
    assert.deepEqual(
      (facts.designs as Array<{ visibleWall: string }>).map((design) => design.visibleWall),
      ["rahat", "sınırda", "sığmaz"],
    );
    for (const stretch of facts.freeStretches as Array<Record<string, number>>) {
      for (const key of ["fromCm", "toCm", "widthCm"]) assert.equal(stretch[key] % 10, 0, key);
    }
    assert.equal(facts.ceilingCm, 260);
    assert.ok(!JSON.stringify(facts).match(/\d\.\d{2,}/), "no unrounded metres");
  });

  it("lets room sizes through only as 'yaklaşık', from the room and in its unit", () => {
    const room = roomNumbersIn(
      {
        uncertaintyPercent: 20,
        visibleWallCm: 340,
        visibleWallM: 3.4,
        maxDesigns: 8,
        designs: [{ designId: "d1", label: "Gardırop 240 cm", visibleWall: "rahat" }],
      },
      { cm: new Set<string>(), m: new Set<string>() },
    );
    assert.deepEqual([[...room.cm], [...room.m]], [["340"], ["3.4"]], "room lengths only, by unit");
    const design = [{ widthCm: 240 }];
    const check = (text: string) => checkReply(text, design, undefined, room);

    const fine = "Duvar yaklaşık 3,4 m görünüyor; dolabın 240 cm, rahatça sığar.";
    assert.equal(check(fine).text, fine);
    assert.equal(check("Duvar yaklaşık 340 cm.").text, "Duvar yaklaşık 340 cm.");
    assert.equal(check(TIGHT_FIT_SENTENCE).text, TIGHT_FIT_SENTENCE);

    const designAsWall = check("Duvarının genişliği 240 cm.");
    assert.equal(designAsWall.text, KOSHOY_SAFE_TOPIC_REPLY, "a design size is not a room size");
    assert.deepEqual(designAsWall.issues, ["topic"]);
    assert.deepEqual(check("Duvar yaklaşık 8 metre.").issues, ["number"], "a count is not a length");
    assert.deepEqual(check("Duvar yaklaşık 340 m.").issues, ["number"], "340 is centimetres");
    assert.deepEqual(check("Duvar 340 cm.").issues, ["number"], "without yaklaşık");
    assert.deepEqual(check("Odan kaç metrekare?").issues, ["topic"]);

    // No ready room: the rules from before the room photo, unchanged.
    assert.equal(checkReply("Duvarın genişliği yaklaşık 3,4 m.", design).text, KOSHOY_SAFE_TOPIC_REPLY);
    assert.deepEqual(checkReply("Duvar yaklaşık 3,4 m görünüyor.", design).issues, ["number"]);
  });
});
