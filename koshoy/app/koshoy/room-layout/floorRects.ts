// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/room-layout/floorRects.ts

// Zemindeki cabin'ler: döndürülmüş dikdörtgenler (yukarıdan bakış), zemin çerçevesinde (xM, forwardM).
// Duvar bulunamayan odada cabin zeminde serbest durur ve döner (Fatih, 21 Ekim).

/** Cabin tabanı: ortası, dönüşü (`LayoutPlace.floor` ile aynı anlam), genişliği ve derinliği. */
export type FloorRect = {
  xM: number;
  forwardM: number;
  rotDeg: number;
  widthM: number;
  depthM: number;
};

/** İsteğe bağlı kullanılabilir zemin (ör. backend'in bildiği görünen zemin). */
export type FloorArea = { minX: number; maxX: number; minForward: number; maxForward: number };

type Point = { x: number; f: number };

const EPS = 1e-6;

/** Cabin'in önünün baktığı yön (rotDeg 0 → kameraya, yani −forward). */
export function frontDirection(rotDeg: number): Point {
  const r = (rotDeg * Math.PI) / 180;
  return { x: Math.sin(r), f: -Math.cos(r) };
}

/** Cabin'in genişlik yönü (önüne bakana göre sağı değil, cabin'in kendi +x'i: rotDeg 0 → +x). */
export function widthDirection(rotDeg: number): Point {
  const r = (rotDeg * Math.PI) / 180;
  return { x: Math.cos(r), f: Math.sin(r) };
}

/** Dört köşe. */
export function rectCorners(rect: FloorRect): Point[] {
  const w = widthDirection(rect.rotDeg);
  const d = frontDirection(rect.rotDeg);
  const corners: Point[] = [];
  for (const sw of [-0.5, 0.5]) {
    for (const sd of [-0.5, 0.5]) {
      corners.push({
        x: rect.xM + w.x * sw * rect.widthM + d.x * sd * rect.depthM,
        f: rect.forwardM + w.f * sw * rect.widthM + d.f * sd * rect.depthM,
      });
    }
  }
  return corners;
}

/** İki taban üst üste biniyor mu (ayırıcı eksen sınaması). Değmek binmek sayılmaz. */
export function rectsOverlap(a: FloorRect, b: FloorRect): boolean {
  const ca = rectCorners(a);
  const cb = rectCorners(b);
  const axes = [
    widthDirection(a.rotDeg),
    frontDirection(a.rotDeg),
    widthDirection(b.rotDeg),
    frontDirection(b.rotDeg),
  ];
  for (const axis of axes) {
    const pa = ca.map((p) => p.x * axis.x + p.f * axis.f);
    const pb = cb.map((p) => p.x * axis.x + p.f * axis.f);
    if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS) {
      return false;
    }
  }
  return true;
}

export function overlapsAny(rect: FloorRect, others: readonly FloorRect[]): boolean {
  return others.some((other) => rectsOverlap(rect, other));
}

function insideArea(rect: FloorRect, area: FloorArea | undefined): boolean {
  if (!area) return true;
  return rectCorners(rect).every(
    (p) =>
      p.x >= area.minX - EPS &&
      p.x <= area.maxX + EPS &&
      p.f >= area.minForward - EPS &&
      p.f <= area.maxForward + EPS,
  );
}

/**
 * `rect`'in istediği yere en yakın boş yer (dönüşü aynı kalır): önce kendisi, sonra büyüyen halkalar
 * üstünde 16 yön. Bulunamazsa null.
 */
export function nearestFreeFloorSpot(
  rect: FloorRect,
  others: readonly FloorRect[],
  area?: FloorArea,
  stepM = 0.1,
  maxRadiusM = 6,
): { xM: number; forwardM: number } | null {
  const fits = (candidate: FloorRect) =>
    insideArea(candidate, area) && !overlapsAny(candidate, others);
  if (fits(rect)) return { xM: rect.xM, forwardM: rect.forwardM };
  for (let radius = stepM; radius <= maxRadiusM + EPS; radius += stepM) {
    for (let k = 0; k < 16; k++) {
      const angle = (k * Math.PI) / 8;
      const candidate = {
        ...rect,
        xM: rect.xM + radius * Math.cos(angle),
        forwardM: rect.forwardM + radius * Math.sin(angle),
      };
      if (fits(candidate)) return { xM: candidate.xM, forwardM: candidate.forwardM };
    }
  }
  return null;
}

/**
 * Yan yana yer: `rect`'in kendi genişlik yönünde sağa / sola adım adım (0, +s, −s, +2s, …) ilk boş yer.
 * Duvarsız odada yeni cabin'ler bir sıra gibi dizilsin, önü arkası birbirini kapatmasın diye.
 * Bulunamazsa null (çağıran `nearestFreeFloorSpot`'a düşebilir).
 */
export function sideBySideFloorSpot(
  rect: FloorRect,
  others: readonly FloorRect[],
  area?: FloorArea,
  stepM = 0.05,
  maxOffsetM = 6,
): { xM: number; forwardM: number } | null {
  const along = widthDirection(rect.rotDeg);
  for (let offset = 0; offset <= maxOffsetM + EPS; offset += stepM) {
    for (const sign of offset === 0 ? [1] : [1, -1]) {
      const candidate = {
        ...rect,
        xM: rect.xM + along.x * offset * sign,
        forwardM: rect.forwardM + along.f * offset * sign,
      };
      if (insideArea(candidate, area) && !overlapsAny(candidate, others)) {
        return { xM: candidate.xM, forwardM: candidate.forwardM };
      }
    }
  }
  return null;
}
