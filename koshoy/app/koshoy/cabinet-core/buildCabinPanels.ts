// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/buildCabinPanels.ts

import type {
  CabinCavity,
  CabinPanel,
  CabinPanelRole,
  CabinSize,
  CabinVec3,
} from "./types";

export const CABIN_SIDE_MM = 16;
export const CABIN_TOP_BOTTOM_MM = 16;
export const CABIN_BACK_THICKNESS_MM = 8;
export const CABIN_PLINTH_HEIGHT_MM = 56;
export const CABIN_GROOVE_MM = 7;
export const CABIN_BACK_Z0_MM = 16;
export const CABIN_REAR_PLINTH_Z0_MM = 51;
export const CABIN_FRONT_PLINTH_INSET_MAX_MM = 29;
export const CABIN_FRONT_PLINTH_INSET_MIN_MM = 45;

function vec(x: number, y: number, z: number): CabinVec3 {
  return { x, y, z };
}

function panel(
  role: CabinPanelRole,
  min: CabinVec3,
  max: CabinVec3,
): CabinPanel {
  return {
    role,
    min,
    max,
    size: vec(max.x - min.x, max.y - min.y, max.z - min.z),
    center: vec((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2),
  };
}

/** Interior cavity after panel thicknesses (raf / drawer space). */
export function cabinCavity(size: CabinSize): CabinCavity {
  const w = size.widthMm;
  const h = size.heightMm;
  const d = size.depthMm;
  const y0 = size.hasPlinth
    ? CABIN_PLINTH_HEIGHT_MM + CABIN_TOP_BOTTOM_MM
    : CABIN_TOP_BOTTOM_MM;
  const min = vec(CABIN_SIDE_MM, y0, CABIN_BACK_Z0_MM + CABIN_BACK_THICKNESS_MM);
  const max = vec(w - CABIN_SIDE_MM, h - CABIN_TOP_BOTTOM_MM, d);
  return {
    min,
    max,
    size: vec(max.x - min.x, max.y - min.y, max.z - min.z),
  };
}

/**
 * Seven (or five without plinth) carcass panels in mm.
 * X right, Y up, Z back→front. Origin is the back-left-bottom corner.
 */
export function buildCabinPanels(size: CabinSize): CabinPanel[] {
  const w = size.widthMm;
  const h = size.heightMm;
  const d = size.depthMm;
  const bottomY0 = size.hasPlinth ? CABIN_PLINTH_HEIGHT_MM : 0;
  const bottomY1 = bottomY0 + CABIN_TOP_BOTTOM_MM;
  const backX0 = CABIN_SIDE_MM - CABIN_GROOVE_MM;
  const backX1 = w - CABIN_SIDE_MM + CABIN_GROOVE_MM;
  const backY0 = bottomY1 - CABIN_GROOVE_MM;
  const backY1 = h - CABIN_TOP_BOTTOM_MM + CABIN_GROOVE_MM;

  const panels: CabinPanel[] = [
    panel("leftSide", vec(0, 0, 0), vec(CABIN_SIDE_MM, h, d)),
    panel("rightSide", vec(w - CABIN_SIDE_MM, 0, 0), vec(w, h, d)),
    panel(
      "bottom",
      vec(CABIN_SIDE_MM, bottomY0, 0),
      vec(w - CABIN_SIDE_MM, bottomY1, d),
    ),
    panel(
      "top",
      vec(CABIN_SIDE_MM, h - CABIN_TOP_BOTTOM_MM, 0),
      vec(w - CABIN_SIDE_MM, h, d),
    ),
    panel(
      "back",
      vec(backX0, backY0, CABIN_BACK_Z0_MM),
      vec(backX1, backY1, CABIN_BACK_Z0_MM + CABIN_BACK_THICKNESS_MM),
    ),
  ];

  if (size.hasPlinth) {
    panels.push(
      panel(
        "rearPlinth",
        vec(CABIN_SIDE_MM, 0, CABIN_REAR_PLINTH_Z0_MM),
        vec(
          w - CABIN_SIDE_MM,
          CABIN_PLINTH_HEIGHT_MM,
          CABIN_REAR_PLINTH_Z0_MM + CABIN_TOP_BOTTOM_MM,
        ),
      ),
      panel(
        "frontPlinth",
        vec(CABIN_SIDE_MM, 0, d - CABIN_FRONT_PLINTH_INSET_MIN_MM),
        vec(w - CABIN_SIDE_MM, CABIN_PLINTH_HEIGHT_MM, d - CABIN_FRONT_PLINTH_INSET_MAX_MM),
      ),
    );
  }

  return panels;
}
