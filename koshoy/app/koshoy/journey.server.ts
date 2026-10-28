/**
 * The journey on the server: what the screen shows at each stage (structure
 * card, style choices with pictures and prices, room summary, product card,
 * cart summary) and what the journey buttons do. journey.ts holds the
 * state and the rules; the store, the core and the prices are used here.
 *
 * Akın's data (levels, questions, pictures, texts) comes in as
 * KoshoyJourneyData; nothing of it is a constant here.
 */
import { CABINET_RULES } from "./cabinet-core";
import { CABIN_COLOR_IDS, CABIN_COLOR_LABELS, DESIGN_KIND_LABELS, type DesignKind, type EditOp } from "./engine";
import { PRICE_PLACEHOLDER, toPublicEvent, type ChoiceOption, type PublicEvent } from "./events";
import { applyDesignEdit, type KoshoyDesignDeps } from "./design-ops.server";
import { formatTl } from "./pricing.server";
import type { KoshoyDataDocs } from "./data.server";
import {
  approvalOf,
  approvedDesigns,
  BEST_FRONT_SERIES,
  isInCart,
  journeyStage,
  laterDesigns,
  missingStyle,
  nextPendingDesign,
  type JourneyLevel,
  type JourneyStage,
  type KoshoyJourney,
  type KoshoyStyle,
  type StyleDecision,
} from "./journey";
import type { KoshoyDesign, KoshoySessionState } from "./store.server";

/** Akın's data as the journey reads it (data.server.ts documents). */
export type KoshoyJourneyData = KoshoyDataDocs;

/** Handle colours of the shop; empty until the shop has handle products (price sync work). */
export interface JourneyOptions {
  handles: ReadonlyArray<{ id: string; label: string }>;
}

export const NO_HANDLES: JourneyOptions = { handles: [] };

export interface JourneyView {
  stage: JourneyStage;
  missingStyle: StyleDecision[];
  designs: KoshoyDesign[];
}

export async function journeyView(
  deps: KoshoyDesignDeps,
  session: KoshoySessionState,
  data: KoshoyJourneyData,
  options: JourneyOptions = NO_HANDLES,
): Promise<JourneyView> {
  const designs = await deps.store.listDesigns(session.id);
  const missing = missingStyle(session.journey, designs, {
    levels: data.levels,
    handles: options.handles.map((handle) => handle.id),
  });
  const stage = journeyStage(session.journey, {
    room: session.brief.room,
    designs,
    hasRoomPhoto: session.roomId !== null,
    missingStyle: missing,
  });
  return { stage, missingStyle: missing, designs };
}

/* ---------------- style ---------------- */

const DECISION_QUESTIONS: Record<StyleDecision, string> = {
  level: "Seçimlerde neye göre gidelim?",
  panel: "Odanın rengi hangisi olsun?",
  front: "Kapaklar hangisi olsun?",
  crown: "Uzun dolapların üstüne taç (üst kapama) ister misin?",
  handle: "Kulplar hangi renk olsun?",
};

const CROWN_LABELS = { on: "Taçlı olsun", off: "Taçsız kalsın" } as const;

function tallUnitIndexes(design: KoshoyDesign): number[] {
  return design.composition.units.flatMap((unit, index) =>
    unit.heightMm > CABINET_RULES.crownMaxBodyHeightMm ? [index] : [],
  );
}

/** The core edits one style value means for one design. */
function styleOps(design: KoshoyDesign, style: Partial<KoshoyStyle>): EditOp[] {
  const ops: EditOp[] = [];
  if (style.panel) ops.push({ action: "set_color", target: "all", color: style.panel });
  if (style.front) ops.push({ action: "set_front_series", series: style.front });
  if (style.crown) {
    for (const unit of tallUnitIndexes(design)) {
      ops.push({ action: "set_crown", unit, hasCrown: style.crown === "on" });
    }
  }
  return ops;
}

/** What a level with "auto" choices settles by itself. */
function levelStyle(level: JourneyLevel | undefined): Partial<KoshoyStyle> {
  if (!level) return {};
  return {
    ...(level.front === "auto" ? { front: BEST_FRONT_SERIES } : {}),
    ...(level.crown === "auto" ? { crown: "on" as const } : {}),
  };
}

/** The whole room's price if `style` were applied; nothing is saved. */
async function previewTotal(
  deps: KoshoyDesignDeps,
  designs: readonly KoshoyDesign[],
  style: Partial<KoshoyStyle>,
): Promise<string> {
  let cents = 0;
  for (const design of designs) {
    let composition = design.composition;
    for (const op of styleOps(design, style)) {
      const result = deps.engine.applyEditOp(composition, op, design.kind);
      if (result.ok) composition = result.composition;
    }
    const quote = await deps.pricer.quote(composition);
    if (quote.totalCents === null) return PRICE_PLACEHOLDER;
    cents += quote.totalCents;
  }
  return formatTl(cents);
}

function imageFor(data: KoshoyJourneyData, designs: readonly KoshoyDesign[], option: string): string | undefined {
  const kinds = new Set<string>(designs.map((design) => design.kind));
  const match =
    data.images.find((image) => image.option === option && kinds.has(image.kind)) ??
    data.images.find((image) => image.option === option && image.kind === "*");
  return match?.url;
}

/**
 * The choices of one style decision, as an info note: a picture per option
 * (when Akın's set has one) and the room's total with that option. Panel
 * colour shows no price (its difference is not shown, ClickUp z8qu5d7rdq).
 * `value` is what the server applies when the customer picks it.
 */
export async function styleChoices(
  deps: KoshoyDesignDeps,
  designs: readonly KoshoyDesign[],
  data: KoshoyJourneyData,
  decision: StyleDecision,
  options: JourneyOptions = NO_HANDLES,
): Promise<{ question: string; options: Array<ChoiceOption & { value: string }> }> {
  const question = DECISION_QUESTIONS[decision];
  const entries: Array<{ value: string; label: string; image?: string; style?: Partial<KoshoyStyle> }> = [];
  if (decision === "level") {
    for (const level of data.levels) {
      entries.push({ value: level.id, label: level.label, style: levelStyle(level) });
    }
  }
  if (decision === "panel") {
    for (const id of CABIN_COLOR_IDS) {
      entries.push({ value: id, label: CABIN_COLOR_LABELS[id], image: imageFor(data, designs, `panel_${id}`) });
    }
  }
  if (decision === "front") {
    for (const series of CABINET_RULES.frontSeries) {
      entries.push({
        value: series.id,
        label: series.label,
        image: imageFor(data, designs, `front_${series.id}`),
        style: { front: series.id },
      });
    }
  }
  if (decision === "crown") {
    for (const value of ["on", "off"] as const) {
      entries.push({
        value,
        label: CROWN_LABELS[value],
        image: imageFor(data, designs, `crown_${value}`),
        style: { crown: value },
      });
    }
  }
  if (decision === "handle") {
    for (const handle of options.handles) {
      entries.push({ value: handle.id, label: handle.label, image: imageFor(data, designs, `handle_${handle.id}`) });
    }
  }
  const out: Array<ChoiceOption & { value: string }> = [];
  for (const [index, entry] of entries.slice(0, 4).entries()) {
    const option: ChoiceOption & { value: string } = {
      id: `opt_${index + 1}`,
      label: entry.label,
      value: `style:${decision}:${entry.value}`,
    };
    if (entry.image) option.image = entry.image;
    if (entry.style) option.price = await previewTotal(deps, designs, entry.style);
    out.push(option);
  }
  return { question, options: out };
}

/** "style:front:kapak-18" → the decision and value, or null for any other choice. */
export function parseStyleValue(value: string): { decision: StyleDecision; value: string } | null {
  const match = /^style:(level|panel|front|crown|handle):([A-Za-z0-9_-]{1,64})$/.exec(value);
  return match ? { decision: match[1] as StyleDecision, value: match[2] } : null;
}

/** Applies a style to one design (a new design follows the room's style too). */
export async function styleDesign(
  deps: KoshoyDesignDeps,
  sessionId: string,
  design: KoshoyDesign,
  style: Partial<KoshoyStyle>,
): Promise<KoshoyDesign> {
  let current = design;
  for (const op of styleOps(current, style)) {
    const result = await applyDesignEdit(deps, sessionId, current, op);
    if (result.ok) current = result.design;
  }
  return current;
}

/**
 * Stores one style decision and applies it to every design of the room.
 * Returns what changed in product language, for the model and the chat.
 */
export async function applyStyleDecision(
  deps: KoshoyDesignDeps,
  session: KoshoySessionState,
  data: KoshoyJourneyData,
  decision: StyleDecision,
  value: string,
  options: JourneyOptions = NO_HANDLES,
): Promise<{ ok: boolean; designs: KoshoyDesign[]; summary: string }> {
  const style = session.journey.style;
  let change: Partial<KoshoyStyle> = {};
  let summary = "";
  if (decision === "level") {
    const level = data.levels.find((item) => item.id === value);
    if (!level) return { ok: false, designs: [], summary: "" };
    const before = data.levels.find((item) => item.id === style.level);
    change = levelStyle(level);
    // What the previous level chose by itself is asked again under a level that asks.
    if (before?.front === "auto" && level.front === "ask") style.front = "";
    if (before?.crown === "auto" && level.crown === "ask") style.crown = "";
    style.level = level.id;
    summary = level.front === "auto" || level.crown === "auto"
      ? `${level.label}: mat kapak ve uzun dolaplarda taç senin için seçildi.`
      : `${level.label}.`;
  }
  if (decision === "panel") {
    const color = CABIN_COLOR_IDS.find((id) => id === value);
    if (!color) return { ok: false, designs: [], summary: "" };
    change = { panel: color };
    summary = `Renk: ${CABIN_COLOR_LABELS[color]}.`;
  }
  if (decision === "front") {
    const series = CABINET_RULES.frontSeries.find((item) => item.id === value);
    if (!series) return { ok: false, designs: [], summary: "" };
    change = { front: series.id };
    summary = `Kapak: ${series.label}.`;
  }
  if (decision === "crown") {
    if (value !== "on" && value !== "off") return { ok: false, designs: [], summary: "" };
    change = { crown: value };
    summary = value === "on" ? "Uzun dolaplara taç eklendi." : "Uzun dolaplar taçsız kaldı.";
  }
  if (decision === "handle") {
    const handle = options.handles.find((item) => item.id === value);
    if (!handle) return { ok: false, designs: [], summary: "" };
    change = { handle: handle.id };
    summary = `Kulp: ${handle.label}.`;
  }
  Object.assign(style, change);
  const designs: KoshoyDesign[] = [];
  for (const design of await deps.store.listDesigns(session.id)) {
    designs.push(await styleDesign(deps, session.id, design, change));
  }
  return { ok: true, designs, summary };
}

function styleLines(style: KoshoyStyle, data: KoshoyJourneyData, options: JourneyOptions) {
  const lines: Array<{ label: string; value: string }> = [];
  const level = data.levels.find((item) => item.id === style.level);
  if (level) lines.push({ label: "Seçim", value: level.label });
  if (style.panel) lines.push({ label: "Renk", value: CABIN_COLOR_LABELS[style.panel] });
  const series = CABINET_RULES.frontSeries.find((item) => item.id === style.front);
  if (series) lines.push({ label: "Kapak", value: series.label });
  if (style.crown) lines.push({ label: "Uzun dolaplarda taç", value: style.crown === "on" ? "Var" : "Yok" });
  const handle = options.handles.find((item) => item.id === style.handle);
  if (handle) lines.push({ label: "Kulp", value: handle.label });
  return lines;
}

/* ---------------- screen cards ---------------- */

async function roomTotal(deps: KoshoyDesignDeps, designs: readonly KoshoyDesign[]): Promise<string> {
  return previewTotal(deps, designs, {});
}

export function structureEvent(photo: boolean): PublicEvent | null {
  return toPublicEvent({ type: "structure", photo });
}

export async function roomSummaryEvent(
  deps: KoshoyDesignDeps,
  session: KoshoySessionState,
  designs: readonly KoshoyDesign[],
  data: KoshoyJourneyData,
  options: JourneyOptions = NO_HANDLES,
): Promise<PublicEvent | null> {
  return toPublicEvent({
    type: "room_summary",
    items: designs.map((design) => ({ designId: design.id, label: design.label })),
    style: styleLines(session.journey.style, data, options),
    total: await roomTotal(deps, designs),
    approved: session.journey.roomApprovedAt !== null,
    single: session.journey.kind === "single",
  });
}

/** What the card says about the product itself: its front series and a crown on a tall body. */
function productNotes(design: KoshoyDesign): string[] {
  const notes: string[] = [];
  const series = CABINET_RULES.frontSeries.find((item) => item.id === design.composition.frontSeries);
  if (series && design.composition.units.some((unit) => unit.hasDoor || unit.fittings.length)) notes.push(series.label);
  const tall = design.composition.units.filter((unit) => unit.heightMm > CABINET_RULES.crownMaxBodyHeightMm);
  if (tall.some((unit) => unit.hasCrown)) notes.push("Taçlı");
  return notes;
}

export function productCardEvent(
  journey: KoshoyJourney,
  designs: readonly KoshoyDesign[],
  design: KoshoyDesign,
): PublicEvent | null {
  const status = approvalOf(journey, design);
  const sameKind = designs.filter(
    (other) => other.id !== design.id && other.kind === design.kind && approvalOf(journey, other) === "pending",
  ).length;
  return toPublicEvent({
    type: "product_card",
    designId: design.id,
    label: design.label,
    status,
    index: designs.findIndex((item) => item.id === design.id) + 1,
    count: designs.length,
    approvedCount: approvedDesigns(journey, designs).length,
    sameKind,
    notes: productNotes(design),
  });
}

export async function cartSummaryEvent(
  deps: KoshoyDesignDeps,
  journey: KoshoyJourney,
  designs: readonly KoshoyDesign[],
  data: KoshoyJourneyData,
): Promise<PublicEvent | null> {
  const approved = approvedDesigns(journey, designs).filter((design) => !isInCart(journey, design));
  const items = [];
  for (const design of approved) {
    const quote = await deps.pricer.quote(design.composition);
    items.push({ designId: design.id, version: design.version, label: design.label, display: quote.display });
  }
  return toPublicEvent({
    type: "cart_summary",
    approved: items,
    later: laterDesigns(journey, designs).map((design) => ({ designId: design.id, label: design.label })),
    inCart: designs.filter((design) => isInCart(journey, design)).map((design) => ({ designId: design.id, label: design.label })),
    total: await roomTotal(deps, approved),
    warning: data.texts.customMadeWarning,
  });
}

/**
 * The design a product card is about: the one on screen if it still waits
 * for a decision, else the next undecided one.
 */
export function focusDesign(session: KoshoySessionState, view: JourneyView): KoshoyDesign | null {
  const active = view.designs.find((design) => design.id === session.activeDesignId);
  if (active && approvalOf(session.journey, active) === "pending") return active;
  return nextPendingDesign(session.journey, view.designs);
}

/** The card of the current stage; none before the set exists or while style is asked in the chat. */
export async function stageCards(
  deps: KoshoyDesignDeps,
  session: KoshoySessionState,
  view: JourneyView,
  data: KoshoyJourneyData,
  options: JourneyOptions & { photo: boolean },
): Promise<PublicEvent[]> {
  let card: PublicEvent | null = null;
  if (view.stage === "room_structure") card = structureEvent(options.photo);
  if (view.stage === "room_approval") card = await roomSummaryEvent(deps, session, view.designs, data, options);
  if (view.stage === "product_approval") {
    const design = focusDesign(session, view);
    if (design) card = productCardEvent(session.journey, view.designs, design);
  }
  if (view.stage === "cart") card = await cartSummaryEvent(deps, session.journey, view.designs, data);
  return card ? [card] : [];
}

/* ---------------- model notes ---------------- */

/** The questions a kind asks at one level, as a note for the model (data, kinds doc). */
export function questionNote(data: KoshoyJourneyData, kinds: Iterable<DesignKind>, level: "room" | "product"): string {
  const lines: string[] = [];
  for (const kind of new Set(kinds)) {
    const row = data.kinds.find((item) => item.kind === kind);
    for (const question of row?.questions ?? []) {
      if (question.level !== level) continue;
      const answers = question.options.map((option) => `${option.label} → ${option.hint}`).join("; ");
      lines.push(`${row?.label ?? DESIGN_KIND_LABELS[kind]}: "${question.question}" (${answers})`);
    }
  }
  return lines.join(" | ");
}

const DECISION_NAMES: Record<StyleDecision, string> = {
  level: "seçim seviyesi",
  panel: "renk",
  front: "kapak",
  crown: "uzun dolaplarda taç",
  handle: "kulp rengi",
};

/**
 * One line telling the model where the customer is and what comes next.
 * Sent with every hop (instructions.ts).
 */
export function stageNote(
  view: JourneyView,
  session: KoshoySessionState,
  data: KoshoyJourneyData,
): string {
  const { journey } = session;
  const active = view.designs.find((design) => design.id === session.activeDesignId) ?? null;
  switch (view.stage) {
    case "room_what": {
      if (journey.kind === "single") {
        return "Aşama: ürün. Müşteri tek bir ürün istiyor; ürünü öğren, dış ölçüyü değiştiren soruyu sor, plan_cabinet ile kur. Oda seti önerme.";
      }
      const room = data.rooms.find((item) => item.id === session.brief.room || item.label === session.brief.room);
      const questions = room ? questionNote(data, room.items.map((item) => item.kind), "room") : "";
      const set = view.designs.length
        ? ""
        : ` Oda belliyse setini tek cümleyle öner (müşteri ekler ya da çıkarır), sonra plan_room ile kur.${
            questions ? ` Kurmadan önce ölçüyü değiştiren soruları ask_user ile tek tek sor (cevaba göre targetWidthCm): ${questions}` : ""
          }`;
      return `Aşama: oda. Oda belli değilse ask_user ile sor.${set}`;
    }
    case "room_structure":
      return "Aşama: odanın yapısı. Ekranda fotoğraf / ölçü / ölçüsüz devam kartı var; müşterinin seçmesini bekle, başka soru sorma.";
    case "room_style": {
      const next = view.missingStyle[0];
      const rest = view.missingStyle.slice(1).map((decision) => DECISION_NAMES[decision]).join(", ");
      return `Aşama: tarz. Sıradaki karar: ${DECISION_NAMES[next]}; ask_style ile sor (seçenekleri, resimleri ve fiyatları sistem hazırlar). Önceki seçimi sistem zaten yazdı; özetleme, tek kısa cümle yeter.${rest ? ` Sonra: ${rest}.` : ""}`;
    }
    case "room_approval":
      return journey.kind === "single"
        ? "Aşama: onay. Ekranda ürün özeti var; müşterinin onaylamasını bekle. Değişiklik isterse yap."
        : "Aşama: oda onayı. Ekranda oda özeti var; müşterinin \"Odamı onayla\" demesini bekle. Değişiklik isterse yap; özet yenilenir.";
    case "product_approval": {
      const pending = nextPendingDesign(journey, view.designs);
      const design = active && approvalOf(journey, active) === "pending" ? active : pending;
      if (!design) return "Aşama: ürün ürün onay.";
      const questions = questionNote(data, [design.kind], "product");
      return `Aşama: ürün ürün onay. Ekranda ${design.label} kartı var; onayı müşteri karttaki düğmelerle verir (sen "onayladım" deme). ${
        questions
          ? `Bu ürünün iç düzen sorusunu ask_user ile sor (cevaba göre edit_design): ${questions}`
          : "Bu ürün için sorulacak soru yok; soru ya da onay seçeneği gösterme, ürünü tek cümleyle anlat."
      }`;
    }
    case "cart":
      return "Aşama: sepet. Bütün ürünler kararlaştırıldı; ekranda sepet özeti var. Onaylı ürünleri sepete göndermesini öner.";
  }
}
