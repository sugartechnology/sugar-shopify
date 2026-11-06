import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KOSHOY_DATA_DEFAULTS } from "./data.server";
import type { KoshoyDesignDeps } from "./design-ops.server";
import { cabinetEngine } from "./engine";
import { styleChoices } from "./journey.server";
import { createMemoryKoshoyDb } from "./memory-db";
import { createKoshoyPricer, createMockSkuResolver, formatTl } from "./pricing.server";
import { DEFAULT_COLOR_LOOKS, koshoyColors, toKoshoyColors, useKoshoyColors } from "./shop-colors";
import { createKoshoyStore } from "./store.server";

describe("styleChoices: handle options (ClickUp z8qu5d7rdr)", () => {
  it("show the picture and the room total with that handle", async () => {
    const before = koshoyColors();
    try {
      useKoshoyColors(
        toKoshoyColors(DEFAULT_COLOR_LOOKS, { body: new Set(["LAKE BEYAZ"]), handles: new Set(["SİYAH", "BEYAZ"]) }),
      );
      const store = createKoshoyStore(createMemoryKoshoyDb().db);
      const pricer = createKoshoyPricer(cabinetEngine, createMockSkuResolver([
        { pattern: "*SİYAH*", price: "150.00" },
        { pattern: "*", price: "100.00" },
      ]));
      const deps: KoshoyDesignDeps = { store, engine: cabinetEngine, pricer };
      const { session } = await store.createSession("koshoy.myshopify.com");
      const plan = cabinetEngine.planCabinet({ kind: "komodin" });
      const design = await store.createDesign(session.id, { kind: "komodin", label: plan.label, composition: plan.composition });
      const url = "https://image-s3.sm.mncdn.com/cdn.sugartech/mottobucket/koshoy/tercih/handle_siyah.jpg";
      const data = { ...KOSHOY_DATA_DEFAULTS, images: [{ kind: "*" as const, option: "handle_siyah", url }] };
      const handles = { handles: [{ id: "siyah", label: "Siyah" }, { id: "beyaz", label: "Beyaz" }] };

      const choice = await styleChoices(deps, [design], data, "handle", handles);

      assert.deepEqual(choice.options.map((option) => option.value), ["style:handle:siyah", "style:handle:beyaz"]);
      assert.equal(choice.options[0].image, url);
      assert.equal(choice.options[1].image, undefined);
      for (const [index, id] of ["siyah", "beyaz"].entries()) {
        const edited = cabinetEngine.applyEditOp(design.composition, { action: "set_handle", color: id }, "komodin");
        assert.ok(edited.ok);
        const quote = await pricer.quote(edited.composition);
        assert.ok(quote.totalCents !== null);
        assert.equal(choice.options[index].price, formatTl(quote.totalCents));
      }
      assert.notEqual(choice.options[0].price, choice.options[1].price, "each option is priced with its own handle");
    } finally {
      useKoshoyColors(before);
    }
  });
});
