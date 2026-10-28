// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/types.ts

export type CabinPanelRole =
  | "leftSide"
  | "rightSide"
  | "top"
  | "bottom"
  /** The whole back, or its left half when the body is split (≥ 640 mm). */
  | "back"
  | "backRight"
  | "frontPlinth"
  | "rearPlinth";

export interface CabinSize {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  hasPlinth: boolean;
}

export interface CabinVec3 {
  x: number;
  y: number;
  z: number;
}

export interface CabinPanel {
  role: CabinPanelRole;
  min: CabinVec3;
  max: CabinVec3;
  size: CabinVec3;
  center: CabinVec3;
}

export interface CabinCavity {
  min: CabinVec3;
  max: CabinVec3;
  size: CabinVec3;
}

export const DEFAULT_CABIN_SIZE: CabinSize = {
  widthMm: 480,
  heightMm: 2304,
  depthMm: 640,
  hasPlinth: true,
};

export type CabinFitKind = "drawer160" | "drawer320" | "shelf" | "hanger";

/** A colour of the page's palette (`setCabinColors`), e.g. "wood" or a shop colour. */
export type CabinColorId = string;

export interface CabinFitting {
  id: string;
  kind: CabinFitKind;
  open?: boolean;
  color?: CabinColorId;
}

export interface CabinUnit {
  id: string;
  widthMm: number;
  heightMm: number;
  fittings: CabinFitting[];
  hasDoor: boolean;
  doorOpen?: boolean;
  color?: CabinColorId;
  doorColor?: CabinColorId;
  /** Crown (TAC) on top of the body. */
  hasCrown?: boolean;
}

export interface CabinComposition {
  units: CabinUnit[];
  depthMm: number;
  hasPlinth: boolean;
  color?: CabinColorId;
  /** Door / drawer-front series id (`CABINET_RULES.frontSeries`); missing = default. */
  frontSeries?: string;
  /** One handle on every door leaf and drawer front, in this colour; missing = no handles. */
  handleColor?: CabinColorId;
  widestUnits?: CabinUnit[];
}

const DEFAULT_CABIN_UNIT: CabinUnit = {
  id: "cabin-1",
  widthMm: 480,
  heightMm: 2304,
  fittings: [],
  hasDoor: false,
  color: "wood",
};

export const DEFAULT_CABIN_COMPOSITION: CabinComposition = {
  units: [{ ...DEFAULT_CABIN_UNIT, fittings: [] }],
  depthMm: 640,
  hasPlinth: true,
  color: "wood",
  widestUnits: [{ ...DEFAULT_CABIN_UNIT, fittings: [] }],
};
