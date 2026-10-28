// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/rules.ts

/**
 * Product rules the product team (Akın) may change, in one table. PnP-3D is
 * the reference: every value below is what PnP-3D does today. Change a rule
 * here, never in the layout or edit code.
 */

/**
 * A door / drawer-front series (KAPAK and CEKMECE_KAPAK come in series).
 * The id is ours: shop part names never reach this table, because it ships
 * to the browser in the 3D bundle. The backend maps an id to its shop
 * products (`koshoyPartTitle`).
 */
export interface FrontSeries {
  /** Stored on the composition (`frontSeries`) and on KAPAK / CEKMECE_ON lines. */
  id: string;
  /** What the customer hears (Fatih, 28 Oct: "Mat kapak (18 mm)"). */
  label: string;
  /** Door and drawer-front thickness. */
  thicknessMm: number;
}

export const CABINET_RULES = {
  /** Door series. A new series is one more row; the first row is the default. */
  frontSeries: [
    // Shop: Acıbay / Acıbay Çekmece.
    { id: "kapak-16", label: "Standart kapak (16 mm)", thicknessMm: 16 },
    // Shop: Aruuke / Aruuke Çekmece (the 18 mm Matt Plus twin of the first).
    { id: "kapak-18", label: "Mat kapak (18 mm)", thicknessMm: 18 },
  ] as readonly FrontSeries[],

  /** Hangers per body: max(1, floor((H − 48) / 1120)); 2304 → 2, 1984 → 1. */
  hangerZoneMm: 1120,
  hangerBaseMm: 48,

  /**
   * Shelves per body: N = (H − 64) / 160. Without drawers N − 1, with drawers
   * N − D (D = drawer bands, 160 = 1, 320 = 2; the closing shelf counts).
   */
  shelfStepMm: 160,
  shelfBaseMm: 64,

  /** Crown (TAC, shop "Tündük") on bodies people see from above. */
  crownMaxBodyHeightMm: 1344,
  crownThicknessMm: 25,
  /** The crown overhangs the body front by this much (D + 20). */
  crownExtraDepthMm: 20,
};

export function defaultFrontSeries(): FrontSeries {
  return CABINET_RULES.frontSeries[0];
}

export function findFrontSeries(id: unknown): FrontSeries | undefined {
  return CABINET_RULES.frontSeries.find((series) => series.id === id);
}

/** The series of a design; an unknown or missing id gets the default series. */
export function frontSeriesOf(seriesId?: string): FrontSeries {
  return findFrontSeries(seriesId) ?? defaultFrontSeries();
}

export function frontThicknessMm(seriesId?: string): number {
  return frontSeriesOf(seriesId).thicknessMm;
}

export function maxHangers(heightMm: number): number {
  const { hangerZoneMm, hangerBaseMm } = CABINET_RULES;
  return Math.max(1, Math.floor((heightMm - hangerBaseMm) / hangerZoneMm));
}

/** `drawerSteps`: drawer bands of the body (160 mm = 1, 320 mm = 2). */
export function maxShelves(heightMm: number, drawerSteps: number): number {
  const { shelfStepMm, shelfBaseMm } = CABINET_RULES;
  const steps = Math.floor((heightMm - shelfBaseMm) / shelfStepMm);
  return Math.max(0, drawerSteps === 0 ? steps - 1 : steps - drawerSteps);
}

/** New low bodies get a crown. */
export function crownByDefault(heightMm: number): boolean {
  return heightMm <= CABINET_RULES.crownMaxBodyHeightMm;
}

/**
 * A low body always keeps its crown; on a tall body it is the customer's
 * choice (Akın, ClickUp z8qu5d7rdq).
 */
export function crownRequired(heightMm: number): boolean {
  return heightMm <= CABINET_RULES.crownMaxBodyHeightMm;
}
