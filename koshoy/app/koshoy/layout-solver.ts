/**
 * Pure room layout rules (CONTRACT v2 §6): where the layout stands (room
 * wall, room floor or studio wall), how an op changes it, how it is
 * re-settled, and where place_in_room asks a design to go. The free spots
 * themselves come from the vendored solver (room-layout/, synced from
 * 3d-room-designer). No database here: layout.server.ts saves.
 */
import type { LayoutItemView, LayoutPlaceView, LayoutTargetView } from "./events";
import {
  floorFrame,
  floorRow,
  imageXToAlong,
  MAX_LAYOUT_ITEMS,
  nearestFreeFloorSpot,
  nearestFreeSpot,
  settleRow,
  sideBySideFloorSpot,
  STUDIO_WALL,
  STUDIO_WALL_LINE,
  wallLine,
  widthDirection,
  type FloorFrame,
  type FloorRect,
  type WallBounds,
  type WallLine,
} from "./room-layout";
import type { RoomView } from "./room.server";
import type { KoshoyDesign } from "./store.server";

export interface LayoutState {
  version: number;
  /** KoshoyRoom the places belong to; null = studio virtual wall */
  roomId: string | null;
  items: LayoutItemView[];
}

/** A design's total width (all units side by side), metres. */
export function designWidthM(design: KoshoyDesign): number {
  return design.composition.units.reduce((sum, unit) => sum + unit.widthMm, 0) / 1000;
}

/** A design's depth, metres. */
export function designDepthM(design: KoshoyDesign): number {
  return design.composition.depthMm / 1000;
}

/** Design ids that stand in the room (a place), left to right. */
export function placedLeftToRight(layout: LayoutState): string[] {
  const position = (place: LayoutPlaceView) => (place.surface === "wall" ? place.alongM : place.xM);
  return layout.items
    .filter((item): item is LayoutItemView & { place: LayoutPlaceView } => item.place !== null)
    .sort((a, b) => position(a.place) - position(b.place))
    .map((item) => item.designId);
}

/* ---------------- where the layout stands ---------------- */

/**
 * The room's wall (cabinets slide along it), the room's floor (no usable
 * wall: free, rotatable) or the studio's virtual wall (no room, or a room
 * without a usable floor, where the 3D view stays in the studio too).
 */
export type LayoutTarget =
  | {
      surface: "wall";
      roomId: string | null;
      bounds: WallBounds;
      frame: FloorFrame | null;
      line: WallLine;
      /** Empty stretches of the visible wall (furniture mask): new designs go there first. */
      free: readonly WallBounds[];
    }
  | { surface: "floor"; roomId: string; frame: FloorFrame };

export const STUDIO_TARGET: LayoutTarget = {
  surface: "wall",
  roomId: null,
  bounds: STUDIO_WALL,
  frame: null,
  line: STUDIO_WALL_LINE,
  free: [],
};

/** What the storefront (and the 3D studio view) is told about the target. */
export function targetView(target: LayoutTarget): LayoutTargetView {
  return target.surface === "wall"
    ? { surface: "wall", wall: { fromM: target.bounds.fromM, toM: target.bounds.toM } }
    : { surface: "floor" };
}

/** `free`: the room's empty wall stretches (room-measure.server.ts); they never reach the browser. */
export function layoutTarget(room: RoomView | null, free: readonly WallBounds[] = []): LayoutTarget {
  if (room?.status !== "ready" || !room.width || !room.height || !room.camera || !room.planes) {
    return STUDIO_TARGET;
  }
  const input = { width: room.width, height: room.height, camera: room.camera, planes: room.planes };
  const frame = floorFrame(input);
  if (!frame) return STUDIO_TARGET;
  const line = wallLine(input, frame);
  if (line && room.wall) return { surface: "wall", roomId: room.id, bounds: room.wall, frame, line, free };
  return { surface: "floor", roomId: room.id, frame };
}

/**
 * The floor point seen at a photo position (0..1 from the top left): where
 * the ray through it meets the floor. null above the horizon or behind.
 */
function floorPointAtImage(
  frame: FloorFrame,
  imageX: number,
  imageY: number,
): { xM: number; forwardM: number } | null {
  const ray = [((imageX - 0.5) * frame.width) / frame.focalPx, ((0.5 - imageY) * frame.height) / frame.focalPx, -1];
  const along = (axis: readonly number[]) => ray[0] * axis[0] + ray[1] * axis[1] + ray[2] * axis[2];
  const down = along(frame.up);
  if (down >= -1e-9) return null;
  const t = frame.cameraHeightM / -down;
  const point = { xM: t * along(frame.right), forwardM: t * along(frame.forward) };
  return point.forwardM > 0 ? point : null;
}

/**
 * An empty stretch of the wall that takes the cabinet (CONTRACT v2.2-2:
 * not behind the customer's sofa), the one closest to the wall's middle;
 * null when there is none or it is full.
 */
function freeStretchPlace(
  target: LayoutTarget,
  others: readonly LayoutItemView[],
  sizes: ReadonlyMap<string, DesignSize>,
  size: DesignSize,
): LayoutPlaceView | null {
  if (target.surface !== "wall" || !target.free.length) return null;
  const middle = (target.bounds.fromM + target.bounds.toM) / 2;
  const taken = others.flatMap((item) =>
    item.place?.surface === "wall" ? [{ centerM: item.place.alongM, widthM: sizes.get(item.designId)?.widthM ?? 0 }] : [],
  );
  let best: number | null = null;
  for (const stretch of target.free) {
    const bounds = { fromM: Math.max(stretch.fromM, target.bounds.fromM), toM: Math.min(stretch.toM, target.bounds.toM) };
    if (bounds.toM - bounds.fromM < size.widthM) continue;
    const center = nearestFreeSpot(bounds, taken, size.widthM, clamp(middle, bounds.fromM, bounds.toM));
    if (center !== null && (best === null || Math.abs(center - middle) < Math.abs(best - middle))) best = center;
  }
  return best === null ? null : { surface: "wall", alongM: best };
}

/** Whether a wall cabinet stands wholly inside one of the empty stretches. */
function inFreeStretch(target: LayoutTarget, place: LayoutPlaceView, widthM: number): boolean {
  if (target.surface !== "wall" || place.surface !== "wall") return false;
  const [from, to] = [place.alongM - widthM / 2, place.alongM + widthM / 2];
  return target.free.some((stretch) => from >= stretch.fromM - 1e-6 && to <= stretch.toM + 1e-6);
}

/**
 * Where a new design goes when nobody said where: the middle of the wall,
 * or on the floor where its base is in the photo (the core's floorRow, the
 * same spot the 3D view starts it on; CONTRACT v2.1-4, v2.2-5).
 */
function defaultPlace(target: LayoutTarget, size: DesignSize): LayoutPlaceView {
  if (target.surface === "wall") {
    return { surface: "wall", alongM: (target.bounds.fromM + target.bounds.toM) / 2 };
  }
  return { surface: "floor", ...floorRow(target.frame, [size])[0], rotDeg: 0 };
}

/* ---------------- the solver ---------------- */

export interface DesignSize {
  widthM: number;
  depthM: number;
}

export function designSizes(designs: readonly KoshoyDesign[]): Map<string, DesignSize> {
  return new Map(designs.map((design) => [design.id, { widthM: designWidthM(design), depthM: designDepthM(design) }]));
}

function floorRect(
  place: Extract<LayoutPlaceView, { surface: "floor" }>,
  size: DesignSize,
): FloorRect {
  return { xM: place.xM, forwardM: place.forwardM, rotDeg: place.rotDeg, widthM: size.widthM, depthM: size.depthM };
}

/**
 * The free place nearest to `wanted` among `others`; null when there is none.
 * `inRow`: a floor cabinet nobody placed by hand lines up beside the others
 * first (same as the 3D view), so fronts and backs do not hide each other.
 */
function freePlace(
  target: LayoutTarget,
  others: readonly LayoutItemView[],
  sizes: ReadonlyMap<string, DesignSize>,
  size: DesignSize,
  wanted: LayoutPlaceView,
  inRow = false,
): LayoutPlaceView | null {
  if (target.surface === "wall") {
    if (wanted.surface !== "wall") return null;
    const taken = others.flatMap((item) =>
      item.place?.surface === "wall"
        ? [{ centerM: item.place.alongM, widthM: sizes.get(item.designId)?.widthM ?? 0 }]
        : [],
    );
    const center = nearestFreeSpot(target.bounds, taken, size.widthM, wanted.alongM);
    return center === null ? null : { surface: "wall", alongM: center };
  }
  if (wanted.surface !== "floor") return null;
  const rects = others.flatMap((item) =>
    item.place?.surface === "floor" && sizes.has(item.designId)
      ? [floorRect(item.place, sizes.get(item.designId)!)]
      : [],
  );
  const rect = floorRect(wanted, size);
  const spot = (inRow ? sideBySideFloorSpot(rect, rects) : null) ?? nearestFreeFloorSpot(rect, rects);
  return spot ? { surface: "floor", xM: spot.xM, forwardM: spot.forwardM, rotDeg: wanted.rotDeg } : null;
}

/**
 * Brings every item onto `target` without overlaps: wall rows keep their
 * order and move as little as possible (settleRow); floor items take the
 * nearest free spot in turn. What does not fit gets place null. Items whose
 * design is gone are dropped. Also converts places when the target changed
 * (studio → room wall, wall → floor…).
 */
function wallAlong(item: LayoutItemView): number {
  return item.place?.surface === "wall" ? item.place.alongM : 0;
}

export function settleItems(
  items: readonly LayoutItemView[],
  target: LayoutTarget,
  sizes: ReadonlyMap<string, DesignSize>,
): LayoutItemView[] {
  const known = items.filter((item) => sizes.has(item.designId));
  if (target.surface === "wall") {
    const rows = known.map((item) => ({
      id: item.designId,
      widthM: sizes.get(item.designId)!.widthM,
      centerM: item.place === null ? null : item.place.surface === "wall" ? item.place.alongM : item.place.xM,
    }));
    return settleRow(target.bounds, rows).map((row) => ({
      designId: row.id,
      place: row.centerM === null ? null : { surface: "wall", alongM: row.centerM },
    }));
  }
  // Coming off a wall (a new room without one): one row in the order they stood, its
  // bases in the photo (the core's floorRow, same as the 3D view).
  const offWall = known
    .filter((item) => item.place?.surface === "wall")
    .sort((a, b) => wallAlong(a) - wallAlong(b));
  const row = floorRow(target.frame, offWall.map((item) => sizes.get(item.designId)!));
  const rowPlace = new Map(offWall.map((item, index) => [item.designId, row[index]]));
  const out: LayoutItemView[] = [];
  for (const item of known) {
    if (!item.place) {
      out.push(item);
      continue;
    }
    const inRow = rowPlace.get(item.designId);
    const wanted: LayoutPlaceView = inRow ? { surface: "floor", ...inRow, rotDeg: 0 } : item.place;
    const size = sizes.get(item.designId)!;
    out.push({ designId: item.designId, place: freePlace(target, out, sizes, size, wanted, Boolean(inRow)) });
  }
  return out;
}

export type LayoutOp =
  | { op: "add"; designId: string; place?: LayoutPlaceView }
  | { op: "move"; designId: string; place: LayoutPlaceView }
  | { op: "remove"; designId: string };

/**
 * placed: where it was asked (within 1 cm) · moved_nearby: the nearest free
 * spot instead · no_space: nothing free, layout unchanged · layout_full:
 * already MAX items · not_in_layout: move of a design that does not stand
 * there · wrong_surface: a wall place for a floor layout or the other way.
 */
export type LayoutOutcome =
  | "placed"
  | "moved_nearby"
  | "removed"
  | "no_space"
  | "layout_full"
  | "not_in_layout"
  | "wrong_surface";

export function samePlace(a: LayoutPlaceView, b: LayoutPlaceView): boolean {
  if (a.surface === "wall" && b.surface === "wall") return Math.abs(a.alongM - b.alongM) < 0.01;
  if (a.surface === "floor" && b.surface === "floor") {
    return Math.hypot(a.xM - b.xM, a.forwardM - b.forwardM) < 0.01;
  }
  return false;
}

/** One op on already settled items. Pure: the caller saves the result. */
export function applyLayoutOp(
  items: readonly LayoutItemView[],
  op: LayoutOp,
  target: LayoutTarget,
  sizes: ReadonlyMap<string, DesignSize>,
): { items: LayoutItemView[]; outcome: LayoutOutcome; place: LayoutPlaceView | null } {
  const existing = items.find((item) => item.designId === op.designId) ?? null;
  if (op.op === "remove") {
    return { items: items.filter((item) => item !== existing), outcome: "removed", place: null };
  }
  const unchanged = { items: [...items], place: existing?.place ?? null };
  const size = sizes.get(op.designId);
  if (!size || (op.op === "move" && !existing)) return { ...unchanged, outcome: "not_in_layout" };
  if (!existing && items.length >= MAX_LAYOUT_ITEMS) return { ...unchanged, outcome: "layout_full" };
  if (op.place && op.place.surface !== target.surface) return { ...unchanged, outcome: "wrong_surface" };

  const others = items.filter((item) => item !== existing);
  // A new design nobody placed: an empty stretch of wall first, then the default spot.
  const wanted =
    op.place ?? existing?.place ?? freeStretchPlace(target, others, sizes, size) ?? defaultPlace(target, size);
  const placedByHand = Boolean(op.place ?? existing?.place);
  const place = freePlace(target, others, sizes, size, wanted, !placedByHand);
  if (!place) return { ...unchanged, outcome: "no_space" };
  const next = existing
    ? items.map((item) => (item === existing ? { designId: op.designId, place } : item))
    : [...items, { designId: op.designId, place }];
  return { items: next, outcome: samePlace(place, wanted) ? "placed" : "moved_nearby", place };
}

/* ---------------- place_in_room ---------------- */

export interface PlaceRequest {
  at: "free" | "left_of" | "right_of" | "photo_x" | "wall_cm" | "floor";
  refDesignId?: string;
  /** 0 = left edge of the photo, 1 = right edge */
  photoX?: number;
  /** 0 = top edge, 1 = bottom edge; with photoX on a floor: exactly the floor point seen there */
  photoY?: number;
  /** cm from the visible wall's left end */
  wallCm?: number;
  /** Which part of the cabinet goes to photoX / wallCm. */
  align?: "center" | "left_edge" | "right_edge";
  rotateDeg?: number;
}

export type PlaceError = "no_room" | "no_wall" | "ref_not_placed" | "outside_photo";

/** Model-facing reasons; product language, no codes. */
export const PLACE_ERROR_HINTS: Record<PlaceError, string> = {
  no_room: "Hazır bir oda fotoğrafı yok. Müşteriden sohbetteki fotoğraf düğmesiyle odasının fotoğrafını yüklemesini iste.",
  no_wall: "Bu fotoğrafta duvar bulunamadı; tasarımlar zeminde serbest durur, duvara göre yer verilemez.",
  ref_not_placed: "Yanına konacak tasarım odada değil.",
  outside_photo: "Fotoğraftaki o yerde zemin ya da duvar bulunamadı; başka bir yer söyle.",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** How far the cabinet's centre is from the point it is aligned to, along its width. */
function alignShift(align: PlaceRequest["align"], widthM: number): number {
  if (align === "left_edge") return widthM / 2;
  if (align === "right_edge") return -widthM / 2;
  return 0;
}

/**
 * Turns the model's request into a wanted place on `target`; undefined place
 * = keep its place or take the default one. The solver then moves it to the
 * nearest free spot. Notes explain what was ignored.
 */
export function wantedPlace(
  target: LayoutTarget,
  items: readonly LayoutItemView[],
  sizes: ReadonlyMap<string, DesignSize>,
  designId: string,
  request: PlaceRequest,
): { place?: LayoutPlaceView; error?: PlaceError; notes: string[] } {
  const notes: string[] = [];
  const size = sizes.get(designId) ?? { widthM: 0, depthM: 0 };
  const own = items.find((item) => item.designId === designId)?.place ?? null;
  const ref = request.refDesignId
    ? items.find((item) => item.designId === request.refDesignId)?.place ?? null
    : null;
  const refWidth = request.refDesignId ? sizes.get(request.refDesignId)?.widthM ?? 0 : 0;
  const side = request.at === "left_of" ? -1 : 1;
  if (request.at === "photo_x" && target.roomId === null) return { error: "no_room", notes };

  if (target.surface === "wall") {
    if (request.at === "floor" || request.rotateDeg !== undefined) {
      notes.push("Bu odada tasarımlar duvara yaslı durur ve dönmez.");
    }
    let alongM: number | undefined;
    if (request.at === "left_of" || request.at === "right_of") {
      if (ref?.surface !== "wall") return { error: "ref_not_placed", notes };
      alongM = ref.alongM + (side * (refWidth + size.widthM)) / 2;
    } else if (request.at === "photo_x") {
      const point = target.frame ? imageXToAlong(target.frame, target.line, clamp(request.photoX ?? 0.5, 0, 1)) : null;
      if (point === null) return { error: "outside_photo", notes };
      alongM = point + alignShift(request.align, size.widthM);
    } else if (request.at === "wall_cm") {
      alongM = target.bounds.fromM + (request.wallCm ?? 0) / 100 + alignShift(request.align, size.widthM);
    } else if (request.at === "free" && !(own && inFreeStretch(target, own, size.widthM))) {
      // "free": an empty stretch of wall (v2.2-2); one already standing in one stays.
      const others = items.filter((item) => item.designId !== designId);
      const stretch = freeStretchPlace(target, others, sizes, size);
      if (stretch?.surface === "wall") alongM = stretch.alongM;
    }
    return { place: alongM === undefined ? undefined : { surface: "wall", alongM }, notes };
  }

  const ownFloor = own?.surface === "floor" ? own : null;
  const rotDeg = clamp(request.rotateDeg ?? ownFloor?.rotDeg ?? 0, -180, 180);
  if (request.at === "wall_cm") return { error: "no_wall", notes };
  if (request.at === "left_of" || request.at === "right_of") {
    if (ref?.surface !== "floor") return { error: "ref_not_placed", notes };
    const along = widthDirection(ref.rotDeg);
    const distance = (side * (refWidth + size.widthM)) / 2;
    return {
      place: {
        surface: "floor",
        xM: ref.xM + along.x * distance,
        forwardM: ref.forwardM + along.f * distance,
        rotDeg: request.rotateDeg === undefined ? ref.rotDeg : rotDeg,
      },
      notes,
    };
  }
  if (request.at === "photo_x") {
    const imageX = clamp(request.photoX ?? 0.5, 0, 1);
    // Without photoY: the column's spot where the base is in the photo (floorRow).
    const point =
      request.photoY === undefined
        ? floorRow(target.frame, [size], imageX)[0]
        : floorPointAtImage(target.frame, imageX, clamp(request.photoY, 0, 1));
    if (!point) return { error: "outside_photo", notes };
    const along = widthDirection(rotDeg);
    const shift = alignShift(request.align, size.widthM);
    return {
      place: { surface: "floor", xM: point.xM + along.x * shift, forwardM: point.forwardM + along.f * shift, rotDeg },
      notes,
    };
  }
  // free / floor: where it stands (or the default spot), turned as asked.
  const base = ownFloor ?? (defaultPlace(target, size) as Extract<LayoutPlaceView, { surface: "floor" }>);
  return { place: { ...base, rotDeg }, notes };
}

/**
 * Length of the free stretch of wall a placed cabinet stands in: from its
 * left neighbour (or the wall's end) to its right one. null off the wall.
 */
export function gapAround(
  layout: LayoutState,
  target: LayoutTarget,
  sizes: ReadonlyMap<string, DesignSize>,
  designId: string,
): number | null {
  if (target.surface !== "wall") return null;
  const own = layout.items.find((item) => item.designId === designId)?.place;
  if (own?.surface !== "wall") return null;
  let left = target.bounds.fromM;
  let right = target.bounds.toM;
  for (const item of layout.items) {
    if (item.designId === designId || item.place?.surface !== "wall") continue;
    const half = (sizes.get(item.designId)?.widthM ?? 0) / 2;
    if (item.place.alongM < own.alongM) left = Math.max(left, item.place.alongM + half);
    else right = Math.min(right, item.place.alongM - half);
  }
  return right - left;
}
