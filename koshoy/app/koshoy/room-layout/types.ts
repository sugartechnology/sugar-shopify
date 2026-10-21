// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/room-layout/types.ts

// Odada çok cabin: yerleşim verisi. Saf veri (three yok, `./` dışında import yok);
// Koshoy backend'i bu klasörü kopyalar (sync-cabinet-core). Sözleşme v2 §6.
//
// Zemin çerçevesi (oda fotoğrafında): başlangıç kameranın altındaki zemin noktası; xM kameranın sağı,
// forwardM kameranın baktığı yön (ikisi de zemine izdüşüm), metre. Studio'da xM sağ, forwardM ekrandan içeri.

/**
 * Bir cabin'in odadaki yeri.
 * - `wall`: arkası duvarda; `alongM` cabin'in ortası, duvar çizgisi boyunca metre
 *   (0 = kameranın zemindeki noktasından duvara inen dikin ayağı, pozitif = fotoğrafta sağ).
 *   Studio'da virtual wall x ekseni, 0 orta. Duvardaki cabin dönmez.
 * - `floor`: kullanılabilir duvar yok; zeminde serbest. (`xM`, `forwardM`) cabin tabanının ortası,
 *   `rotDeg` dikey eksen etrafında dönüş (0 = önü kameraya dönük, pozitif = yukarıdan bakınca saat yönünün tersi).
 */
export type LayoutPlace =
  | { surface: "wall"; alongM: number }
  | { surface: "floor"; xM: number; forwardM: number; rotDeg: number };

/** `place: null` = yer yok ya da henüz yerleşmemiş (önizleme). */
export type LayoutItem = { designId: string; place: LayoutPlace | null };

export type RoomLayout = { version: number; roomId: string | null; items: LayoutItem[] };

/** Görünen duvarın uçları, `alongM` cinsinden. */
export type WallBounds = { fromM: number; toM: number };

/** Odada en çok bu kadar tasarım (Fatih, 21 Ekim). */
export const MAX_LAYOUT_ITEMS = 8;

/** Analiz yokken studio'daki virtual wall: 8 m. */
export const STUDIO_WALL: WallBounds = { fromM: -4, toM: 4 };
