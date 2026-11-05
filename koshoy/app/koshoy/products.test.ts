import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import { cabinetEngine } from "./engine";
import { findProduct, fitUnitWidths, productOfDesign, productOrFallback } from "./products";

const widths = (composition: { units: ReadonlyArray<{ widthMm: number }> }) => composition.units.map((unit) => unit.widthMm);

describe("koshoy products from the data (ClickUp z8qu5d3qan)", () => {
  it("fills a total with the widest allowed body first (Akın, 31 Oct)", () => {
    const plan = cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: 1920 });
    assert.deepEqual(widths(plan.composition), [960, 960]);
    for (const [total, expected] of [
      [1920, [640, 640, 640]],
      [1600, [640, 640, 320]],
      [2240, [640, 640, 640, 320]],
    ] as const) {
      const planned = cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: total });
      assert.deepEqual(widths(fitUnitWidths(planned.composition, [320, 480, 640])), expected, String(total));
    }
  });

  it("keeps a design whose bodies are all allowed, and splits only the wrong body of a mixed one", () => {
    const plan = cabinetEngine.planCabinet({ kind: "gardirop", targetWidthMm: 1920 });
    assert.equal(fitUnitWidths(plan.composition, [320, 480, 960]), plan.composition);
    const mixed = cabinetEngine.planCabinet({ kind: "tv_unitesi", level: "dengeli", targetWidthMm: 1920 }).composition;
    assert.deepEqual(widths(mixed), [960, 960]);
    const fitted = fitUnitWidths(mixed, [320, 480, 640]);
    assert.deepEqual(widths(fitted), [640, 320, 640, 320]);
    assert.equal(fitted.units[0].hasDoor, true);
    assert.equal(fitted.units[2].hasDoor, false, "each part keeps the interior of its own body");
    assert.equal(new Set(fitted.units.map((unit) => unit.id)).size, 4);
  });

  it("finds the row of a design; old designs and deleted products still open", () => {
    const data = KOSHOY_DATA_DEFAULTS;
    assert.equal(productOfDesign(data, { kind: "komodin", product: "keson" }).label, "Keson");
    assert.equal(productOfDesign(data, { kind: "kitaplik" }).kind, "kitaplik", "saved before product ids");
    assert.deepEqual(productOfDesign(data, { kind: "kitaplik", product: "silinen" }).unitWidthsMm, [320, 480, 640]);
    assert.deepEqual(productOfDesign({ kinds: [] }, { kind: "kitaplik" }).unitWidthsMm, [320, 480, 640], "core rule without data");
    assert.equal(findProduct(data, "yok"), null);
    assert.equal(productOrFallback(data, "silinen").label, "Dolap");
  });
});
