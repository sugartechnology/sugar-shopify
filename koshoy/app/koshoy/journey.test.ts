import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { draftRoomSize, emptyJourney, journeyStage, SKIPPED_ROOM, type JourneyDesign } from "./journey";

const design = { id: "d1", kind: "gardirop", label: "Gardırop", version: 1 } as unknown as JourneyDesign;

describe("koshoy journey order (ClickUp z8qu5daa0c)", () => {
  it("asks room, structure and style before any product is built", () => {
    const journey = emptyJourney();
    const input = { room: "", designs: [] as JourneyDesign[], hasRoomPhoto: false, missingStyle: ["panel" as const] };
    assert.equal(journeyStage(journey, input), "room_what");
    assert.equal(journeyStage(journey, { ...input, room: "Yatak odası" }), "room_structure");
    journey.structure = "skip";
    assert.equal(journeyStage(journey, { ...input, room: "Yatak odası" }), "room_style");
    assert.equal(journeyStage(journey, { ...input, room: "Yatak odası", missingStyle: [] }), "room_build");
    assert.equal(
      journeyStage(journey, { ...input, room: "Yatak odası", missingStyle: [], designs: [design] }),
      "room_approval",
    );
  });

  it("a room photo stands for the structure", () => {
    const stage = journeyStage(emptyJourney(), { room: "Salon", designs: [], hasRoomPhoto: true, missingStyle: [] });
    assert.equal(stage, "room_build");
  });

  it("keeps the one-product buyer's fast path: product first", () => {
    const journey = { ...emptyJourney(), kind: "single" as const };
    const input = { room: "", designs: [] as JourneyDesign[], hasRoomPhoto: false, missingStyle: [] };
    assert.equal(journeyStage(journey, input), "room_what");
    assert.equal(journeyStage(journey, { ...input, designs: [design] }), "room_structure");
  });
});

describe("koshoy draft room size", () => {
  it("is the rough measure, the default room when skipped, none before", () => {
    const journey = emptyJourney();
    assert.equal(draftRoomSize(journey), null);
    journey.structure = "skip";
    assert.deepEqual(draftRoomSize(journey), { ...SKIPPED_ROOM });
    journey.structure = "measure";
    journey.measure = { wallCm: 520, ceilingCm: null };
    assert.deepEqual(draftRoomSize(journey), { wallCm: 520, ceilingCm: 260 });
    journey.measure = { wallCm: 300, ceilingCm: 90 };
    assert.deepEqual(draftRoomSize(journey), { wallCm: 300, ceilingCm: 220 }, "a believable ceiling");
    journey.structure = "photo";
    assert.equal(draftRoomSize(journey), null);
  });
});

describe("koshoy draft room target", () => {
  it("passes the draft room to the storefront only with a believable ceiling", async () => {
    const { toLayoutTarget } = await import("./events");
    const wall = { fromM: -2, toM: 2 };
    assert.deepEqual(toLayoutTarget({ surface: "wall", wall, draft: { ceilingM: 2.6 } }), {
      surface: "wall",
      wall,
      draft: { ceilingM: 2.6 },
    });
    assert.deepEqual(toLayoutTarget({ surface: "wall", wall, draft: { ceilingM: 40 } }), { surface: "wall", wall });
  });
});
