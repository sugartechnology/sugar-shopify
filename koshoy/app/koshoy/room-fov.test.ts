import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fovFromHandHeight,
  fovFromPhone,
  fxForFov,
  guessNoExifFov,
  HAND_HEIGHT_M,
  planeForFx,
} from "./room-fov";
import { parseRoomAnalysis, type RoomCamera, type Vector4 } from "./room.server";

/**
 * Sample rooms of the no-EXIF report (_ciktilar/oda-analizi-3d-koshoy/raporlar/
 * 2026-10-21-exifsiz-olcek.md), analysed at the 45° default. Expected angles
 * come from its Python script (configs.py).
 */
const SALON = {
  width: 940,
  height: 564,
  floor: [-0.019314593234680055, -0.9989977506863833, -0.0403787148349931, 0.846192780012896] as Vector4,
  wall: [0.0038980449892811963, 0.058267000373582234, -0.998293424756833, 5.1614725154990975] as Vector4,
};
const SQUARE_FLOORS: Record<string, { floor: Vector4; hand: number }> = {
  "03-siesta4": { floor: [0.013360517993116692, -0.9993163032518624, -0.034473505971797595, 1.2940804377136776], hand: 48.28 },
  "04-siesta13": { floor: [0.002218527257963071, -0.999528169052722, -0.03063523146507981, 1.038953067281197], hand: 58.355 },
  "06-siesta16": { floor: [-0.021222254570070206, -0.9957509951588069, -0.08960787661365906, 1.4210499706186823], hand: 44.394 },
  "09-siesta14": { floor: [0.027092727536837984, -0.9991368891256474, -0.031487472158600184, 0.9733050004708595], hand: 61.6 },
};
/** A table top taken for the floor, above the camera (10-mutfak / VOC 2008_003904). */
const TABLE_AS_FLOOR: Vector4 = [0.0031942902375846232, -0.897232228510762, 0.4415474205920467, -0.045313830576335645];

function camera45(width: number, height: number): RoomCamera {
  const fx = fxForFov(width, 45);
  return {
    fovXDegrees: 45,
    fovYDegrees: (2 * Math.atan(height / 2 / fx) * 180) / Math.PI,
    aspect: width / height,
    fx,
    fy: fx,
    cx: width / 2,
    cy: height / 2,
  };
}

function near(actual: number, expected: number, tolerance: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} ≉ ${expected}`);
}

describe("koshoy no-EXIF field of view", () => {
  it("puts the hand-held camera at 1.4 m: 01-salon ≈ 68.9°", () => {
    const camera = camera45(SALON.width, SALON.height);
    near(fovFromHandHeight(SALON.floor, camera.fx, SALON.width) ?? 0, 68.922, 0.01);

    const guessed = guessNoExifFov({
      width: SALON.width,
      height: SALON.height,
      camera,
      planes: {
        floor: { normal: [SALON.floor[0], SALON.floor[1], SALON.floor[2]], equation: SALON.floor },
        wall: { normal: [SALON.wall[0], SALON.wall[1], SALON.wall[2]], equation: SALON.wall },
      },
    });
    assert.equal(guessed.guess, "hand_height");
    near(guessed.camera.fovXDegrees, 68.922, 0.01);
    near(guessed.camera.fx, 684.85, 0.05);
    assert.equal(guessed.camera.fy, guessed.camera.fx);
    near(guessed.camera.fovYDegrees, 44.76, 0.01);
    assert.equal(guessed.camera.cx, camera.cx, "principal point and aspect stay");
    assert.equal(guessed.camera.aspect, camera.aspect);

    const floor = guessed.planes.floor!.equation;
    near(floor[3], HAND_HEIGHT_M, 1e-9, "camera height");
    near(floor[1], -0.99758, 1e-5);
    near(floor[2], -0.0668052, 1e-6);
    assert.deepEqual(guessed.planes.floor!.normal, floor.slice(0, 3));
    const wall = guessed.planes.wall!.equation;
    near(wall[3], 5.16708, 1e-5, "wall converted with the same formula");
    near(Math.hypot(wall[0], wall[1], wall[2]), 1, 1e-12);
  });

  it("keeps the 1.4 m angle only inside 50°–80°, otherwise assumes a 26 mm phone camera", () => {
    const camera = camera45(1024, 1024);
    for (const [id, { floor, hand }] of Object.entries(SQUARE_FLOORS)) {
      near(fovFromHandHeight(floor, camera.fx, 1024) ?? 0, hand, 0.01, id);
      const guessed = guessNoExifFov({
        width: 1024,
        height: 1024,
        camera,
        planes: { floor: { normal: [floor[0], floor[1], floor[2]], equation: floor } },
      });
      const inRange = hand >= 50 && hand <= 80;
      assert.equal(guessed.guess, inRange ? "hand_height" : "phone_26mm", id);
      near(guessed.camera.fovXDegrees, inRange ? hand : 60.941, 0.01, id);
    }
  });

  it("falls back to the phone angle without a usable floor", () => {
    const camera = camera45(SALON.width, SALON.height);
    const noFloor = guessNoExifFov({ width: SALON.width, height: SALON.height, camera, planes: {} });
    assert.equal(noFloor.guess, "phone_26mm");
    near(noFloor.camera.fovXDegrees, 71.014, 0.01);

    const tableTop = guessNoExifFov({
      width: 375,
      height: 500,
      camera: camera45(375, 500),
      planes: { floor: { normal: [TABLE_AS_FLOOR[0], TABLE_AS_FLOOR[1], TABLE_AS_FLOOR[2]], equation: TABLE_AS_FLOOR } },
    });
    assert.equal(tableTop.guess, "phone_26mm", "a floor above the camera is not used");
    assert.equal(fovFromHandHeight([0, -0.1, 0.99, 0.5], 1000, 1000), null, "no angle reaches 1.4 m");
  });

  it("derives the phone angle from the photo's own size", () => {
    near(fovFromPhone(500, 375), 67.299, 0.01, "landscape 4:3");
    near(fovFromPhone(375, 500), 53.06, 0.01, "portrait 3:4");
    near(fovFromPhone(1024, 1024), 60.941, 0.01, "square");
  });

  it("converts planes exactly both ways", () => {
    const there = planeForFx(SALON.wall, 1134.68, 684.85);
    const back = planeForFx(there, 684.85, 1134.68);
    SALON.wall.forEach((value, index) => near(back[index], value, 1e-12));
  });

  it("changes only analyses that used the 45° default", () => {
    const camera = camera45(SALON.width, SALON.height);
    const result = (fovSource: string) => ({
      width: SALON.width,
      height: SALON.height,
      camera: { ...camera, fovSource, axes: "x right, y down, z forward" },
      depth: "https://x/depth.png",
      depthScale: { min: 0.5, max: 8 },
      planes: { floor: { normal: SALON.floor.slice(0, 3), equation: SALON.floor, inlierRatio: 0.9 } },
      masks: {},
    });

    for (const source of ["exif", "user"]) {
      const parsed = parseRoomAnalysis(result(source));
      assert.equal(parsed?.scaleSource, source, "the analysis' own angle stays");
      assert.equal(parsed?.camera.fovXDegrees, 45, source);
      assert.deepEqual(parsed?.planes.floor?.equation, SALON.floor, source);
    }
    const guessed = parseRoomAnalysis(result("default"));
    assert.equal(guessed?.scaleSource, "hand_height");
    near(guessed?.camera.fovXDegrees ?? 0, 68.922, 0.01);
    near(guessed?.planes.floor?.equation[3] ?? 0, HAND_HEIGHT_M, 1e-9);
    assert.deepEqual(guessed?.depthScale, { min: 0.5, max: 8 }, "depth does not depend on the angle");
  });
});
