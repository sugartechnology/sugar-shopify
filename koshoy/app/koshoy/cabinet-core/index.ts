// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/index.ts

export {
  buildCabinPanels,
  cabinCavity,
  CABIN_BACK_THICKNESS_MM,
  CABIN_BACK_Z0_MM,
  CABIN_FRONT_PLINTH_INSET_MAX_MM,
  CABIN_FRONT_PLINTH_INSET_MIN_MM,
  CABIN_GROOVE_MM,
  CABIN_PLINTH_HEIGHT_MM,
  CABIN_REAR_PLINTH_Z0_MM,
  CABIN_SIDE_MM,
  CABIN_TOP_BOTTOM_MM,
} from "./buildCabinPanels";
export {
  cloneCabinComposition,
  cloneCabinUnits,
  addUnitFitting,
  largestWidthAtMost,
  maxHeightMm,
  nextCabinUnitId,
  normalizeComposition,
  removeUnitFitting,
  setMaxHeight,
  setCompositionColor,
  setFittingColor,
  setFittingOpen,
  setUnitColor,
  setUnitDoor,
  setUnitDoorColor,
  setUnitDoorOpen,
  setUnitHeight,
  unitInteriorStructureEqual,
  unitOpenChanged,
  setUnitWidth,
  syncCompositionToWidth,
  syncUnitsToWidth,
  totalWidthMm,
} from "./composeCabins";
export {
  addFitting,
  canAddFitting,
  canHaveDoor,
  doorClearHeightMm,
  doorLeafCount,
  drawerTubPanels,
  fittingLabel,
  isDrawerKind,
  layoutDoors,
  layoutDrawerFronts,
  layoutFittings,
  needsShelfAfterDrawers,
  remainingCavityMm,
  removeFitting,
  DOOR_MIN_HEIGHT_MM,
  OVERLAY_INSET_MM,
  DRAWER_160_MM,
  DRAWER_320_MM,
  DRAWER_FRONT_MM,
  HANGER_DIAMETER_MM,
  SHELF_THICKNESS_MM,
} from "./fittings";
export {
  CABIN_COLORS,
  DEFAULT_CABIN_COLOR,
  cabinColorHex,
  isCabinColorId,
  normalizeCabinColor,
} from "./colors";
export type { CabinColorOption } from "./colors";
export type { CabinDoorLeaf, CanAddFittingOptions, DrawerTubPanel, PlacedFitting } from "./fittings";
export {
  CABIN_DEPTHS_MM,
  CABIN_GRID_MM,
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  DEFAULT_CABIN_DEPTH_MM,
  cmToMm,
  mmToCm,
  nearestAllowed,
  nearestDepth,
  nearestHeight,
  nearestWidth,
  nextWidthAbove,
} from "./grid";
export type {
  CabinCavity,
  CabinColorId,
  CabinComposition,
  CabinFitKind,
  CabinFitting,
  CabinPanel,
  CabinPanelRole,
  CabinSize,
  CabinUnit,
  CabinVec3,
} from "./types";
export { DEFAULT_CABIN_COMPOSITION, DEFAULT_CABIN_SIZE } from "./types";
export {
  BOM_PARTS,
  DEFAULT_SKU_CONVENTION,
  skuFor,
  toBom,
  toSkuLines,
} from "./bom";
export type { BomLine, BomPart, SkuConvention, SkuField, SkuLine } from "./bom";
export { applyEditOp, compositionIssues, isCatalogDoorHeight } from "./edit";
export type { EditOp, EditRejectReason, EditResult, EditWarning } from "./edit";
export {
  DEFAULT_DESIGN_LEVEL,
  DESIGN_KINDS,
  DESIGN_KIND_LABELS,
  DESIGN_LEVELS,
  isDesignKind,
  isDesignLevel,
  planCabinet,
  snapTotalWidthMm,
  splitTotalWidthMm,
} from "./templates";
export type {
  DesignKind,
  DesignLevel,
  PlanCabinetInput,
  PlanCabinetResult,
} from "./templates";
