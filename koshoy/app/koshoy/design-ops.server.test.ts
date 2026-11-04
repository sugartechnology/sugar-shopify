import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyDesignEdit, type KoshoyDesignDeps } from "./design-ops.server";
import { cabinetEngine } from "./engine";
import { createMemoryKoshoyDb } from "./memory-db";
import { createKoshoyPricer, createMockSkuResolver } from "./pricing.server";
import { createKoshoyStore } from "./store.server";

async function lowKomodin() {
  const store = createKoshoyStore(createMemoryKoshoyDb().db);
  const deps: KoshoyDesignDeps = { store, engine: cabinetEngine, pricer: createKoshoyPricer(cabinetEngine, createMockSkuResolver()) };
  const { session } = await store.createSession("koshoy.myshopify.com");
  const plan = cabinetEngine.planCabinet({ kind: "komodin" });
  const design = await store.createDesign(session.id, { kind: "komodin", label: plan.label, composition: plan.composition });
  assert.equal(design.composition.units[0].hasCrown, true);
  return { deps, sessionId: session.id, design };
}

describe("applyDesignEdit: crown when a body grows tall", () => {
  it("drops it without a room crown choice", async () => {
    const { deps, sessionId, design } = await lowKomodin();
    const result = await applyDesignEdit(deps, sessionId, design, { action: "set_unit_height", unit: 0, heightMm: 1984 });
    assert.ok(result.ok);
    assert.equal(result.design.composition.units[0].hasCrown, undefined);
    assert.deepEqual(result.warnings.includes("crown_removed"), true);
  });

  it("keeps it when the room style says crown on (ClickUp z8qu5d7rdq)", async () => {
    const { deps, sessionId, design } = await lowKomodin();
    const result = await applyDesignEdit(deps, sessionId, design, { action: "set_unit_height", unit: 0, heightMm: 1984 }, "on");
    assert.ok(result.ok);
    assert.equal(result.design.composition.units[0].heightMm, 1984);
    assert.equal(result.design.composition.units[0].hasCrown, true);
    assert.equal(result.warnings.includes("crown_removed"), false);
  });
});

describe("design names survive edits (keson)", () => {
  it("keeps the planned name in the label after a width change", async () => {
    const { designLabel, designName } = await import("./design-ops.server");
    const plan = cabinetEngine.planCabinet({ kind: "komodin", name: "Keson" });
    assert.equal(plan.label, "Keson 48 cm");
    const wider = cabinetEngine.applyEditOp(plan.composition, { action: "set_total_width", widthMm: 960 }, "komodin");
    assert.ok(wider.ok);
    assert.equal(designLabel("komodin", wider.composition, plan.label), "Keson 96 cm");
    assert.equal(designName("komodin", "Komodin 48 cm"), "Komodin");
    assert.equal(designName("komodin", ""), "Komodin");
  });
});
