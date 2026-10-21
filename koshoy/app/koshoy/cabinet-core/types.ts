// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/types.ts

export type CabinPanelRole =
  | "leftSide"
  | "rightSide"
  | "top"
  | "bottom"
  | "back"
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

export type CabinColorId = "wood" | "ivory" | "blue";

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
}

export interface CabinComposition {
  units: CabinUnit[];
  depthMm: number;
  hasPlinth: boolean;
  color?: CabinColorId;
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
