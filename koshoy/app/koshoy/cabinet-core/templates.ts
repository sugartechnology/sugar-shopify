// generated — do not edit, run npm run sync:cabinet-core
// source: 3d-room-designer/src/core/cabinet/templates.ts

import { DEFAULT_CABIN_COLOR, isCabinColorId } from "./colors";
import { nextCabinUnitId, normalizeComposition } from "./composeCabins";
import { crownByDefault, findFrontSeries } from "./rules";
import {
  CABIN_GRID_MM,
  CABIN_TOTAL_WIDTH_SAFETY_MM,
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
  | "vestiyer"
  | "kiler"
  | "ayakkabilik"
  | "banyo_dolabi"
  | "cok_amacli_dolap";

export type DesignLevel = "ekonomik" | "dengeli" | "premium";

export const DESIGN_KINDS: readonly DesignKind[] = [
  "gardirop",
  "komodin",
  "sifonyer",
  "tv_unitesi",
  "kitaplik",
  "vestiyer",
  "kiler",
  "ayakkabilik",
  "banyo_dolabi",
  "cok_amacli_dolap",
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
  kiler: "Kiler dolabı",
  ayakkabilik: "Ayakkabılık",
  banyo_dolabi: "Banyo dolabı",
  cok_amacli_dolap: "Çok amaçlı dolap",
};

/**
 * Size rules per furniture kind, on top of the catalog. A missing field means
 * the whole catalog is allowed. Rules from the product team are added here.
 */
export interface DesignKindRules {
  /** Unit widths this kind may use (mm), a subset of `CABIN_WIDTHS_MM`. */
  unitWidthsMm?: readonly number[];
}

export const DESIGN_KIND_RULES: Record<DesignKind, DesignKindRules> = {
  gardirop: {},
  komodin: {},
  sifonyer: {},
  tv_unitesi: {},
  // Shelves sag over a 96 cm span: a bookcase unit is at most 64 cm and a
  // wider bookcase is split into more units.
  kitaplik: { unitWidthsMm: [320, 480, 640] },
  vestiyer: {},
  // No unit width limit (Akın, 26 Oct): the template sizes below are defaults only.
  kiler: {},
  ayakkabilik: {},
  banyo_dolabi: {},
  cok_amacli_dolap: {},
};

export function unitWidthsForKind(kind: DesignKind): readonly number[] {
  return DESIGN_KIND_RULES[kind]?.unitWidthsMm ?? CABIN_WIDTHS_MM;
}

export interface PlanCabinetInput {
  kind: DesignKind;
  /** Wanted total width. Snapped down to the grid, never wider. */
  targetWidthMm?: number;
  level?: DesignLevel;
  color?: CabinColorId;
  /** Front series id (`CABINET_RULES.frontSeries`); unknown or missing = default. */
  frontSeries?: string;
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
 * - a drawer bank fits the front grid H − 64 (e.g. 544 → 480, 864 → 800);
 *   the closing shelf sits inside the last drawer band;
 * - a door zone needs H − 64 − drawers ≥ 320 (leaf ≥ 317), so a 544-high
 *   unit takes at most one 160 drawer under a door;
 * - door heights stay on catalog KAPAK sizes (H − drawers is a catalog height);
 * - free shelves spread over a 160 mm grid (kitaplık 1984: 568 / 888 / 1208 /
 *   1528) and a hanger rod hangs 101.68 mm under the top panel (vestiyer
 *   2304: 2186.32), see `layoutFreeFittings`;
 * - nothing above a hanger and the hanger / shelf counts of rules.ts
 *   (`interiorRuleIssues`).
 * Units of a low body (≤ 1344) get a crown (`crownByDefault`).
 */
const CABIN_TEMPLATES: Record<DesignKind, CabinTemplate> = {
  gardirop: {
    widthMm: 1920,
    heightMm: 2304,
    depthMm: 640,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["drawer320", "hanger"], hasDoor: true }] },
      dengeli: {
        units: [{ fittings: ["drawer320", "drawer320", "hanger"], hasDoor: true }],
      },
      premium: {
        units: [
          {
            fittings: ["drawer320", "drawer160", "drawer160", "hanger"],
            hasDoor: true,
          },
        ],
      },
    },
  },
  // Contract asks for 160 + 320 drawers at 544. That fits the 480 mm front
  // grid, but the templates were made when only 320 mm did: dengeli uses
  // 2 × 160 and premium grows to 704. Open decision.
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
      // No shelf above the hanger (PnP-3D), so dengeli is the same as ekonomik
      // until the product team gives it something else.
      ekonomik: { units: [{ fittings: ["hanger"], hasDoor: true }] },
      dengeli: { units: [{ fittings: ["hanger"], hasDoor: true }] },
      premium: { units: [{ fittings: ["drawer320", "hanger"], hasDoor: true }] },
    },
  },
  // The four below are sample templates (23 Oct): shelves behind doors.
  kiler: {
    widthMm: 960,
    heightMm: 2304,
    depthMm: 480,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["shelf", "shelf", "shelf"], hasDoor: true }] },
      dengeli: { units: [{ fittings: ["shelf", "shelf", "shelf", "shelf"], hasDoor: true }] },
      premium: {
        units: [{ fittings: ["drawer320", "shelf", "shelf", "shelf", "shelf"], hasDoor: true }],
      },
    },
  },
  ayakkabilik: {
    widthMm: 960,
    heightMm: 1024,
    depthMm: 320,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["shelf"], hasDoor: true }] },
      dengeli: { units: [{ fittings: ["shelf", "shelf"], hasDoor: true }] },
      premium: { units: [{ fittings: ["drawer160", "shelf"], hasDoor: true }] },
    },
  },
  banyo_dolabi: {
    widthMm: 480,
    heightMm: 1984,
    depthMm: 320,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["shelf", "shelf", "shelf"], hasDoor: true }] },
      dengeli: { units: [{ fittings: ["shelf", "shelf", "shelf", "shelf"], hasDoor: true }] },
      premium: { units: [{ fittings: ["drawer320", "shelf", "shelf", "shelf"], hasDoor: true }] },
    },
  },
  cok_amacli_dolap: {
    widthMm: 960,
    heightMm: 1984,
    depthMm: 480,
    hasPlinth: true,
    levels: {
      ekonomik: { units: [{ fittings: ["shelf", "shelf"], hasDoor: true }] },
      dengeli: { units: [{ fittings: ["shelf", "shelf", "shelf"], hasDoor: true }] },
      premium: { units: [{ fittings: ["drawer320", "shelf", "shelf", "shelf"], hasDoor: true }] },
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
 * grid (never wider than asked, at least 320, at most the 20 m safety bound) and is split into
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
  const widths = unitWidthsForKind(input.kind);
  const totalMm = planTotalWidthMm(input.targetWidthMm, template.widthMm, widths, notes);
  const units = splitTotalWidthMm(totalMm, widths).map((widthMm, index) =>
    planUnit(index, widthMm, heightMm, spec.units[index % spec.units.length], color),
  );
  const series = findFrontSeries(input.frontSeries);
  const composition = normalizeComposition({
    units,
    depthMm: template.depthMm,
    hasPlinth: template.hasPlinth,
    color,
    ...(series ? { frontSeries: series.id } : {}),
  });
  return {
    composition,
    label: `${DESIGN_KIND_LABELS[input.kind]} ${formatCm(totalMm)} cm`,
    notes,
  };
}

/** Largest buildable total ≤ target: a 160 mm multiple in [320, 20000]. */
export function snapTotalWidthMm(targetMm: number): number {
  const max = Math.floor(CABIN_TOTAL_WIDTH_SAFETY_MM / CABIN_GRID_MM) * CABIN_GRID_MM;
  const snapped = Math.floor(targetMm / CABIN_GRID_MM + 1e-9) * CABIN_GRID_MM;
  return Math.min(max, Math.max(CABIN_WIDTHS_MM[0], snapped));
}

/**
 * Unit widths for a total, widest first (1920 → 960 + 960, 1760 → 960 + 480 + 320).
 * `widthsMm` limits the widths, e.g. a kitaplık 960 → 640 + 320.
 */
export function splitTotalWidthMm(
  totalMm: number,
  widthsMm: readonly number[] = CABIN_WIDTHS_MM,
): number[] {
  return splitWidths(snapTotalWidthMm(totalMm), widthsMm) ?? [widthsMm[0]];
}

function splitWidths(restMm: number, widthsMm: readonly number[]): number[] | undefined {
  if (restMm === 0) return [];
  for (let i = widthsMm.length - 1; i >= 0; i--) {
    const width = widthsMm[i];
    if (width > restMm) continue;
    const tail = splitWidths(restMm - width, widthsMm);
    if (tail) return [width, ...tail];
  }
  return undefined;
}

/**
 * Splits every unit the kind does not allow into allowed widths, widest
 * first. Each new unit is a copy of the one it came from (interior, door,
 * colors) with a new id.
 */
export function splitUnitsForKind(
  composition: CabinComposition,
  kind: DesignKind,
): CabinComposition {
  const widths = unitWidthsForKind(kind);
  if (composition.units.every((unit) => widths.includes(unit.widthMm))) return composition;
  const units: CabinUnit[] = [];
  const taken = [...composition.units, ...(composition.widestUnits ?? [])];
  for (const unit of composition.units) {
    const parts = widths.includes(unit.widthMm)
      ? [unit.widthMm]
      : (splitWidths(unit.widthMm, widths) ?? [unit.widthMm]);
    parts.forEach((widthMm, index) => {
      const id = index === 0 ? unit.id : nextCabinUnitId([...taken, ...units]);
      const copy: CabinUnit = {
        ...unit,
        id,
        widthMm,
        fittings: (unit.fittings ?? []).map((item) => ({ ...item })),
      };
      units.push(copy);
    });
  }
  return normalizeComposition({ ...composition, units, widestUnits: undefined });
}

function planTotalWidthMm(
  targetMm: number | undefined,
  defaultMm: number,
  widthsMm: readonly number[],
  notes: string[],
): number {
  if (typeof targetMm !== "number" || !Number.isFinite(targetMm) || targetMm <= 0) {
    return snapTotalWidthMm(defaultMm);
  }
  const totalMm = snapTotalWidthMm(targetMm);
  const split = splitTotalWidthMm(totalMm, widthsMm);
  const parts = split.length > 1 ? ` (${split.map(formatCm).join(" + ")} cm)` : "";
  if (targetMm > CABIN_TOTAL_WIDTH_SAFETY_MM) {
    notes.push(
      `Toplam genişlik en fazla ${formatCm(CABIN_TOTAL_WIDTH_SAFETY_MM)} cm: ` +
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
  const unit: CabinUnit = {
    id: `cabin-${index + 1}`,
    widthMm,
    heightMm,
    fittings: interior.fittings.map((kind, i) => ({ id: `fit-${i + 1}`, kind })),
    hasDoor: interior.hasDoor,
    color,
  };
  return crownByDefault(heightMm) ? { ...unit, hasCrown: true } : unit;
}

function formatCm(mm: number): string {
  const cm = Math.round(mmToCm(mm) * 10) / 10;
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace(".", ",");
}
