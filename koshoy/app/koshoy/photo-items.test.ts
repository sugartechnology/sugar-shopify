import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTACHED_CLASSES,
  buildPhotoItems,
  MAX_PHOTO_ITEMS,
  parseAnalysisObjects,
  parseStoredPhotoItems,
  PHOTO_ITEM_LABELS,
  photoItemsForModel,
  photoItemsFromAnalysis,
  ROOM_CLASSES,
  toPhotoItemView,
  type AnalysisObject,
  type Box,
} from "./photo-items";

/** One analysis part; `touches` lists the parts it touches. */
const part = (id: number, className: string, box: Box, area: number, touches: number[] = []): AnalysisObject => ({
  id,
  className,
  box,
  area,
  touches,
});

describe("koshoy photo items (removable furniture of the room photo)", () => {
  it("names only furniture: the room itself and small things never get a label", () => {
    for (const name of ROOM_CLASSES) assert.equal(PHOTO_ITEM_LABELS[name], undefined, name);
    for (const name of ATTACHED_CLASSES) assert.equal(PHOTO_ITEM_LABELS[name], undefined, name);
    assert.equal(PHOTO_ITEM_LABELS.sofa, "Koltuk");
    assert.equal(PHOTO_ITEM_LABELS["chest of drawers"], "Şifonyer");
    assert.equal(PHOTO_ITEM_LABELS.curtain, "Perde", "curtains are listed (Fatih, 28 Ekim)");
  });

  it("lists furniture largest first, with the small things lying on it as its parts", () => {
    const items = buildPhotoItems([
      part(1, "wall", [0, 0, 1, 0.6], 0.4),
      part(2, "sofa", [0.1, 0.35, 0.6, 0.65], 0.12, [5, 6, 9]),
      part(3, "rug", [0.05, 0.6, 0.8, 0.95], 0.15, [4]),
      part(4, "coffee table", [0.25, 0.6, 0.5, 0.85], 0.04, [3, 6]),
      part(5, "pillow", [0.15, 0.38, 0.25, 0.5], 0.01, [2]),
      // On the coffee table in front of the sofa: its bottom is far below the sofa's.
      part(6, "vase", [0.3, 0.55, 0.34, 0.72], 0.003, [2, 4]),
      part(7, "windowpane", [0.6, 0.1, 0.9, 0.4], 0.08),
      part(8, "person", [0.7, 0.3, 0.8, 0.9], 0.05),
      part(9, "light", [0.3, 0, 0.35, 0.05], 0.002, [2]),
    ]);
    assert.deepEqual(items, [
      { id: "3", label: "Halı", parts: [3], box: [0.05, 0.6, 0.8, 0.95], area: 0.15 },
      { id: "2", label: "Koltuk", parts: [2, 5], box: [0.1, 0.35, 0.6, 0.65], area: 0.12 },
      { id: "4", label: "Sehpa", parts: [4, 6], box: [0.25, 0.6, 0.5, 0.85], area: 0.04 },
    ]);
  });

  it("joins a small thing to the item its box overlaps most, and only when it touches and sits inside", () => {
    const items = buildPhotoItems([
      part(1, "bed", [0.1, 0.4, 0.7, 0.9], 0.2, [3, 6]),
      part(2, "chest of drawers", [0.6, 0.45, 0.95, 0.8], 0.06, [3, 4, 6]),
      // Inside both boxes; it overlaps the chest's more.
      part(3, "blanket", [0.6, 0.5, 0.71, 0.8], 0.02, [1, 2]),
      // Touches the chest but sticks out of it on the right.
      part(4, "book", [0.9, 0.4, 0.99, 0.46], 0.002, [2]),
      // Inside the bed's box but touching nothing.
      part(5, "pillow", [0.2, 0.42, 0.3, 0.5], 0.01),
      // Inside both boxes; it overlaps the bed's more.
      part(6, "pillow", [0.58, 0.42, 0.66, 0.5], 0.005, [1, 2]),
    ]);
    assert.deepEqual(
      items.map((item) => [item.label, item.parts]),
      [
        ["Yatak", [1, 6]],
        ["Şifonyer", [2, 3]],
      ],
    );
  });

  it("drops tiny items, keeps the 12 largest and tells same-named items apart by place", () => {
    const chairs = Array.from({ length: 14 }, (_, index) =>
      part(index + 1, "chair", [index / 15, 0.5, index / 15 + 0.05, 0.8], 0.03 - index * 0.001),
    );
    const items = buildPhotoItems([...chairs, part(20, "lamp", [0.4, 0, 0.45, 0.1], 0.004)]);
    assert.equal(items.length, MAX_PHOTO_ITEMS);
    assert.ok(!items.some((item) => item.id === "20"), "under 0.5 % of the photo");
    assert.deepEqual(items.map((item) => item.id), chairs.slice(0, 12).map((chair) => String(chair.id)));

    const sofas = buildPhotoItems([
      part(1, "sofa", [0.0, 0.4, 0.3, 0.7], 0.1),
      part(2, "seat", [0.7, 0.4, 0.95, 0.7], 0.08),
      part(3, "sofa", [0.35, 0.4, 0.6, 0.7], 0.07),
      part(4, "table", [0.4, 0.6, 0.6, 0.8], 0.03),
    ]);
    assert.deepEqual(
      sofas.map((item) => item.label),
      ["Koltuk (solda)", "Koltuk (sağda)", "Koltuk (ortada)", "Masa"],
    );
  });

  it("joins the pieces of a rug or curtain cut by something in front, but keeps two armchairs two", () => {
    const items = buildPhotoItems([
      part(1, "sofa", [0.19, 0.57, 0.89, 0.91], 0.12, [6, 9, 15]),
      // The coffee table stands on the rug and cuts it into three pieces (local e2e photo, 28 Ekim).
      part(6, "coffee table", [0.34, 0.78, 0.57, 1], 0.03, [1, 9, 14, 15]),
      part(9, "rug", [0.22, 0.84, 0.39, 1], 0.019, [1, 6]),
      part(14, "rug", [0.41, 0.92, 0.54, 1], 0.008, [6]),
      part(15, "rug", [0.57, 0.84, 0.69, 0.93], 0.007, [1, 6]),
      // Two curtain panels around the window.
      part(20, "windowpane", [0.75, 0.1, 0.9, 0.6], 0.07, [21, 22]),
      part(21, "curtain", [0.7, 0.05, 0.76, 0.7], 0.03, [20]),
      part(22, "curtain", [0.89, 0.05, 0.95, 0.7], 0.025, [20]),
    ]);
    assert.deepEqual(
      items.map((item) => [item.id, item.label, item.parts]),
      [
        ["1", "Koltuk", [1]],
        ["21", "Perde", [21, 22]],
        ["9", "Halı", [9, 14, 15]],
        ["6", "Sehpa", [6]],
      ],
    );
    const rug = items.find((item) => item.label === "Halı")!;
    assert.deepEqual(rug.box, [0.22, 0.84, 0.69, 1]);
    assert.equal(rug.area, 0.034);

    const armchairs = buildPhotoItems([
      part(1, "armchair", [0.1, 0.5, 0.3, 0.9], 0.05, [3]),
      part(2, "armchair", [0.4, 0.5, 0.6, 0.9], 0.05, [3]),
      part(3, "table", [0.3, 0.6, 0.4, 0.88], 0.02, [1, 2]),
    ]);
    assert.deepEqual(armchairs.map((item) => item.label), ["Berjer (solda)", "Berjer (ortada)", "Masa"]);

    const rugs = buildPhotoItems([
      part(1, "rug", [0.05, 0.7, 0.35, 0.95], 0.06),
      part(2, "rug", [0.6, 0.7, 0.95, 0.95], 0.06),
    ]);
    assert.deepEqual(rugs.map((item) => item.label), ["Halı (solda)", "Halı (sağda)"], "nothing in front joins them");
  });

  it("reads the analysis field by field and tells an older analysis (no objects) apart", () => {
    assert.equal(parseAnalysisObjects(undefined), null);
    assert.equal(photoItemsFromAnalysis({ id: 1 }), null);
    assert.deepEqual(photoItemsFromAnalysis([]), []);
    const parsed = parseAnalysisObjects([
      { id: 3, classId: 23, className: "sofa", box: [0.1, 0.2, 0.5, 0.6], area: 0.1, touches: [4, "x", 900] },
      { id: 0, className: "sofa", box: [0, 0, 1, 1], area: 0.5 },
      { id: 5, className: "sofa", box: [0.5, 0.2, 0.4, 0.6], area: 0.1 },
      { id: 6, className: "sofa", box: [0, 0, 1.2, 1], area: 0.1 },
      { id: 7, className: 7, box: [0, 0, 1, 1], area: 0.1 },
      { id: 8, className: "rug", box: [0, 0.5, 1, 1], area: 0.3 },
      "junk",
    ]);
    assert.deepEqual(parsed, [
      { id: 3, className: "sofa", box: [0.1, 0.2, 0.5, 0.6], area: 0.1, touches: [4] },
      { id: 8, className: "rug", box: [0, 0.5, 1, 1], area: 0.3, touches: [] },
    ]);
  });

  it("stores the list with areas and gives the browser the contract fields only", () => {
    const items = buildPhotoItems([part(2, "sofa", [0.1, 0.35, 0.6, 0.65], 0.12, [5]), part(5, "cushion", [0.2, 0.4, 0.3, 0.5], 0.01, [2])]);
    const stored = parseStoredPhotoItems(JSON.stringify(items));
    assert.deepEqual(stored, items);
    assert.deepEqual(toPhotoItemView(stored![0]), { id: "2", label: "Koltuk", parts: [2, 5], box: [0.1, 0.35, 0.6, 0.65] });
    assert.equal(parseStoredPhotoItems(null), null);
    assert.equal(parseStoredPhotoItems("{bad"), null);
    assert.deepEqual(parseStoredPhotoItems(JSON.stringify([{ id: "x", label: "A", parts: [1], box: [0, 0, 1, 1], area: 0.1 }])), []);
  });

  it("tells the assistant name, place and a size word, never a measurement", () => {
    const facts = photoItemsForModel(
      buildPhotoItems([
        part(1, "wardrobe", [0.0, 0.1, 0.3, 0.9], 0.2),
        part(2, "armchair", [0.4, 0.4, 0.6, 0.8], 0.05),
        part(3, "plant", [0.8, 0.5, 0.9, 0.8], 0.01),
      ]),
    );
    assert.deepEqual(facts, [
      { id: "1", label: "Gardırop", position: "solda", size: "büyük" },
      { id: "2", label: "Berjer", position: "ortada", size: "orta" },
      { id: "3", label: "Bitki", position: "sağda", size: "küçük" },
    ]);
  });
});
