import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClientInput, parseDesignImage, parseDesignRef, parseEditOp } from "./input";

describe("koshoy client input", () => {
  it("accepts only the three ClientInput types", () => {
    assert.deepEqual(parseClientInput({ type: "message", text: " 2 metre dolap " }), {
      type: "message",
      text: "2 metre dolap",
    });
    assert.deepEqual(parseClientInput({ type: "choice", selected: "wood", label: "Ahşap" }), {
      type: "choice",
      selected: "wood",
      label: "Ahşap",
    });
    assert.deepEqual(
      parseClientInput({ type: "add_cart_result", ok: false, error: "422 <script>" }),
      { type: "add_cart_result", ok: false, error: "422script" },
    );
    assert.equal(parseClientInput({ type: "scene_change", op: {} }), null);
    assert.equal(parseClientInput({ type: "message", text: "" }), null);
    assert.equal(parseClientInput({ type: "message", text: "x".repeat(2001) }), null);
    assert.equal(parseClientInput({ type: "add_cart_result" }), null);
  });

  it("validates EditOp shapes", () => {
    assert.deepEqual(parseEditOp({ action: "add_fitting", unit: 1, kind: "drawer160" }), {
      action: "add_fitting",
      unit: 1,
      kind: "drawer160",
    });
    assert.deepEqual(parseEditOp('{"action":"set_depth","depthMm":480}'), {
      action: "set_depth",
      depthMm: 480,
    });
    assert.deepEqual(parseEditOp({ action: "set_color", target: "all", color: "blue", unit: null }), {
      action: "set_color",
      target: "all",
      color: "blue",
    });
    assert.equal(parseEditOp({ action: "set_color", target: "unit", color: "blue" }), null);
    assert.equal(parseEditOp({ action: "add_fitting", unit: -1, kind: "shelf" }), null);
    assert.equal(parseEditOp({ action: "add_fitting", unit: 0, kind: "sofa" }), null);
    assert.equal(parseEditOp({ action: "set_door", unit: 0, hasDoor: "yes" }), null);
    assert.equal(parseEditOp({ action: "delete_everything" }), null);
  });

  it("validates design references", () => {
    assert.deepEqual(parseDesignRef({ designId: "Ab_9", version: 3 }), { designId: "Ab_9", version: 3 });
    assert.equal(parseDesignRef({ designId: "../x", version: 1 }), null);
    assert.equal(parseDesignRef({ designId: "a", version: 0 }), null);
  });
});

describe("parseDesignImage", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
  it("accepts a small JPEG data URL only", () => {
    assert.deepEqual([...(parseDesignImage({ image: `data:image/jpeg;base64,${jpeg}` }) ?? [])].slice(0, 3), [0xff, 0xd8, 0xff]);
    assert.equal(parseDesignImage({ image: `data:image/png;base64,${jpeg}` }), null);
    assert.equal(parseDesignImage({ image: `data:image/jpeg;base64,${Buffer.from("<svg/>").toString("base64")}` }), null);
    assert.equal(parseDesignImage({ image: "data:image/jpeg;base64,!!!" }), null);
    assert.equal(parseDesignImage({ image: `data:image/jpeg;base64,${"A".repeat(2_100_000)}` }), null);
    assert.equal(parseDesignImage({}), null);
  });
});
