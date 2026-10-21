/**
 * Room measurements for the assistant (CONTRACT v2 §6, plan §5): the
 * visible wall, its free stretches, the ceiling height. Measured here, once
 * the room is ready and after the no-EXIF angle correction (room-fov.ts),
 * from the corrected camera and planes plus the analysis masks and depth.
 *
 * Every value is approximate. The uncertainty band follows where the scale
 * came from; the assistant only ever says "yaklaşık" and the rounded value,
 * and "Sınırda…" when a cabinet's margin is inside the band.
 */
import type { GreyImage } from "./png.server";
import { usableFloor } from "./room-fov";
import {
  alongToFloor,
  floorFrame,
  floorToCamera,
  visibleWallRange,
  wallLine,
  type FloorFrame,
  type WallLine,
} from "./room-layout";
import type { RoomCamera, RoomPlanes, ScaleSource, Vector4 } from "./room.server";

export interface MetreRange {
  fromM: number;
  toM: number;
}

export interface RoomMeasures {
  /** Visible wall along the wall line (alongM, room-layout); null without a usable wall. */
  wall: MetreRange | null;
  /** Stretches of the visible wall with nothing in front of them in the photo. Information only. */
  free: MetreRange[];
  /** Floor to ceiling; null when too little ceiling is in the photo. */
  ceilingM: number | null;
  cameraHeightM: number | null;
  wallDistanceM: number | null;
}

/** ± share of a measurement, by where the scale came from (exif/user 10 %, 1.4 m guess 20 %, 26 mm 25 %). */
export function measureBand(source: ScaleSource | string | null): number {
  if (source === "exif" || source === "user") return 0.1;
  if (source === "hand_height") return 0.2;
  return 0.25;
}

/** What the assistant says about one cabinet against a length. */
export type FitWord = "rahat" | "sınırda" | "sığmaz";

/**
 * "rahat" when the margin is larger than the band, "sığmaz" when the
 * cabinet is longer by more than the band, "sınırda" in between.
 */
export function fitFor(availableM: number, cabinetM: number, band: number): FitWord {
  const margin = availableM - cabinetM;
  const uncertainty = availableM * band;
  if (margin >= uncertainty) return "rahat";
  if (margin >= -uncertainty) return "sınırda";
  return "sığmaz";
}

/** The sentence the assistant must use for a "sınırda" fit. */
export const TIGHT_FIT_SENTENCE = "Sınırda, almadan önce duvarı ölçmeni öneririm.";

/** Centimetres rounded to 10, the only precision the assistant may use. */
export function roundedCm(metres: number): number {
  return Math.round((metres * 100) / 10) * 10;
}

/** Fewer ceiling pixels than this share of the photo: no ceiling height. */
const MIN_CEILING_SHARE = 0.02;
/** Every n-th pixel in both directions is enough for a median. */
const SAMPLE_STEP = 4;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Floor-to-ceiling height: the median height above the floor plane of the
 * ceiling pixels. Depth is planar z (metres); a pixel (u, v) at depth z is
 * x = (u − cx) / fx · z, y = (v − cy) / fy · z (analysis axes, y down), and
 * its height is a·x + b·y + c·z + d for the floor plane (normal up).
 */
export function ceilingHeightM(input: {
  width: number;
  height: number;
  camera: RoomCamera;
  floor: Vector4 | undefined;
  depth: GreyImage;
  depthScale: { min: number; max: number };
  ceiling: GreyImage;
}): number | null {
  const { width, height, camera, floor, depth, depthScale, ceiling } = input;
  if (!floor || !usableFloor(floor)) return null;
  const [a, b, c, d] = floor;
  const range = depthScale.max - depthScale.min;
  const heights: number[] = [];
  let sampled = 0;
  for (let row = 0; row < ceiling.height; row += SAMPLE_STEP) {
    for (let column = 0; column < ceiling.width; column += SAMPLE_STEP) {
      sampled += 1;
      if (ceiling.values[row * ceiling.width + column] < 128) continue;
      // Pixel centre in the analysis image, then in the depth map.
      const u = ((column + 0.5) * width) / ceiling.width;
      const v = ((row + 0.5) * height) / ceiling.height;
      const depthColumn = Math.min(depth.width - 1, Math.floor((u * depth.width) / width));
      const depthRow = Math.min(depth.height - 1, Math.floor((v * depth.height) / height));
      const z = depthScale.min + (depth.values[depthRow * depth.width + depthColumn] / 65535) * range;
      const x = ((u - camera.cx) / camera.fx) * z;
      const y = ((v - camera.cy) / camera.fy) * z;
      heights.push(a * x + b * y + c * z + d);
    }
  }
  if (!sampled || heights.length / sampled < MIN_CEILING_SHARE) return null;
  const value = median(heights);
  // Lower than the camera or higher than any room: the mask was wrong.
  return value !== null && value > d && value < 10 ? value : null;
}

/* ---------------- the wall ---------------- */

/** Points along the wall that are looked at in the depth map and the masks. */
const WALL_SAMPLES = 64;
/** A free stretch shorter than this is not worth mentioning. */
const MIN_FREE_M = 0.3;
/** Measured depth within this share of the wall plane's depth: the pixel is this wall. */
const SAME_WALL_DEPTH = 0.15;
/** The wall is checked between these heights above the floor, above most furniture. */
const WALL_BAND_M = [1, 2] as const;
/** Share of that band at the wall's depth for a column to show this wall. */
const MIN_WALL_SHARE = 0.4;

/** Pixel lookup in a mask or depth map that may have another size than the photo. */
function valueAt(image: GreyImage, u: number, v: number, width: number, height: number): number {
  const column = Math.min(image.width - 1, Math.max(0, Math.floor((u * image.width) / width)));
  const row = Math.min(image.height - 1, Math.max(0, Math.floor((v * image.height) / height)));
  return image.values[row * image.width + column];
}

/** Photo pixel of a point on the wall line, `upM` above the floor; null behind the camera. */
function wallPixel(frame: FloorFrame, line: WallLine, alongM: number, upM: number) {
  const floor = alongToFloor(line, alongM);
  const [x, y, z] = floorToCamera(frame, floor.xM, upM, floor.forwardM);
  if (-z <= 0.05) return null;
  return {
    u: frame.width / 2 + (frame.focalPx * x) / -z,
    v: frame.height / 2 - (frame.focalPx * y) / -z,
  };
}

interface WallImages {
  depth: GreyImage | null;
  depthScale: { min: number; max: number };
  furniture: GreyImage | null;
}

/**
 * Looks at the photo where the wall stands at one point along it:
 * - `wall`: share of the wall between 1 m and 2 m above the floor whose
 *   measured depth is this wall's depth (past a corner the photo shows a
 *   closer side wall or a farther room, so the share drops); null when that
 *   band is outside the photo or there is no depth map,
 * - `furniture`: share of the first metre above the floor hidden by furniture.
 */
function wallColumn(
  input: { width: number; height: number; camera: RoomCamera; wall: Vector4 },
  images: WallImages,
  frame: FloorFrame,
  line: WallLine,
  alongM: number,
): { wall: number | null; furniture: number } | null {
  const { camera, width, height } = input;
  const foot = wallPixel(frame, line, alongM, 0);
  const low = wallPixel(frame, line, alongM, WALL_BAND_M[0]);
  const high = wallPixel(frame, line, alongM, WALL_BAND_M[1]);
  if (!foot || !low || !high || foot.u < 0 || foot.u >= width) return null;

  let matching = 0;
  let checked = 0;
  if (images.depth) {
    const [a, b, c, d] = input.wall;
    const range = images.depthScale.max - images.depthScale.min;
    for (let v = Math.max(0, Math.ceil(high.v)); v <= Math.min(height - 1, Math.floor(low.v)); v += 1) {
      // The wall may lean in the photo: follow it from the band's top to its bottom.
      const u = high.u + ((low.u - high.u) * (v - high.v)) / (low.v - high.v || 1);
      if (u < 0 || u >= width) continue;
      checked += 1;
      // Depth the wall plane has at this pixel (analysis axes), against the measured one.
      const denominator = (a * (u - camera.cx)) / camera.fx + (b * (v - camera.cy)) / camera.fy + c;
      const planeZ = Math.abs(denominator) < 1e-9 ? -1 : -d / denominator;
      const measured = images.depthScale.min + (valueAt(images.depth, u, v, width, height) / 65535) * range;
      if (planeZ > 0 && Math.abs(measured - planeZ) <= SAME_WALL_DEPTH * planeZ) matching += 1;
    }
  }

  let furniturePixels = 0;
  let windowPixels = 0;
  if (images.furniture) {
    for (let v = Math.max(0, Math.floor(low.v)); v <= Math.min(height - 1, Math.floor(foot.v)); v += 1) {
      windowPixels += 1;
      if (valueAt(images.furniture, foot.u, v, width, height) >= 128) furniturePixels += 1;
    }
  }
  return {
    wall: checked ? matching / checked : null,
    furniture: windowPixels ? furniturePixels / windowPixels : 0,
  };
}

/**
 * The longest run of samples showing this wall, one missing sample allowed
 * (a picture frame, noise). A wall seen from the side can match again far
 * away by chance; that stray stretch is not part of it.
 */
function longestWallRun<T extends { index: number }>(seen: readonly T[]): T[] {
  let best: T[] = [];
  let current: T[] = [];
  for (const sample of seen) {
    const previous = current[current.length - 1];
    current = previous && sample.index - previous.index <= 2 ? [...current, sample] : [sample];
    if (current.length > best.length) best = current;
  }
  return best;
}

/**
 * The visible wall (alongM, room-layout wallFrame) and its free stretches.
 * Geometry gives where the wall line crosses the photo (a wall seen from
 * the side runs to the horizon there); the depth map trims it to where this
 * wall really is; the furniture mask marks what stands in front of it.
 * Without a depth map the geometry stays.
 */
export function measureWall(
  input: { width: number; height: number; camera: RoomCamera; planes: RoomPlanes },
  images: WallImages,
): { wall: MetreRange | null; free: MetreRange[] } {
  const frame = floorFrame(input);
  const line = frame ? wallLine(input, frame) : null;
  const range = frame && line ? visibleWallRange(frame, line) : null;
  const wallEquation = input.planes.wall?.equation;
  if (!frame || !line || !range || !wallEquation) return { wall: null, free: [] };

  const step = (range.toM - range.fromM) / WALL_SAMPLES;
  const samples: Array<{ index: number; alongM: number; wall: number | null; furniture: number }> = [];
  for (let index = 0; index < WALL_SAMPLES; index += 1) {
    const alongM = range.fromM + (index + 0.5) * step;
    const column = wallColumn({ ...input, wall: wallEquation }, images, frame, line, alongM);
    if (column) samples.push({ index, alongM, ...column });
  }

  const run = longestWallRun(samples.filter((sample) => sample.wall !== null && sample.wall >= MIN_WALL_SHARE));
  const wall =
    run.length >= 2
      ? {
          fromM: Math.max(range.fromM, run[0].alongM - step / 2),
          toM: Math.min(range.toM, run[run.length - 1].alongM + step / 2),
        }
      : range;

  const free: MetreRange[] = [];
  if (images.furniture) {
    let open: MetreRange | null = null;
    for (const sample of samples) {
      const inside = sample.alongM >= wall.fromM && sample.alongM <= wall.toM;
      if (inside && sample.furniture < 0.2) {
        const from = Math.max(wall.fromM, sample.alongM - step / 2);
        const to = Math.min(wall.toM, sample.alongM + step / 2);
        open = open ? { fromM: open.fromM, toM: to } : { fromM: from, toM: to };
        continue;
      }
      if (open && open.toM - open.fromM >= MIN_FREE_M) free.push(open);
      open = null;
    }
    if (open && open.toM - open.fromM >= MIN_FREE_M) free.push(open);
  }
  return { wall, free };
}

/** Everything the assistant is told about a ready room, from the corrected analysis. */
export function measureRoom(
  input: {
    width: number;
    height: number;
    camera: RoomCamera;
    planes: RoomPlanes;
    depthScale: { min: number; max: number };
  },
  images: { depth: GreyImage | null; furniture: GreyImage | null; ceiling: GreyImage | null },
): RoomMeasures {
  const { wall, free } = measureWall(input, { ...images, depthScale: input.depthScale });
  const floor = input.planes.floor?.equation;
  const usable = floor && usableFloor(floor) ? floor : undefined;
  return {
    wall,
    free,
    ceilingM:
      images.depth && images.ceiling
        ? ceilingHeightM({ ...input, floor: usable, depth: images.depth, ceiling: images.ceiling })
        : null,
    cameraHeightM: usable ? usable[3] : null,
    wallDistanceM: input.planes.wall ? Math.abs(input.planes.wall.equation[3]) : null,
  };
}

/* ---------------- stored measurements ---------------- */

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRange(raw: unknown): MetreRange | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const fromM = finite(row?.fromM);
  const toM = finite(row?.toM);
  return fromM !== null && toM !== null && toM > fromM ? { fromM, toM } : null;
}

/** KoshoyRoom.measures → RoomMeasures; null when missing or unreadable. */
export function parseMeasures(raw: string | null): RoomMeasures | null {
  if (!raw) return null;
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!row || typeof row !== "object") return null;
  return {
    wall: toRange(row.wall),
    free: Array.isArray(row.free)
      ? row.free.map(toRange).filter((range): range is MetreRange => range !== null)
      : [],
    ceilingM: finite(row.ceilingM),
    cameraHeightM: finite(row.cameraHeightM),
    wallDistanceM: finite(row.wallDistanceM),
  };
}

/* ---------------- what the assistant gets ---------------- */

const metresOf = (cm: number) => cm / 100;

/**
 * The room block of the model instructions: rounded values only, in cm and
 * in m (the reply guard reads "3,4 m" as 3.4), positions from the left end
 * of the visible wall, and for each design whether it fits the visible
 * wall ("rahat" / "sınırda" / "sığmaz").
 */
export function roomFactsForModel(
  measures: RoomMeasures,
  source: ScaleSource | string | null,
  designs: ReadonlyArray<{ id: string; label: string; widthM: number }>,
): Record<string, unknown> {
  const band = measureBand(source);
  const facts: Record<string, unknown> = { uncertaintyPercent: Math.round(band * 100) };
  const wall = measures.wall;
  if (wall) {
    const wallCm = roundedCm(wall.toM - wall.fromM);
    facts.visibleWallCm = wallCm;
    facts.visibleWallM = metresOf(wallCm);
    facts.freeStretches = measures.free.map((range) => {
      const widthCm = roundedCm(range.toM - range.fromM);
      return {
        fromCm: roundedCm(range.fromM - wall.fromM),
        toCm: roundedCm(range.toM - wall.fromM),
        widthCm,
        widthM: metresOf(widthCm),
      };
    });
    facts.designs = designs.map((design) => ({
      designId: design.id,
      label: design.label,
      visibleWall: fitFor(wall.toM - wall.fromM, design.widthM, band),
    }));
  } else {
    facts.wall = "Fotoğrafta duvar bulunamadı; tasarımlar zeminde serbest durur.";
  }
  if (measures.ceilingM !== null) {
    const ceilingCm = roundedCm(measures.ceilingM);
    facts.ceilingCm = ceilingCm;
    facts.ceilingM = metresOf(ceilingCm);
  }
  return facts;
}
