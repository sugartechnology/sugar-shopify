/**
 * Removable items of a room photo (CONTRACT §2.9), built from the room
 * analysis `objects` list. Pure: the only input is the analysis' class names
 * and boxes. No Shopify or product data is read, so changes to the store's
 * data never change this list.
 *
 * - Listed classes and their Turkish names: PHOTO_ITEM_LABELS.
 * - Small things (ATTACHED_CLASSES: cushion, vase, book…) are never listed
 *   alone; when one sits on a listed item it joins that item's `parts`.
 * - A rug or curtain cut into pieces by something in front of it (a coffee
 *   table on the rug) is one item: COVERING_CLASSES.
 * - The room itself (ROOM_CLASSES: wall, window, door…) and every class
 *   missing from the tables is never listed.
 * - Nothing under 0.5 % of the photo, the 12 largest, largest first.
 * - A name used more than once gets its place: "Koltuk (solda)".
 */

/** Analysis class name (ADE20K) → the name the customer sees. */
export const PHOTO_ITEM_LABELS: Readonly<Record<string, string>> = {
  bed: "Yatak",
  cabinet: "Dolap",
  wardrobe: "Gardırop",
  "chest of drawers": "Şifonyer",
  buffet: "Büfe",
  bookcase: "Kitaplık",
  shelf: "Raf",
  case: "Vitrin",
  sofa: "Koltuk",
  armchair: "Berjer",
  seat: "Koltuk",
  chair: "Sandalye",
  "swivel chair": "Sandalye",
  stool: "Tabure",
  bench: "Bank",
  ottoman: "Puf",
  table: "Masa",
  desk: "Çalışma masası",
  "coffee table": "Sehpa",
  "television receiver": "Televizyon",
  monitor: "Ekran",
  "crt screen": "Ekran",
  lamp: "Lamba",
  chandelier: "Avize",
  plant: "Bitki",
  curtain: "Perde",
  blind: "Stor perde",
  rug: "Halı",
  painting: "Tablo",
  poster: "Poster",
  mirror: "Ayna",
  clock: "Saat",
  fan: "Vantilatör",
  cradle: "Beşik",
  basket: "Sepet",
  box: "Kutu",
  sculpture: "Heykel",
};

/** Small things that sit on a larger item; never listed alone. */
export const ATTACHED_CLASSES: readonly string[] = [
  "cushion",
  "pillow",
  "book",
  "flower",
  "vase",
  "bottle",
  "plate",
  "glass",
  "tray",
  "blanket",
  "apparel",
  "towel",
  "plaything",
  "bag",
  "food",
  "pot",
  "computer",
];

/**
 * Coverings: one large piece in a room. When the furniture in front cuts one
 * into pieces, the pieces are one item (a rug under a coffee table, two
 * curtain panels around a window). Not seating, tables or beds: two of those
 * side by side with a side table between them are common and stay two.
 */
export const COVERING_CLASSES: readonly string[] = ["rug", "curtain", "blind"];

/**
 * The room itself and outdoor classes: never listed. The code does not read
 * this list (a class missing from the table is never listed anyway); the
 * tests check that none of them gets a label. "light" is the ceiling light,
 * part of the room.
 */
export const ROOM_CLASSES: readonly string[] = [
  "wall", "floor", "ceiling", "windowpane", "door", "screen door", "column", "stairs", "stairway",
  "step", "railing", "bannister", "radiator", "fireplace", "countertop", "counter", "kitchen island",
  "sink", "bathtub", "toilet", "shower", "stove", "oven", "refrigerator", "dishwasher", "hood",
  "light", "person", "animal",
  "building", "sky", "tree", "road", "grass", "sidewalk", "earth", "mountain", "car", "water",
  "house", "sea", "field", "fence", "rock", "sand", "skyscraper", "path", "river", "bridge", "hill",
  "palm", "boat", "bus", "truck", "tower", "awning", "streetlight", "airplane", "pole", "land",
  "van", "ship", "fountain", "swimming pool", "waterfall", "tent", "lake", "bicycle", "traffic light",
];

/** Items smaller than this share of the photo are not listed. */
export const MIN_ITEM_AREA = 0.005;
/** At most this many items on the card. */
export const MAX_PHOTO_ITEMS = 12;
/** At most this many characters of what the customer writes on the card to remove. */
export const MAX_CLEAN_TEXT = 200;
/** How far a small thing's box may stick out of the larger item's box (share of the photo). */
const EDGE_SLACK = 0.02;
/** The object map is 8 bit: part numbers 1..255. */
const MAX_PART_ID = 255;

export type Box = [number, number, number, number];

/** One part of the analysis (decor-ai ObjectFinder): connected pixels of one class. */
export interface AnalysisObject {
  id: number;
  className: string;
  /** [x0, y0, x1, y1], 0..1 of the photo size */
  box: Box;
  /** Share of the photo, 0..1 */
  area: number;
  /** Numbers of the parts it touches */
  touches: number[];
}

/** An item as the browser gets it (RoomView.objects). */
export interface PhotoItemView {
  /** The listed item's part number, as text */
  id: string;
  label: string;
  /** Parts of the object map that belong to this item: itself + the small things on it */
  parts: number[];
  box: Box;
}

/** An item as KoshoyRoom.objects keeps it: the view plus its area (for the assistant's size word). */
export interface PhotoItem extends PhotoItemView {
  area: number;
}

/* ---------------- the analysis list ---------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function share(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function partId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PART_ID
    ? value
    : null;
}

function toBox(value: unknown): Box | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [x0, y0, x1, y1] = value.map(share);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

function toAnalysisObject(raw: unknown): AnalysisObject | null {
  const row = asRecord(raw);
  const id = partId(row?.id);
  const box = toBox(row?.box);
  const area = share(row?.area);
  if (!row || id === null || typeof row.className !== "string" || !box || area === null) return null;
  const touches = Array.isArray(row.touches)
    ? row.touches.map(partId).filter((value): value is number => value !== null)
    : [];
  return { id, className: row.className, box, area, touches };
}

/** The analysis `objects` field, field by field; unreadable parts drop. null: no such field (older analysis). */
export function parseAnalysisObjects(raw: unknown): AnalysisObject[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .slice(0, MAX_PART_ID)
    .map(toAnalysisObject)
    .filter((item): item is AnalysisObject => item !== null);
}

/* ---------------- the list ---------------- */

/** A listed item before naming: one part, or the pieces of a cut covering. */
interface ItemPieces {
  pieces: AnalysisObject[];
  /** The largest piece; its number is the item's id. */
  main: AnalysisObject;
  box: Box;
  area: number;
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const height = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return width > 0 && height > 0 ? width * height : 0;
}

function touching(a: AnalysisObject, b: AnalysisObject): boolean {
  return a.touches.includes(b.id) || b.touches.includes(a.id);
}

/** The stretch between two boxes on one axis (0 = x, 1 = y); null when they overlap on it. */
function gapBetween(a: Box, b: Box, axis: 0 | 1): [number, number] | null {
  const [first, second] = a[axis] <= b[axis] ? [a, b] : [b, a];
  return second[axis] > first[axis + 2] ? [first[axis + 2], second[axis]] : null;
}

/** Two pieces are cut from one when something touches both and its box spans the gap between them. */
function cutByFront(a: AnalysisObject, b: AnalysisObject, objects: readonly AnalysisObject[]): boolean {
  return objects.some((front) => {
    if (front.id === a.id || front.id === b.id || !touching(front, a) || !touching(front, b)) return false;
    return ([0, 1] as const).every((axis) => {
      const gap = gapBetween(a.box, b.box, axis);
      return !gap || (front.box[axis] <= gap[0] + EDGE_SLACK && front.box[axis + 2] >= gap[1] - EDGE_SLACK);
    });
  });
}

function toItemPieces(pieces: AnalysisObject[]): ItemPieces {
  const main = pieces.reduce((largest, piece) => (piece.area > largest.area ? piece : largest));
  const box: Box = [
    Math.min(...pieces.map((piece) => piece.box[0])),
    Math.min(...pieces.map((piece) => piece.box[1])),
    Math.max(...pieces.map((piece) => piece.box[2])),
    Math.max(...pieces.map((piece) => piece.box[3])),
  ];
  const area = Number(pieces.reduce((sum, piece) => sum + piece.area, 0).toFixed(5));
  return { pieces, main, box, area };
}

/** Every part with a label is an item, except that the pieces of a cut covering are one item. */
function itemPieces(objects: readonly AnalysisObject[]): ItemPieces[] {
  const groups: AnalysisObject[][] = [];
  for (const part of objects) {
    if (PHOTO_ITEM_LABELS[part.className] === undefined) continue;
    const joined = COVERING_CLASSES.includes(part.className)
      ? groups.filter(
          (group) =>
            group[0].className === part.className && group.some((piece) => cutByFront(part, piece, objects)),
        )
      : [];
    for (const group of joined) groups.splice(groups.indexOf(group), 1);
    groups.push([part, ...joined.flat()]);
  }
  return groups.map(toItemPieces);
}

/**
 * The listed item a small thing sits on: it touches it, lies inside its box
 * horizontally and its bottom edge is not below the item's bottom edge (a
 * vase on a coffee table in front of a sofa does not join the sofa). With
 * several, the one whose box overlaps most. null when there is none.
 */
function parentOf(small: AnalysisObject, parents: readonly ItemPieces[]): ItemPieces | null {
  let best: ItemPieces | null = null;
  let bestOverlap = -1;
  for (const parent of parents) {
    const touches = parent.pieces.some((piece) => touching(small, piece));
    const inside =
      small.box[0] >= parent.box[0] - EDGE_SLACK &&
      small.box[2] <= parent.box[2] + EDGE_SLACK &&
      small.box[3] <= parent.box[3] + EDGE_SLACK;
    if (!touches || !inside) continue;
    const overlap = overlapArea(small.box, parent.box);
    if (overlap > bestOverlap) {
      best = parent;
      bestOverlap = overlap;
    }
  }
  return best;
}

export type HorizontalPlace = "solda" | "ortada" | "sağda";

/** Which third of the photo the box centre is in. */
export function horizontalPlace(box: Box): HorizontalPlace {
  const centre = (box[0] + box[2]) / 2;
  if (centre < 0.34) return "solda";
  if (centre < 0.67) return "ortada";
  return "sağda";
}

/** Items sharing a name get their place added: "Koltuk (solda)", "Koltuk (sağda)". */
function withPlaces(items: PhotoItem[]): PhotoItem[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  return items.map((item) =>
    (counts.get(item.label) ?? 0) > 1 ? { ...item, label: `${item.label} (${horizontalPlace(item.box)})` } : item,
  );
}

/** Removable items from the analysis parts: largest first, at most 12. */
export function buildPhotoItems(objects: readonly AnalysisObject[]): PhotoItem[] {
  const parents = itemPieces(objects)
    .filter((item) => item.area >= MIN_ITEM_AREA)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_PHOTO_ITEMS);

  const parts = new Map<ItemPieces, number[]>(
    parents.map((parent) => [parent, parent.pieces.map((piece) => piece.id)]),
  );
  for (const small of objects) {
    if (!ATTACHED_CLASSES.includes(small.className)) continue;
    const parent = parentOf(small, parents);
    if (parent) parts.get(parent)!.push(small.id);
  }

  return withPlaces(
    parents.map((parent) => ({
      id: String(parent.main.id),
      label: PHOTO_ITEM_LABELS[parent.main.className],
      parts: parts.get(parent)!.sort((a, b) => a - b),
      box: parent.box,
      area: parent.area,
    })),
  );
}

/** The list from the analysis answer's `objects` field; null without the field. */
export function photoItemsFromAnalysis(raw: unknown): PhotoItem[] | null {
  const objects = parseAnalysisObjects(raw);
  return objects ? buildPhotoItems(objects) : null;
}

/* ---------------- the stored list ---------------- */

const ITEM_ID = /^\d{1,3}$/;

function toStoredItem(raw: unknown): PhotoItem | null {
  const row = asRecord(raw);
  const box = toBox(row?.box);
  const area = share(row?.area);
  if (!row || typeof row.id !== "string" || !ITEM_ID.test(row.id) || !box || area === null) return null;
  if (typeof row.label !== "string" || !row.label || !Array.isArray(row.parts)) return null;
  const parts = row.parts.map(partId).filter((value): value is number => value !== null);
  return parts.length ? { id: row.id, label: row.label, parts, box, area } : null;
}

/** KoshoyRoom.objects → list; null when missing or unreadable. */
export function parseStoredPhotoItems(raw: string | null): PhotoItem[] | null {
  if (!raw) return null;
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return rows
    .slice(0, MAX_PHOTO_ITEMS)
    .map(toStoredItem)
    .filter((item): item is PhotoItem => item !== null);
}

/** The fields the browser gets; the area stays here. */
export function toPhotoItemView(item: PhotoItem): PhotoItemView {
  return { id: item.id, label: item.label, parts: [...item.parts], box: [...item.box] };
}

/* ---------------- what the assistant gets ---------------- */

export type SizeWord = "büyük" | "orta" | "küçük";

/** By how much of the photo it covers; not a measurement. */
export function sizeWord(area: number): SizeWord {
  if (area >= 0.08) return "büyük";
  if (area >= 0.02) return "orta";
  return "küçük";
}

/** The assistant's room facts: id, name, place, size word. No measurements. */
export function photoItemsForModel(items: readonly PhotoItem[]) {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    position: horizontalPlace(item.box),
    size: sizeWord(item.area),
  }));
}
