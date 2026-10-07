import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CABIN_COLOR_IDS,
  CABIN_COLOR_LABELS,
  CABIN_FIT_KINDS,
  createCabinetEngine,
  DESIGN_KINDS,
  getCabinetEngine,
  KOSHOY_MAX_FITTINGS_PER_UNIT,
  KOSHOY_SKU_CONVENTION,
  type CabinComposition,
} from "./engine";

// Contract tests against the vendored core (app/koshoy/cabinet-core).
const engine = getCabinetEngine();

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
    {
      id: "cabin-2",
      widthMm: 960,
      heightMm: 2304,
      fittings: [],
      hasDoor: false,
      color: "wood",
    },
  ],
  depthMm: 640,
  hasPlinth: true,
  color: "wood",
};

describe("koshoy cabinet engine contract", () => {
  it("derives the golden BOM", () => {
    const lines = engine.toBom(GOLDEN).map((line) => ({
      part: line.part,
      widthMm: line.widthMm,
      heightMm: line.heightMm,
      depthMm: line.depthMm,
      qty: line.qty,
    }));
    assert.deepEqual(lines, [
      { part: "GOVDE", widthMm: 960, heightMm: 2304, depthMm: 640, qty: 2 },
      { part: "KAPAK", widthMm: 477, heightMm: 2237, depthMm: 0, qty: 2 },
      { part: "RAF", widthMm: 960, heightMm: 0, depthMm: 640, qty: 1 },
      { part: "ASKI", widthMm: 960, heightMm: 0, depthMm: 0, qty: 1 },
    ]);
  });

  it("maps BOM lines to the placeholder SKU convention", () => {
    assert.deepEqual(engine.toBom(GOLDEN).map((line) => engine.skuFor(line)), [
      "GOVDE-960-2304-640-WOOD",
      "KAPAK-477-2237-WOOD",
      "RAF-960-640-WOOD",
      "ASKI-960",
    ]);
    assert.equal(
      engine.skuFor({
        part: "GOVDE",
        widthMm: 480,
        heightMm: 544,
        depthMm: 480,
        color: "ivory",
        plinth: false,
        qty: 1,
      }),
      "GOVDE-480-544-480-IVORY-BAZASIZ",
    );
  });

  it("keeps the SKU convention swappable in one place", () => {
    const custom = createCabinetEngine({
      ...KOSHOY_SKU_CONVENTION,
      colorCodes: { wood: "MESE", ivory: "BEYAZ", blue: "MAVI" },
    });
    assert.deepEqual(custom.toBom(GOLDEN).map((line) => custom.skuFor(line)), [
      "GOVDE-960-2304-640-MESE",
      "KAPAK-477-2237-MESE",
      "RAF-960-640-MESE",
      "ASKI-960",
    ]);
  });

  it("mirrors the core vocabularies", () => {
    assert.deepEqual([...CABIN_COLOR_IDS], ["wood", "ivory", "blue"]);
    assert.deepEqual(CABIN_COLOR_LABELS, { wood: "Ahşap", ivory: "Kırık beyaz", blue: "Mavi" });
    assert.deepEqual([...CABIN_FIT_KINDS], ["drawer160", "drawer320", "shelf", "hanger"]);
  });

  it("is deterministic and snaps plans to the grid", () => {
    const a = engine.planCabinet({ kind: "gardirop", targetWidthMm: 2000 });
    const b = engine.planCabinet({ kind: "gardirop", targetWidthMm: 2000 });
    assert.deepEqual(a, b);
    assert.deepEqual(
      a.composition.units.map((unit) => unit.widthMm),
      [960, 960],
    );
    assert.deepEqual(a.notes, ["Genişlik 200 cm → 192 cm (96 + 96 cm)"]);
    assert.equal(a.label, "Gardırop 192 cm");
  });

  it("rejects intents that break the rules and applies valid ones", () => {
    const plan = engine.planCabinet({ kind: "gardirop", targetWidthMm: 1920 });
    assert.deepEqual(
      engine.applyEditOp(plan.composition, { action: "add_fitting", unit: 9, kind: "shelf" }),
      { ok: false, reason: "invalid_unit" },
    );
    assert.deepEqual(
      engine.applyEditOp(plan.composition, { action: "set_total_width", widthMm: 6000 }),
      { ok: false, reason: "total_width_exceeded" },
    );
    const tv = engine.planCabinet({ kind: "tv_unitesi" });
    // 544 mm high door unit: a 320 drawer leaves less than 320 mm of door.
    assert.deepEqual(
      engine.applyEditOp(tv.composition, { action: "add_fitting", unit: 0, kind: "drawer320" }),
      { ok: false, reason: "door_too_short" },
    );
    // Off-grid sizes snap to the nearest catalog value instead of failing.
    const snapped = engine.applyEditOp(plan.composition, {
      action: "set_unit_width",
      unit: 0,
      widthMm: 500,
    });
    assert.ok(snapped.ok);
    assert.deepEqual(snapped.composition.units.map((unit) => unit.widthMm), [480, 960]);
    // Plan §8 step 3: a drawer on the right unit of the default gardırop.
    const drawer = engine.applyEditOp(plan.composition, {
      action: "add_fitting",
      unit: 1,
      kind: "drawer160",
    });
    assert.ok(drawer.ok);
    assert.deepEqual(
      drawer.composition.units[1].fittings.map((item) => item.kind),
      ["drawer320", "drawer320", "drawer160", "hanger", "shelf"],
    );
    assert.deepEqual(
      engine.applyEditOp(plan.composition, { action: "set_color", target: "all", color: "wood" }),
      { ok: false, reason: "no_change" },
    );
    const result = engine.applyEditOp(plan.composition, {
      action: "set_color",
      target: "all",
      color: "blue",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.composition.units.every((unit) => unit.color === "blue"));
      assert.equal(plan.composition.units[0].color, "wood", "input is not mutated");
    }
  });

  it("caps fittings per unit so the scene can carry every billed part", () => {
    for (const kind of DESIGN_KINDS) {
      for (const level of ["ekonomik", "dengeli", "premium"] as const) {
        for (const targetWidthMm of [undefined, 400, 2000, 5000]) {
          const { composition } = engine.planCabinet({ kind, level, targetWidthMm });
          for (const unit of composition.units) {
            assert.ok(unit.fittings.length <= KOSHOY_MAX_FITTINGS_PER_UNIT, `${kind} ${level}`);
          }
        }
      }
    }
    // The core alone would take ~115 shelves in a kitaplık unit.
    let composition = engine.planCabinet({ kind: "kitaplik" }).composition;
    let added = 0;
    for (let i = 0; i < 40; i += 1) {
      const result = engine.applyEditOp(composition, { action: "add_fitting", unit: 0, kind: "shelf" });
      if (!result.ok) {
        assert.equal(result.reason, "no_room");
        break;
      }
      composition = result.composition;
      added += 1;
    }
    assert.equal(composition.units[0].fittings.length, KOSHOY_MAX_FITTINGS_PER_UNIT);
    assert.ok(added > 0 && added < 40);
  });
});
