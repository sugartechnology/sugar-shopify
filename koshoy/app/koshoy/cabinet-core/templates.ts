// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/templates.ts

import { DEFAULT_CABIN_COLOR, isCabinColorId } from "./colors";
import { normalizeComposition } from "./composeCabins";
import {
  CABIN_GRID_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  mmToCm,
} from "./grid";
import type {
  CabinColorId,
  CabinComposition,
  CabinFitKind,
  CabinUnit,
} from "./types";

export type DesignKind =
  | "gardirop"
  | "komodin"
  | "sifonyer"
  | "tv_unitesi"
  | "kitaplik"
  | "vestiyer";

export type DesignLevel = "ekonomik" | "dengeli" | "premium";

export const DESIGN_KINDS: readonly DesignKind[] = [
  "gardirop",
  "komodin",
  "sifonyer",
  "tv_unitesi",
  "kitaplik",
  "vestiyer",
];

export const DESIGN_LEVELS: readonly DesignLevel[] = ["ekonomik", "dengeli", "premium"];

export const DEFAULT_DESIGN_LEVEL: DesignLevel = "dengeli";

export const DESIGN_KIND_LABELS: Record<DesignKind, string> = {
  gardirop: "Gardırop",
  komodin: "Komodin",
  sifonyer: "Şifonyer",
  tv_unitesi: "TV ünitesi",
  kitaplik: "Kitaplık",
  vestiyer: "Vestiyer",
};

export interface PlanCabinetInput {
  kind: DesignKind;
  /** Wanted total width. Snapped down to the grid, never wider. */
  targetWidthMm?: number;
  level?: DesignLevel;
  color?: CabinColorId;
}

export interface PlanCabinetResult {
  composition: CabinComposition;
  label: string;
  /** Turkish, product language (e.g. "Genişlik 200 cm → 192 cm (96 + 96 cm)"). */
  notes: string[];
}

/** Fittings bottom → top, as stored in `CabinUnit.fittings`. */
interface UnitInterior {
  fittings: readonly CabinFitKind[];
  hasDoor: boolean;
}

interface LevelSpec {
  /** Overrides the kind height for this level. */
  heightMm?: number;
  /** Unit i uses units[i % length]. */
  units: readonly UnitInterior[];
}

interface CabinTemplate {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  hasPlinth: boolean;
  levels: Record<DesignLevel, LevelSpec>;
}

/**
 * Template table. Every entry has to pass the interior rules of fittings.ts:
 * - with plinth the cavity is H − 88, so a drawer bank fits at most H − 224
 *   (e.g. 544 → 320, 864 → 640) plus the closing shelf;
 * - a door needs H − 67 − drawers ≥ 320, so 544-high units cannot mix a door
 *   with drawers;
 * - door heights stay on catalog KAPAK sizes (H − drawers is a catalog height);
 * - shelves stack 16 mm apart (no shelf spacing in the model), hanger zones are
 *   up to 800 mm. So kitaplık shelves sit in the bottom few cm and the
 *   ekonomik / dengeli vestiyer rod hangs at ~85 cm (open decision).
 */
const CABIN_TEMPLATES: Record<DesignKind, CabinTemplate> = {
  gardirop: {
    widthMm: 1920,
    heightMm: 2304,
    depthMm: 640,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["drawer320", "hanger", "shelf"], hasDoor: true }] },
      dengeli: {
        units: [{ fittings: ["drawer320", "drawer320", "hanger", "shelf"], hasDoor: true }],
      },
      premium: {
        units: [
          {
            fittings: ["drawer320", "drawer160", "drawer160", "hanger", "shelf"],
            hasDoor: true,
          },
        ],
      },
    },
  },
  // Contract asks for 160 + 320 drawers at 544. With plinth only 320 mm of
  // drawers fit there, so dengeli uses 2 × 160 and premium grows to 704.
  // 160 + 320 does fit without plinth (512 mm cavity), but that needs a
  // BAZASIZ GOVDE (S1) and the view starts drawer fronts at 65.5 mm while
  // the tubs start at 16 mm, so they would not line up. Open decision.
  komodin: {
    widthMm: 480,
    heightMm: 544,
    depthMm: 480,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["drawer320"], hasDoor: false }] },
      dengeli: { units: [{ fittings: ["drawer160", "drawer160"], hasDoor: false }] },
      premium: {
        heightMm: 704,
        units: [{ fittings: ["drawer320", "drawer160"], hasDoor: false }],
      },
    },
  },
  sifonyer: {
    widthMm: 960,
    heightMm: 864,
    depthMm: 480,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["drawer320", "drawer320"], hasDoor: false }] },
      dengeli: {
        units: [{ fittings: ["drawer320", "drawer160", "drawer160"], hasDoor: false }],
      },
      premium: {
        units: [
          {
            fittings: ["drawer160", "drawer160", "drawer160", "drawer160"],
            hasDoor: false,
          },
        ],
      },
    },
  },
  tv_unitesi: {
    widthMm: 1600,
    heightMm: 544,
    depthMm: 480,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: [], hasDoor: true }] },
      dengeli: {
        units: [
          { fittings: [], hasDoor: true },
          { fittings: ["drawer160", "drawer160"], hasDoor: false },
        ],
      },
      premium: { units: [{ fittings: ["drawer160", "drawer160"], hasDoor: false }] },
    },
  },
  kitaplik: {
    widthMm: 960,
    heightMm: 1984,
    depthMm: 320,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["shelf", "shelf", "shelf"], hasDoor: false }] },
      dengeli: {
        units: [{ fittings: ["shelf", "shelf", "shelf", "shelf"], hasDoor: false }],
      },
      premium: {
        units: [
          {
            fittings: ["drawer320", "shelf", "shelf", "shelf", "shelf"],
            hasDoor: false,
          },
        ],
      },
    },
  },
  vestiyer: {
    widthMm: 640,
    heightMm: 2304,
    depthMm: 480,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["hanger"], hasDoor: true }] },
      dengeli: { units: [{ fittings: ["hanger", "shelf"], hasDoor: true }] },
      premium: { units: [{ fittings: ["drawer320", "hanger", "shelf"], hasDoor: true }] },
    },
  },
};

export function isDesignKind(value: unknown): value is DesignKind {
  return DESIGN_KINDS.includes(value as DesignKind);
}

export function isDesignLevel(value: unknown): value is DesignLevel {
  return DESIGN_LEVELS.includes(value as DesignLevel);
}

/**
 * Deterministic design for a furniture kind. Width snaps down to the 160 mm
 * grid (never wider than asked, at least 320, at most 5000) and is split into
 * catalog widths, widest first. Throws on an unknown kind; check with
 * `isDesignKind` first. Invalid level / color fall back to the defaults.
 */
export function planCabinet(input: PlanCabinetInput): PlanCabinetResult {
  if (!isDesignKind(input.kind)) {
    throw new Error(`unknown design kind: ${String(input.kind)}`);
  }
  const template = CABIN_TEMPLATES[input.kind];
  const level = isDesignLevel(input.level) ? input.level : DEFAULT_DESIGN_LEVEL;
  const color = isCabinColorId(input.color) ? input.color : DEFAULT_CABIN_COLOR;
  const spec = template.levels[level];
  const heightMm = spec.heightMm ?? template.heightMm;
  const notes: string[] = [];
  const totalMm = planTotalWidthMm(input.targetWidthMm, template.widthMm, notes);
  const units = splitTotalWidthMm(totalMm).map((widthMm, index) =>
    planUnit(index, widthMm, heightMm, spec.units[index % spec.units.length], color),
  );
  const composition = normalizeComposition({
    units,
    depthMm: template.depthMm,
    hasPlinth: template.hasPlinth,
    color,
  });
  return {
    composition,
    label: `${DESIGN_KIND_LABELS[input.kind]} ${formatCm(totalMm)} cm`,
    notes,
  };
}

/** Largest buildable total ≤ target: a 160 mm multiple in [320, 4960]. */
export function snapTotalWidthMm(targetMm: number): number {
  const max = Math.floor(CABIN_TOTAL_WIDTH_MAX_MM / CABIN_GRID_MM) * CABIN_GRID_MM;
  const snapped = Math.floor(targetMm / CABIN_GRID_MM + 1e-9) * CABIN_GRID_MM;
  return Math.min(max, Math.max(CABIN_WIDTHS_MM[0], snapped));
}

/** Catalog unit widths for a total, widest first (1920 → 960 + 960, 1760 → 960 + 480 + 320). */
export function splitTotalWidthMm(totalMm: number): number[] {
  return splitWidths(snapTotalWidthMm(totalMm)) ?? [CABIN_WIDTHS_MM[0]];
}

function splitWidths(restMm: number): number[] | undefined {
  if (restMm === 0) return [];
  for (let i = CABIN_WIDTHS_MM.length - 1; i >= 0; i--) {
    const width = CABIN_WIDTHS_MM[i];
    if (width > restMm) continue;
    const tail = splitWidths(restMm - width);
    if (tail) return [width, ...tail];
  }
  return undefined;
}

function planTotalWidthMm(
  targetMm: number | undefined,
  defaultMm: number,
  notes: string[],
): number {
  if (typeof targetMm !== "number" || !Number.isFinite(targetMm) || targetMm <= 0) {
    return snapTotalWidthMm(defaultMm);
  }
  const totalMm = snapTotalWidthMm(targetMm);
  const split = splitTotalWidthMm(totalMm);
  const parts = split.length > 1 ? ` (${split.map(formatCm).join(" + ")} cm)` : "";
  if (targetMm > CABIN_TOTAL_WIDTH_MAX_MM) {
    notes.push(
      `Toplam genişlik en fazla ${formatCm(CABIN_TOTAL_WIDTH_MAX_MM)} cm: ` +
        `${formatCm(targetMm)} cm → ${formatCm(totalMm)} cm${parts}`,
    );
  } else if (targetMm < CABIN_WIDTHS_MM[0]) {
    notes.push(
      `En dar ölçü ${formatCm(CABIN_WIDTHS_MM[0])} cm: ` +
        `${formatCm(targetMm)} cm → ${formatCm(totalMm)} cm`,
    );
  } else if (totalMm !== targetMm) {
    notes.push(`Genişlik ${formatCm(targetMm)} cm → ${formatCm(totalMm)} cm${parts}`);
  }
  return totalMm;
}

function planUnit(
  index: number,
  widthMm: number,
  heightMm: number,
  interior: UnitInterior,
  color: CabinColorId,
): CabinUnit {
  return {
    id: `cabin-${index + 1}`,
    widthMm,
    heightMm,
    fittings: interior.fittings.map((kind, i) => ({ id: `fit-${i + 1}`, kind })),
    hasDoor: interior.hasDoor,
    color,
  };
}

function formatCm(mm: number): string {
  const cm = Math.round(mmToCm(mm) * 10) / 10;
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace(".", ",");
}
