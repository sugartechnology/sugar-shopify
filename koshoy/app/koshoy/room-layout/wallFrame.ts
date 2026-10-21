// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/room-layout/wallFrame.ts

import type { WallBounds } from "./types";

// Oda analizinden zemin çerçevesi ve duvar çizgisi. Saf matematik: 3B (roomPhotoGeometry) ve
// Koshoy backend'i (ölçüler, LLM yerleşimi) aynı sonucu bulsun diye tek yer.
//
// Analiz ekseni (x sağ, y aşağı, z ileri) → kamera ekseni (x sağ, y yukarı, −z ileri): (x, −y, −z).
// Zemin çerçevesi: zemin y = 0, kamera (0, h, 0); xM kameranın sağı, forwardM bakışı (zemine izdüşüm).
// Kamera 3B'deki gibi: dikey açıdan tek odak uzaklığı, resim merkezi ortada.

type Vec3 = [number, number, number];
type Equation = [number, number, number, number];

/** Analiz sonucundan gereken alanlar (RoomView / KoshoyRoomInput ile aynı adlar). */
export type WallFrameInput = {
  width: number;
  height: number;
  camera: { fovYDegrees: number };
  planes?: { floor?: { equation: Equation }; wall?: { equation: Equation } };
};

export type FloorFrame = {
  /** Kameranın zeminden yüksekliği (metre). */
  cameraHeightM: number;
  /** Zemin çerçevesinin eksenleri, kamera ekseninde: xM, yukarı, forwardM. */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** Piksel cinsinden odak uzaklığı ve resim boyutu. */
  focalPx: number;
  width: number;
  height: number;
};

/** Duvarın zemine değdiği çizgi, zemin çerçevesinde. */
export type WallLine = {
  /** alongM = 0: kameranın altındaki noktadan çizgiye inen dikin ayağı. */
  origin: { xM: number; forwardM: number };
  /** +alongM yönü (fotoğrafta sağ), birim. */
  along: { x: number; f: number };
  /** Duvardan odaya (kameraya) bakan yön, birim. */
  normal: { x: number; f: number };
  /** Duvara yaslı cabin'in dönüşü (`LayoutPlace.floor.rotDeg` anlamında): önü odaya. */
  rotDeg: number;
};

/** Zemin kameranın en az bu kadar altında olmalı; değilse bulunan düzlem zemin değil (ör. masa üstü). */
export const MIN_CAMERA_HEIGHT_M = 0.3;
/** Duvar normalinin yukarı bileşeni en çok bu kadar (dikeyden ~20°); değilse duvar sayılmaz. */
export const MAX_WALL_NORMAL_UP = 0.35;
/**
 * Duvar kameraya en çok bu açıyla bakmalı (normali ile bakış yönünün tersi arasında); değilse yan duvardır,
 * oda zemin hedefi olur (sözleşme v2.1-3).
 */
export const MAX_WALL_VIEW_ANGLE_DEG = 65;
/** Görünen duvar en çok bu kadar uzun sayılır; fazlası kameradan uzak taraftan kırpılır (v2.1-3). */
export const MAX_VISIBLE_WALL_M = 8;
/** Varsayılan zemin noktası kameranın önünde en çok bu kadar uzakta; uzaksa ışın boyunca çekilir (v2.1-4). */
export const MAX_DEFAULT_FLOOR_M = 4;
/** Zemindeki dizilimin tabanları fotoğrafın kenarlarından en az bu kadar içeride (resmin oranı, v2.2-5). */
export const FLOOR_ROW_MARGIN = 0.04;
/** Tabanlar kadraja girsin diye dizilim en çok bu kadar uzağa itilir (v2.2-5). */
export const MAX_FLOOR_ROW_M = 8;
const FLOOR_ROW_STEP_M = 0.05;
/** Görünen duvar en çok bu kadar uzağa uzar (ufka yakın çizgi). */
const MAX_WALL_M = 50;
const NEAR_M = 0.05;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Analiz düzlemi → kamera ekseni, birim normal, kamera pozitif tarafta. */
export function cameraPlane(equation: Equation): { normal: Vec3; constant: number } {
  const [a, b, c, d] = equation;
  const length = Math.hypot(a, b, c);
  let normal: Vec3 = [a / length, -b / length, -c / length];
  let constant = d / length;
  if (constant < 0) {
    normal = scale(normal, -1);
    constant = -constant;
  }
  return { normal, constant };
}

/**
 * Zemin çerçevesi. Kullanılabilir zemin yoksa null: zemin kameranın en az 30 cm altında olmalı
 * ve resimde yukarı bakmalı (3B öğesinde `no_floor`).
 */
export function floorFrame(input: WallFrameInput): FloorFrame | null {
  const floor = input.planes?.floor;
  if (!floor) return null;
  const { normal: up, constant: height } = cameraPlane(floor.equation);
  if (height < MIN_CAMERA_HEIGHT_M || up[1] <= 0) return null;
  // Kamera dümdüz aşağı bakıyorsa bakış zemine izdüşmez; o zaman kameranın yukarısı ileri sayılır.
  const onFloor = (v: Vec3) => sub(v, scale(up, dot(v, up)));
  let forward = onFloor([0, 0, -1]);
  if (Math.hypot(...forward) < 1e-3) forward = onFloor([0, 1, 0]);
  forward = normalize(forward);
  const right = normalize(cross(forward, up));
  const focalPx = input.height / 2 / Math.tan((input.camera.fovYDegrees * Math.PI) / 360);
  return { cameraHeightM: height, right, up, forward, focalPx, width: input.width, height: input.height };
}

/** Zemin çerçevesindeki nokta (yukarı = upM) → kamera ekseni. */
export function floorToCamera(frame: FloorFrame, xM: number, upM: number, forwardM: number): Vec3 {
  return [0, 1, 2].map(
    (i) =>
      frame.right[i] * xM + frame.up[i] * (upM - frame.cameraHeightM) + frame.forward[i] * forwardM,
  ) as Vec3;
}

/**
 * Kullanılabilir duvarın çizgisi. Duvar yoksa, dikeye yakın değilse (tezgâh, tavan), kameraya
 * 65°'den eğik bakıyorsa (yan duvar) ya da kamera duvarın arkasında kalıyorsa null.
 */
export function wallLine(input: WallFrameInput, frame: FloorFrame): WallLine | null {
  const wall = input.planes?.wall;
  if (!wall) return null;
  const plane = cameraPlane(wall.equation);
  // Zemin çerçevesinde: n · (x, y − h, f) + d = 0.
  const nx = dot(plane.normal, frame.right);
  const ny = dot(plane.normal, frame.up);
  const nf = dot(plane.normal, frame.forward);
  if (Math.abs(ny) > MAX_WALL_NORMAL_UP) return null;
  const horizontal = Math.hypot(nx, nf);
  // y = 0'da: (nx, nf)/L · (x, f) + c = 0; c > 0 → kameranın altındaki nokta duvarın önünde.
  const c = (plane.constant - ny * frame.cameraHeightM) / horizontal;
  if (c <= 0) return null;
  const normal = { x: nx / horizontal, f: nf / horizontal };
  // Normal ile kameranın bakışının tersi (−forward) arasındaki açı.
  if (-normal.f < Math.cos((MAX_WALL_VIEW_ANGLE_DEG * Math.PI) / 180)) return null;
  const rotDeg = (Math.atan2(normal.x, -normal.f) * 180) / Math.PI;
  const r = (rotDeg * Math.PI) / 180;
  return {
    origin: { xM: -normal.x * c, forwardM: -normal.f * c },
    along: { x: Math.cos(r), f: Math.sin(r) },
    normal,
    rotDeg,
  };
}

/** Duvar boyunca metre → zemin çerçevesi. */
export function alongToFloor(line: WallLine, alongM: number): { xM: number; forwardM: number } {
  return {
    xM: line.origin.xM + line.along.x * alongM,
    forwardM: line.origin.forwardM + line.along.f * alongM,
  };
}

/** Zemindeki nokta → duvar boyunca metre (çizgiye izdüşüm). */
export function floorToAlong(line: WallLine, xM: number, forwardM: number): number {
  return (xM - line.origin.xM) * line.along.x + (forwardM - line.origin.forwardM) * line.along.f;
}

/** Fotoğrafta yatay konum (0 sol – 1 sağ) → o sütunda duvarın dibi, alongM. Kameranın arkasındaysa null. */
export function imageXToAlong(frame: FloorFrame, line: WallLine, imageX: number): number | null {
  // Sütun düzlemi kamera merkezinden geçer: x + z · (u − w/2) / f = 0.
  const column: Vec3 = [1, 0, ((imageX - 0.5) * frame.width) / frame.focalPx];
  const p0 = floorToCamera(frame, line.origin.xM, 0, line.origin.forwardM);
  const p1 = floorToCamera(frame, line.origin.xM + line.along.x, 0, line.origin.forwardM + line.along.f);
  const direction = sub(p1, p0);
  const denominator = dot(column, direction);
  if (Math.abs(denominator) < 1e-9) return null;
  const alongM = -dot(column, p0) / denominator;
  const depth = -(p0[2] + direction[2] * alongM);
  return depth > NEAR_M ? alongM : null;
}

/** alongM → fotoğrafta yatay konum (0 sol – 1 sağ). Kameranın arkasındaysa null. */
export function alongToImageX(frame: FloorFrame, line: WallLine, alongM: number): number | null {
  const p = alongToFloor(line, alongM);
  const c = floorToCamera(frame, p.xM, 0, p.forwardM);
  if (-c[2] <= NEAR_M) return null;
  return 0.5 + (frame.focalPx * c[0]) / -c[2] / frame.width;
}

/**
 * Fotoğrafta görünen duvar: duvarın dibi kameranın önünde ve resmin sol–sağ kenarları arasında.
 * Dip resmin altında kalsa da sütun görünür sayılır (cabin'in altı kesilir). En çok 8 m: daha uzunsa
 * kameraya en yakın görünen noktanın çevresi kalır. Görünmüyorsa null. Backend maskelerle daraltabilir
 * (`RoomView.wall`).
 */
export function visibleWallRange(frame: FloorFrame, line: WallLine): WallBounds | null {
  const p0 = floorToCamera(frame, line.origin.xM, 0, line.origin.forwardM);
  const p1 = floorToCamera(frame, line.origin.xM + line.along.x, 0, line.origin.forwardM + line.along.f);
  const d = sub(p1, p0);
  const half = frame.width / 2;
  // Derinlik s = −z. Koşullar a cinsinden doğrusal: α + β·a ≥ 0.
  const conditions: [number, number][] = [
    [-p0[2] - NEAR_M, -d[2]], // önünde
    [half * -p0[2] + frame.focalPx * p0[0], half * -d[2] + frame.focalPx * d[0]], // u ≥ 0
    [half * -p0[2] - frame.focalPx * p0[0], half * -d[2] - frame.focalPx * d[0]], // u ≤ w
  ];
  let from = -MAX_WALL_M;
  let to = MAX_WALL_M;
  for (const [alpha, beta] of conditions) {
    if (Math.abs(beta) < 1e-12) {
      if (alpha < 0) return null;
    } else if (beta > 0) {
      from = Math.max(from, -alpha / beta);
    } else {
      to = Math.min(to, -alpha / beta);
    }
  }
  if (to <= from) return null;
  if (to - from > MAX_VISIBLE_WALL_M) {
    // Kameraya en yakın görünen nokta (alongM = 0'a en yakın) çevresinde 8 m: uzak uç ufka uzanır,
    // orada derinlik tutmaz.
    const nearest = Math.min(Math.max(0, from), to);
    const start = Math.min(Math.max(nearest - MAX_VISIBLE_WALL_M / 2, from), to - MAX_VISIBLE_WALL_M);
    return { fromM: start, toM: start + MAX_VISIBLE_WALL_M };
  }
  return { fromM: from, toM: to };
}

/** Zemindeki nokta → fotoğraf (x 0 sol – 1 sağ, y 0 üst – 1 alt). Kameranın arkasındaysa null. */
export function floorToImage(frame: FloorFrame, xM: number, forwardM: number): { x: number; y: number } | null {
  const c = floorToCamera(frame, xM, 0, forwardM);
  if (-c[2] <= NEAR_M) return null;
  return {
    x: 0.5 + (frame.focalPx * c[0]) / -c[2] / frame.width,
    y: 0.5 - (frame.focalPx * c[1]) / -c[2] / frame.height,
  };
}

/** Zeminde yan yana duracak bir cabin'in tabanı (metre). */
export type FloorSize = { widthM: number; depthM: number };

/**
 * Zemindeki ilk dizilim (v2.2-5): cabin'ler verilen sırayla soldan sağa yan yana (birbirine değerek),
 * önleri kameraya (rotDeg 0); her birinin taban ortası döner. Duvardan zemine geçişte alongM sırasıyla verilir.
 * - Sıranın ortası fotoğrafın (imageX, imageY) noktasından geçen ışının zemine değdiği yer; 4 m'den
 *   uzaksa (ya da ışın zemine düşmüyorsa) ışın boyunca 4 m.
 * - Tabanlar kadraja girene kadar (alt kenarın biraz üstü, yanlar içeride) ışın yönünde ileri alınır,
 *   en çok 8 m. Hiç sığmıyorsa tabanların alt kenarın üstünde kaldığı ilk uzaklık.
 * 3B ve backend aynı yeri bulsun diye tek yer.
 */
export function floorRow(
  frame: FloorFrame,
  sizes: readonly FloorSize[],
  imageX = 0.5,
  imageY = 0.7,
): { xM: number; forwardM: number }[] {
  // Kamera ekseninde ışın; zemindeki yönü ve zemine değdiği uzaklık.
  const ray: Vec3 = [
    ((imageX - 0.5) * frame.width) / frame.focalPx,
    -((imageY - 0.5) * frame.height) / frame.focalPx,
    -1,
  ];
  const x = dot(ray, frame.right);
  const f = dot(ray, frame.forward);
  const length = Math.hypot(x, f);
  const direction = f > 1e-9 ? { x: x / length, f: f / length } : { x: 0, f: 1 };
  const down = dot(ray, frame.up);
  const hitM = down < -1e-9 ? (frame.cameraHeightM / -down) * length : Infinity;
  const startM = Math.min(hitM, MAX_DEFAULT_FLOOR_M);

  const totalM = sizes.reduce((sum, size) => sum + size.widthM, 0);
  const rowAt = (distanceM: number) => {
    let left = direction.x * distanceM - totalM / 2;
    return sizes.map((size) => {
      const center = { xM: left + size.widthM / 2, forwardM: direction.f * distanceM };
      left += size.widthM;
      return center;
    });
  };
  // Tabanların dört köşesi fotoğrafta (rotDeg 0: genişlik xM boyunca, derinlik forwardM boyunca).
  const corners = (distanceM: number) =>
    rowAt(distanceM).flatMap((center, i) => {
      const { widthM, depthM } = sizes[i];
      return [-0.5, 0.5].flatMap((sw) =>
        [-0.5, 0.5].map((sd) => floorToImage(frame, center.xM + sw * widthM, center.forwardM + sd * depthM)),
      );
    });
  const m = FLOOR_ROW_MARGIN;
  const aboveBottom = (distanceM: number) => corners(distanceM).every((p) => p !== null && p.y <= 1 - m);
  const inside = (distanceM: number) =>
    corners(distanceM).every((p) => p !== null && p.x >= m && p.x <= 1 - m && p.y >= m && p.y <= 1 - m);

  let distanceM = startM;
  while (distanceM < MAX_FLOOR_ROW_M && !aboveBottom(distanceM)) distanceM += FLOOR_ROW_STEP_M;
  for (let d = distanceM; d <= MAX_FLOOR_ROW_M; d += FLOOR_ROW_STEP_M) {
    if (inside(d)) return rowAt(d);
  }
  return rowAt(distanceM);
}

/**
 * Varsayılan zemin noktası (yeni cabin, duvar yokken): `floorRow` tek noktalık sırayla, yani fotoğraftaki
 * noktadan (orta sütun, yukarıdan %70) geçen ışının zemine değdiği yer, en çok 4 m (ışın boyunca),
 * fotoğrafın içinde (v2.1-4, v2.2-5). Cabin'in boyu biliniyorsa `floorRow` kullanılmalı.
 */
export function defaultFloorPoint(
  frame: FloorFrame,
  imageX = 0.5,
  imageY = 0.7,
): { xM: number; forwardM: number } {
  return floorRow(frame, [{ widthM: 0, depthM: 0 }], imageX, imageY)[0];
}

/** Studio'daki virtual wall: x ekseni, cabin'ler arkası z = 0'da, önü kameraya (+z). alongM = x. */
export const STUDIO_WALL_LINE: WallLine = {
  origin: { xM: 0, forwardM: 0 },
  along: { x: 1, f: 0 },
  normal: { x: 0, f: -1 },
  rotDeg: 0,
};
