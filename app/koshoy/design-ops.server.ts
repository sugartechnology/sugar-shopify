/**
 * Design operations shared by the turn loop (tools) and the panel routes
 * (/edit, /cart): create, edit, price, and the events/summaries they yield.
 */
import {
  CABIN_COLOR_LABELS,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  DESIGN_KIND_LABELS,
  DOOR_MIN_HEIGHT_MM,
  type BomPart,
  type CabinComposition,
  type CabinFitKind,
  type CabinetEngine,
  type DesignKind,
  type EditOp,
  type EditRejectReason,
  type EditWarning,
  type PlanInput,
  type PlanResult,
} from "./engine";
import { toPublicEvent, type DesignSummary, type PublicEvent } from "./events";
import type { KoshoyPricer, KoshoyQuote } from "./pricing.server";
import type {
  KoshoyDesign,
  KoshoySessionState,
  KoshoyStore,
} from "./store.server";

export interface KoshoyDesignDeps {
  store: KoshoyStore;
  engine: CabinetEngine;
  pricer: KoshoyPricer;
}

const PART_LABELS: Record<BomPart, string> = {
  GOVDE: "gövde",
  KAPAK: "kapak",
  RAF: "raf",
  CEKMECE: "çekmece",
  CEKMECE_ON: "çekmece önü",
  ASKI: "askı",
  TAC: "taç",
};

const FITTING_LABELS: Record<CabinFitKind, string> = {
  drawer160: "küçük çekmece",
  drawer320: "büyük çekmece",
  shelf: "raf",
  hanger: "askı",
};

function cmText(mm: number): string {
  return String(Math.round(mm) / 10).replace(".", ",");
}

/**
 * Why an edit was refused, in product language. This is what the model gets
 * instead of the engine's reason code (and its numbers become allowed facts).
 */
const EDIT_REJECT_HINTS: Record<EditRejectReason | "stale", string> = {
  invalid_op: "Bu değişiklik bu tasarımda yapılamıyor.",
  invalid_value: "Bu değer katalogdaki seçeneklerden biri değil.",
  invalid_composition: "Bu değişiklik bu tasarımda yapılamıyor.",
  invalid_unit: "Tasarımda böyle bir gövde yok; gövdeler soldan sağa sayılır.",
  no_room: "Bu gövdede o parça için yer kalmadı.",
  door_too_short: `Kapak için yeterli yükseklik kalmıyor; kapak en az ${cmText(DOOR_MIN_HEIGHT_MM)} cm olmalı.`,
  door_size_unavailable:
    "Bu çekmece düzeniyle kapak ölçüsü katalogda yok; farklı bir çekmece seçilebilir ya da kapak kaldırılabilir.",
  fitting_not_found: "Bu gövdede o parça yok.",
  no_door: "Bu gövdede kapak yok.",
  total_width_exceeded: `Toplam genişlik en fazla ${cmText(CABIN_TOTAL_WIDTH_MAX_MM)} cm olabilir.`,
  total_width_too_small: `Toplam genişlik en az ${cmText(CABIN_WIDTHS_MM[0])} cm olabilir.`,
  no_change: "Tasarım zaten böyle; bir şey değişmedi.",
  stale: "Tasarım bu sırada panelden değişti; güncel hâline göre tekrar dene.",
};

const EDIT_WARNING_TEXTS: Record<EditWarning, string> = {
  fittings_trimmed: "Sığmayan iç parçaları çıkardım.",
  door_removed: "Kapak artık sığmadığından kapağı kaldırdım.",
  units_removed: "Genişlik küçüldüğü için fazla gövdeleri kaldırdım.",
};

/**
 * Designs one conversation may hold. Each one is a row, a tab and part of
 * every model hop's context, so a new product past it reuses a design.
 */
export const KOSHOY_MAX_DESIGNS = 12;

export const DESIGN_LIMIT_HINT = `Bu sohbette en fazla ${KOSHOY_MAX_DESIGNS} tasarım olabilir; yeni ürün yerine var olan bir tasarıma geçip onu değiştirebilirsin.`;

export function editRejectHint(reason: EditRejectReason | "stale"): string {
  return EDIT_REJECT_HINTS[reason] ?? EDIT_REJECT_HINTS.invalid_op;
}

export function editWarningNotes(warnings: readonly EditWarning[]): string[] {
  return warnings.map((warning) => EDIT_WARNING_TEXTS[warning]).filter(Boolean);
}

function totalWidthMm(composition: CabinComposition): number {
  return composition.units.reduce((sum, unit) => sum + unit.widthMm, 0);
}

export function designLabel(kind: DesignKind, composition: CabinComposition): string {
  return `${DESIGN_KIND_LABELS[kind]} ${cmText(totalWidthMm(composition))} cm`;
}

export function designSummaries(
  designs: readonly KoshoyDesign[],
  activeDesignId: string | null,
): DesignSummary[] {
  return designs.slice(0, KOSHOY_MAX_DESIGNS).map((design) => ({
    designId: design.id,
    label: design.label,
    kind: design.kind,
    active: design.id === activeDesignId,
  }));
}

export function sceneEvent(design: KoshoyDesign): PublicEvent | null {
  return toPublicEvent({
    type: "scene",
    designId: design.id,
    version: design.version,
    kind: design.kind,
    label: design.label,
    view: design.composition,
  });
}

export function priceEvent(design: KoshoyDesign, quote: KoshoyQuote): PublicEvent | null {
  return toPublicEvent({
    type: "price",
    designId: design.id,
    version: design.version,
    display: quote.display,
  });
}

export function designsEvent(
  designs: readonly KoshoyDesign[],
  activeDesignId: string | null,
): PublicEvent | null {
  return toPublicEvent({ type: "designs", items: designSummaries(designs, activeDesignId) });
}

/** Product-language part counts for the model (no SKUs). */
export function quoteParts(quote: KoshoyQuote): Array<{ name: string; qty: number }> {
  const counts = new Map<string, number>();
  for (const line of quote.lines) {
    const name = PART_LABELS[line.part];
    counts.set(name, (counts.get(name) ?? 0) + line.qty);
  }
  return [...counts].map(([name, qty]) => ({ name, qty }));
}

/** Model-facing design summary in centimetres. */
export function designForModel(design: KoshoyDesign, active: boolean) {
  const c = design.composition;
  return {
    designId: design.id,
    kind: design.kind,
    label: design.label,
    active,
    totalWidthCm: totalWidthMm(c) / 10,
    depthCm: c.depthMm / 10,
    plinth: c.hasPlinth,
    color: c.color ? CABIN_COLOR_LABELS[c.color] : undefined,
    units: c.units.map((unit, index) => ({
      unit: index,
      widthCm: unit.widthMm / 10,
      heightCm: unit.heightMm / 10,
      door: unit.hasDoor,
      color: unit.color ? CABIN_COLOR_LABELS[unit.color] : undefined,
      doorColor:
        unit.hasDoor && unit.doorColor && unit.doorColor !== unit.color
          ? CABIN_COLOR_LABELS[unit.doorColor]
          : undefined,
      // Bottom → top; drawers always sit at the bottom.
      fittings: unit.fittings.map((item, i) => ({ index: i, name: FITTING_LABELS[item.kind] })),
    })),
  };
}

/** One line per non-active design: the full summary is only sent for the active one. */
export function designBriefForModel(design: KoshoyDesign) {
  return { designId: design.id, kind: design.kind, label: design.label, active: false };
}

export async function resolveDesign(
  deps: KoshoyDesignDeps,
  session: KoshoySessionState,
  designId?: string | null,
): Promise<KoshoyDesign | null> {
  const id = designId || session.activeDesignId;
  return id ? deps.store.getDesign(session.id, id) : null;
}

/** null when the session already holds KOSHOY_MAX_DESIGNS designs. */
export async function createPlannedDesign(
  deps: KoshoyDesignDeps,
  session: KoshoySessionState,
  input: PlanInput,
): Promise<{ design: KoshoyDesign; plan: PlanResult } | null> {
  const existing = await deps.store.listDesigns(session.id);
  if (existing.length >= KOSHOY_MAX_DESIGNS) return null;
  const plan = deps.engine.planCabinet(input);
  const design = await deps.store.createDesign(session.id, {
    kind: input.kind,
    label: plan.label || designLabel(input.kind, plan.composition),
    composition: plan.composition,
  });
  session.activeDesignId = design.id;
  return { design, plan };
}

export type DesignEditResult =
  | { ok: true; design: KoshoyDesign; changed: boolean; warnings: EditWarning[] }
  | { ok: false; reason: EditRejectReason | "stale" };

/**
 * Validates the op with the core and saves the result as the next version.
 * A valid op that changes nothing ("no_change") is an idempotent success
 * that keeps the current version.
 */
export async function applyDesignEdit(
  deps: KoshoyDesignDeps,
  sessionId: string,
  design: KoshoyDesign,
  op: EditOp,
): Promise<DesignEditResult> {
  const result = deps.engine.applyEditOp(design.composition, op);
  if (!result.ok) {
    if (result.reason === "no_change") return { ok: true, design, changed: false, warnings: [] };
    return { ok: false, reason: result.reason };
  }
  const updated = await deps.store.updateDesign(sessionId, design, {
    label: designLabel(design.kind, result.composition),
    composition: result.composition,
  });
  if (!updated) return { ok: false, reason: "stale" };
  return { ok: true, design: updated, changed: true, warnings: result.warnings ?? [] };
}

/**
 * One templated chat line for a panel edit (no LLM call). Sizes are read
 * from the saved design: the core snaps them onto the catalog grid.
 */
export function editSummaryText(
  op: EditOp,
  design: KoshoyDesign,
  warnings: readonly EditWarning[] = [],
): string {
  return [editActionText(op, design), ...editWarningNotes(warnings)].join(" ");
}

function editActionText(op: EditOp, design: KoshoyDesign): string {
  const nth = (unit: number) => `${unit + 1}. gövde`;
  const c = design.composition;
  const unitAt = (index: number) => c.units[index];
  switch (op.action) {
    case "add_fitting":
      return `${nth(op.unit)}ye ${FITTING_LABELS[op.kind]} ekledim.`;
    case "remove_fitting":
      return `${nth(op.unit)}den bir parça çıkardım.`;
    case "set_unit_width":
      return `${nth(op.unit)}nin genişliğini ${cmText(unitAt(op.unit)?.widthMm ?? op.widthMm)} cm yaptım.`;
    case "set_unit_height":
      return `${nth(op.unit)}nin yüksekliğini ${cmText(unitAt(op.unit)?.heightMm ?? op.heightMm)} cm yaptım.`;
    case "set_total_width":
      return `Toplam genişliği ${cmText(totalWidthMm(c))} cm yaptım.`;
    case "set_depth":
      return `Derinliği ${cmText(c.depthMm)} cm yaptım.`;
    case "set_door":
      return op.hasDoor ? `${nth(op.unit)}ye kapak ekledim.` : `${nth(op.unit)}nin kapağını kaldırdım.`;
    case "set_color": {
      const color = CABIN_COLOR_LABELS[op.color].toLocaleLowerCase("tr-TR");
      if (op.target === "all") return `Rengi ${color} yaptım.`;
      if (op.target === "door") {
        return op.unit === undefined
          ? `Kapak rengini ${color} yaptım.`
          : `${nth(op.unit)}nin kapak rengini ${color} yaptım.`;
      }
      return `${nth(op.unit ?? 0)}nin rengini ${color} yaptım.`;
    }
  }
}
