// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/room-layout/wallRow.ts

import type { WallBounds } from "./types";

// Duvar boyunca cabin'ler: 1B aralıklar. Cabin [ortası − genişlik/2, ortası + genişlik/2] aralığını kaplar.
// Değmek serbest, üst üste binmek değil. Fotoğraftaki eşya engel değil (Fatih, 21 Ekim).

/** Duvarda bir cabin: ortası ve genişliği, metre. */
export type WallSpan = { centerM: number; widthM: number };

const EPS = 1e-6;

/**
 * `widthM` genişliğindeki cabin için `wantedM`'e en yakın orta: duvarın içinde ve `taken`
 * cabin'lerine binmeden. Hiç yer yoksa null.
 */
export function nearestFreeSpot(
  bounds: WallBounds,
  taken: readonly WallSpan[],
  widthM: number,
  wantedM: number,
): number | null {
  const half = widthM / 2;
  const occupied = taken
    .map((s) => [s.centerM - s.widthM / 2, s.centerM + s.widthM / 2])
    .sort((a, b) => a[0] - b[0]);
  // Boşluklar: duvarın başı → ilk cabin, cabin'ler arası, son cabin → duvarın sonu.
  const gaps: number[][] = [];
  let cursor = bounds.fromM;
  for (const [start, end] of occupied) {
    gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  gaps.push([cursor, bounds.toM]);

  let best: number | null = null;
  for (const [start, end] of gaps) {
    // Duvarın dışındaki cabin'lerin arası duvar sayılmaz: boşluk duvar uçlarına kırpılır.
    const lo = Math.max(start, bounds.fromM) + half;
    const hi = Math.min(end, bounds.toM) - half;
    if (hi < lo - EPS) continue;
    const center = Math.min(Math.max(wantedM, lo), Math.max(lo, hi));
    if (best === null || Math.abs(center - wantedM) < Math.abs(best - wantedM)) best = center;
  }
  return best;
}

/** Duvar sırasındaki bir cabin; `centerM: null` = duvarda değil. */
export type RowItem = { id: string; widthM: number; centerM: number | null };

/**
 * Üst üste binmeleri en az kaydırmayla giderir, sırayı korur, hepsini duvarın içine alır.
 * Sığmıyorlarsa listenin sonundakiler (en son eklenenler) önce çıkar: `centerM: null`.
 * Çıktı girdiyle aynı sırada. `centerM: null` olanlar null kalır.
 *
 * Yöntem: soldan sağa sıralı cabin'lerin sol kenarları x_i için x_{i+1} ≥ x_i + w_i.
 * y_i = x_i − (soldakilerin genişlik toplamı) ile bu "y artmayan olmasın" kuralına döner;
 * en küçük kareler çözümü PAV (pool adjacent violators) ile bulunur, sonra duvara kırpılır.
 */
export function settleRow(bounds: WallBounds, items: readonly RowItem[]): RowItem[] {
  const length = bounds.toM - bounds.fromM;
  const kept = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (item.centerM === null || item.widthM <= 0) continue;
    if (total + item.widthM > length + EPS) continue;
    kept.add(item.id);
    total += item.widthM;
  }

  const row = items
    .filter((item) => kept.has(item.id))
    .map((item, order) => ({ item, order }))
    .sort((a, b) => a.item.centerM! - b.item.centerM! || a.order - b.order)
    .map(({ item }) => item);

  // Hedef: y_i = istenen sol kenar − soldakilerin genişliği.
  const targets: number[] = [];
  let leftWidths = 0;
  for (const item of row) {
    targets.push(item.centerM! - item.widthM / 2 - leftWidths);
    leftWidths += item.widthM;
  }
  const ys = poolAdjacentViolators(targets).map((y) =>
    Math.min(Math.max(y, bounds.fromM), bounds.toM - total),
  );

  const centers = new Map<string, number>();
  leftWidths = 0;
  row.forEach((item, i) => {
    centers.set(item.id, ys[i] + leftWidths + item.widthM / 2);
    leftWidths += item.widthM;
  });
  return items.map((item) => ({ ...item, centerM: centers.get(item.id) ?? null }));
}

/** Artmayan olmayan (azalmayan) en yakın dizi, eşit ağırlık. */
function poolAdjacentViolators(values: readonly number[]): number[] {
  const blocks: { sum: number; count: number }[] = [];
  for (const value of values) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.count <= last.sum / last.count) break;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  }
  return blocks.flatMap((block) => Array(block.count).fill(block.sum / block.count));
}
