import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicEvents, sseFrame, toPublicEvent } from "./events";

describe("koshoy public event whitelist", () => {
  it("rebuilds a scene with only contract fields", () => {
    const event = toPublicEvent({
      type: "scene",
      designId: "Ab3_x-9",
      version: 2,
      kind: "gardirop",
      label: "Gardırop 192 cm",
      sku: "GOVDE-960-2304-640-WOOD",
      catalogId: "5f1c7f0e-uuid",
      view: {
        units: [
          {
            id: "cabin-1",
            widthMm: 960,
            heightMm: 2304,
            fittings: [{ id: "fit-1", kind: "shelf", open: true, gridY: 3, color: "ivory" }],
            hasDoor: true,
            doorOpen: true,
            catalogUuid: "x",
            color: "wood",
          },
        ],
        depthMm: 640,
        hasPlinth: true,
        color: "wood",
        widestUnits: [{ id: "cabin-1" }],
        gridMm: 160,
      },
    });
    assert.deepEqual(event, {
      type: "scene",
      designId: "Ab3_x-9",
      version: 2,
      kind: "gardirop",
      label: "Gardırop 192 cm",
      view: {
        units: [
          {
            id: "cabin-1",
            widthMm: 960,
            heightMm: 2304,
            fittings: [{ id: "fit-1", kind: "shelf", color: "ivory" }],
            hasDoor: true,
            color: "wood",
          },
        ],
        depthMm: 640,
        hasPlinth: true,
        color: "wood",
      },
    });
  });

  it("never cuts fittings: a unit over the cap yields no scene at all", () => {
    const unit = (count: number) => ({
      id: "cabin-1",
      widthMm: 960,
      heightMm: 1984,
      fittings: Array.from({ length: count }, (_, i) => ({ id: `fit-${i + 1}`, kind: "shelf" })),
      hasDoor: false,
    });
    const scene = (count: number) =>
      toPublicEvent({
        type: "scene",
        designId: "d1",
        version: 1,
        kind: "kitaplik",
        label: "Kitaplık 96 cm",
        view: { units: [unit(count)], depthMm: 320, hasPlinth: true },
      });
    const full = scene(16);
    assert.ok(full?.type === "scene");
    assert.equal(full.view.units[0].fittings.length, 16);
    assert.equal(scene(17), null);
  });

  it("rejects event types outside the contract", () => {
    for (const type of ["thinking", "products", "cart", "tool_call", "render", "debug"]) {
      assert.equal(toPublicEvent({ type, text: "x" }), null, type);
    }
    assert.equal(toPublicEvent({ type: "status", key: "plan_cabinet" }), null);
    assert.equal(toPublicEvent({ type: "scene", designId: "a", version: 1, kind: "koltuk", label: "x", view: {} }), null);
  });

  it("never forwards upstream error details", () => {
    assert.deepEqual(
      toPublicEvent({ type: "error", code: "upstream_502", message: "OpenAI quota exceeded" }),
      { type: "error", code: "unavailable" },
    );
    assert.deepEqual(toPublicEvent({ type: "error", code: "rate_limited", stack: "at x" }), {
      type: "error",
      code: "rate_limited",
    });
  });

  it("accepts only display prices", () => {
    const price = (display: unknown) =>
      toPublicEvent({ type: "price", designId: "d1", version: 1, display });
    assert.ok(price("15.958,14 TL"));
    assert.ok(price("396,00 TL"));
    assert.ok(price("[FİYAT]"));
    assert.equal(price("15958.14"), null);
    assert.equal(price("GOVDE-960 6.425,00 TL"), null);
    assert.equal(price(1595814), null);
  });

  it("cleans choices and designs", () => {
    assert.deepEqual(
      toPublicEvent({
        type: "choice",
        question: "Renk?",
        callId: "call_1",
        options: [
          { id: "wood", label: "Ahşap", sku: "x" },
          { id: "bad id!", label: "Nope" },
          { id: "blue", label: "" },
        ],
      }),
      { type: "choice", question: "Renk?", options: [{ id: "wood", label: "Ahşap" }] },
    );
    assert.deepEqual(
      toPublicEvent({
        type: "designs",
        items: [
          { designId: "d1", label: "Gardırop", kind: "gardirop", active: true, sessionId: "s" },
          { designId: "d2", label: "Koltuk", kind: "koltuk", active: false },
        ],
      }),
      { type: "designs", items: [{ designId: "d1", label: "Gardırop", kind: "gardirop", active: true }] },
    );
  });

  it("frames SSE events", () => {
    const [event] = publicEvents([{ type: "text", text: "Merhaba", model: "x" }]);
    assert.equal(sseFrame(event), 'event: text\ndata: {"type":"text","text":"Merhaba"}\n\n');
    assert.equal(sseFrame({ type: "done" }), 'event: done\ndata: {"type":"done"}\n\n');
  });
});
