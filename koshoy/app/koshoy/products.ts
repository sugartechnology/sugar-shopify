/**
 * Products from the data (kinds document, ClickUp z8qu5d3qan): which row a
 * design or a tool call means, and the row's body-width rule. The core keeps
 * only the construction templates; names and rules come from here.
 */
import { nextCabinUnitId, splitTotalWidthMm } from "./cabinet-core";
import type { KoshoyDataKind } from "./data.server";
import { cabinetEngine, DESIGN_KIND_LABELS, unitWidthsForKind, type CabinComposition, type CabinUnit, type DesignKind } from "./engine";

/** The rows a turn reads; only `kinds` is needed here. */
interface ProductData {
  kinds: readonly KoshoyDataKind[];
}

/** Template every unknown id is built on (a product deleted from the data). */
export const FALLBACK_TEMPLATE: DesignKind = "cok_amacli_dolap";

/** The row of an id; null when the data has no such product. */
export function findProduct(data: ProductData, id: string): KoshoyDataKind | null {
  return id ? (data.kinds.find((row) => row.kind === id) ?? null) : null;
}

/**
 * The row a design was built from. Designs saved before product ids (or
 * whose product was deleted since) fall back to their template's row, then
 * to the template itself with the core's rule, so an old design always opens.
 */
export function productOfDesign(data: ProductData, design: { kind: DesignKind; product?: string | null }): KoshoyDataKind {
  return (
    findProduct(data, design.product ?? "") ??
    data.kinds.find((row) => row.kind === design.kind && row.template === design.kind) ??
    templateRow(design.kind)
  );
}

/** A template as a product row with the core's own rule (no data row for it). */
export function templateRow(template: DesignKind): KoshoyDataKind {
  return {
    kind: template,
    template,
    label: DESIGN_KIND_LABELS[template],
    synonyms: [],
    joinSameKind: false,
    questions: [],
    unitWidthsMm: [...unitWidthsForKind(template)],
    build: null,
    note: "",
  };
}

/** The product's row for a tool argument; an unknown id is built as "Dolap". */
export function productOrFallback(data: ProductData, id: string): KoshoyDataKind {
  return findProduct(data, id) ?? { ...templateRow(FALLBACK_TEMPLATE), kind: id || FALLBACK_TEMPLATE, label: "Dolap" };
}

/**
 * Puts every body on a width the product allows (ClickUp z8qu5d3qan, Akın 31
 * Oct): the total is filled with the widest allowed body first and only the
 * last one takes the rest (192 → 64 + 64 + 64). Bodies that are all alike
 * are split again as one total; a mixed design splits each body that is not
 * allowed on its own. Total width never changes; new bodies are copies with
 * a new id.
 */
export function fitUnitWidths(composition: CabinComposition, widthsMm: readonly number[]): CabinComposition {
  if (composition.units.every((unit) => widthsMm.includes(unit.widthMm))) return composition;
  const alike = composition.units.every((unit) => sameBody(unit, composition.units[0]));
  const groups: Array<{ unit: CabinUnit; widthMm: number }> = alike
    ? [{ unit: composition.units[0], widthMm: composition.units.reduce((sum, unit) => sum + unit.widthMm, 0) }]
    : composition.units.map((unit) => ({ unit, widthMm: unit.widthMm }));
  const units: CabinUnit[] = [];
  const taken = [...composition.units, ...(composition.widestUnits ?? [])];
  for (const group of groups) {
    const parts = widthsMm.includes(group.widthMm) ? [group.widthMm] : splitTotalWidthMm(group.widthMm, widthsMm);
    parts.forEach((widthMm, index) => {
      const id = index === 0 ? group.unit.id : nextCabinUnitId([...taken, ...units]);
      units.push({ ...group.unit, id, widthMm, fittings: (group.unit.fittings ?? []).map((item) => ({ ...item })) });
    });
  }
  return cabinetEngine.normalizeComposition({ ...composition, units, widestUnits: undefined });
}

/** Same body apart from its width and id: interior, door, crown, colours, height. */
function sameBody(a: CabinUnit, b: CabinUnit): boolean {
  const shape = (unit: CabinUnit) =>
    JSON.stringify({ ...unit, id: "", widthMm: 0, fittings: (unit.fittings ?? []).map((item) => item.kind) });
  return shape(a) === shape(b);
}
