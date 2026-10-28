/**
 * Koshoy chat turn. Modelled on runShoppingChatTurn (hops, toolResults,
 * pending ask_user) but separate: tag "koshoy-chat", Koshoy tools, model text
 * buffered per hop and passed through checkReply, every event whitelisted.
 */
import { randomUUID } from "node:crypto";
import {
  streamLlmGatewayResponses,
  type LlmStreamEvent,
} from "../services/llm-gateway.server";
import {
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  type CabinColorId,
  type DesignKind,
} from "./engine";
import { bodyColorIds, colorIdInText, colorLabel } from "./shop-colors";
import {
  errorEvent,
  PRICE_PLACEHOLDER,
  toPublicEvent,
  type ChoiceOption,
  type PublicEvent,
} from "./events";
import { parseEditOp, type ClientInput, type JourneyAction } from "./input";
import { koshoyInstructions, koshoyModelContext } from "./instructions";
import {
  checkReply,
  classifyScope,
  kindFromText,
  kindsInText,
  meansWholeSet,
  KOSHOY_SAFE_STOPPED_REPLY,
  numbersIn,
  pricesIn,
} from "./rules";
import { isKoshoyToolName, KOSHOY_ROOM_TOOL_NAMES, KOSHOY_TOOL_NAMES, koshoyTools } from "./tools";
import type { KoshoyRoomDeps } from "./room.server";
import {
  addNewDesignToRoom,
  addSetToLayout,
  roomHopContext,
  runRoomTool,
  settleRoomAfterEdit,
  type RoomToolContext,
} from "./room-tools.server";
import {
  applyDesignEdit,
  createPlannedDesign,
  designBriefForModel,
  designForModel,
  designsEvent,
  DESIGN_LIMIT_HINT,
  editRejectHint,
  editWarningNotes,
  priceEvent,
  quoteParts,
  resolveDesign,
  sceneEvent,
  setTotalEvent,
  type KoshoyDesignDeps,
} from "./design-ops.server";
import {
  appendTranscriptEvent,
  type KoshoyDesign,
  type KoshoyPendingOption,
  type KoshoyPendingTool,
  type KoshoySessionState,
} from "./store.server";
import { approvalOf, nextPendingDesign, type JourneyStage, type StyleDecision } from "./journey";
import type { KoshoyJourneyEvent } from "./journey-events.server";
import {
  applyStyleDecision,
  journeyView,
  NO_HANDLES,
  parseStyleValue,
  focusDesign,
  stageCards,
  stageNote,
  styleChoices,
  styleDesign,
  type JourneyOptions,
  type KoshoyJourneyData,
} from "./journey.server";

export const KOSHOY_MAX_HOPS = 16;
export const KOSHOY_CHAT_TAG = "koshoy-chat";
/** Whole-turn deadline; a stalled upstream must not hold the session lock. */
export const KOSHOY_TURN_TIMEOUT_MS = 90_000;
const BRIEF_FIELD_MAX = { room: 60, style: 60, notes: 160 } as const;

/**
 * `signal` is passed for streams that can cancel their request; one that
 * ignores it is still cut off by the turn (its late events are dropped).
 */
export type KoshoyStreamFn = (
  apiKey: string,
  body: Record<string, unknown>,
  onEvent: (event: LlmStreamEvent) => void,
  signal?: AbortSignal,
) => Promise<void>;

export interface KoshoyTurnDeps extends KoshoyDesignDeps {
  apiKey: string;
  /** Scripted local turn, no network (dev / tests). */
  mock: boolean;
  stream?: KoshoyStreamFn;
  /** Aborted when the storefront goes away (request closed / SSE cancelled). */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Room photo feature (Sugar S3 + gateway configured): the room tools and blocks are on. */
  room?: KoshoyRoomDeps;
  /** Akın's journey data (data.server.ts snapshot): rooms, questions, levels, texts, pictures. */
  data: KoshoyJourneyData;
  /** Handle colours of the shop (none yet: the shop has no handle products). */
  handles?: JourneyOptions;
  /** Signed-in shop customer (App Proxy); the room approval needs one ("Odanı kaydedelim"). */
  customerId?: string | null;
  /** Journey measurement (journey-events.server.ts); never throws. */
  track?: (name: KoshoyJourneyEvent, props?: Record<string, string | number>) => void;
}

export interface KoshoyToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface TurnContext {
  session: KoshoySessionState;
  deps: KoshoyTurnDeps;
  /** Numbers the reply may contain: tool payloads + server-side design facts. */
  allowed: Set<string>;
  /** Amounts the reply may quote with a currency: price texts from tools only. */
  prices: Set<string>;
  designIds: Set<string>;
  /** The design on screen when the customer wrote (a tab sets it); edits go there, see editTarget. */
  openDesignId: string | null;
  /** What the customer wrote this turn: names another design or the whole set. */
  customerText: string;
  /** Designs made in this turn; the model may edit them right away. */
  createdIds: Set<string>;
  stop: TurnStop;
  textSent: boolean;
  /** Public event types sent this turn ("choice", "scene", …). */
  shown: Set<string>;
  /** An ask_user call was sent back to the model (asked beside other tools, or unusable options). */
  askMissed: boolean;
  /** Server-side one-line summary of what this turn's tools did. */
  summary: string;
  /** Designs, style or approvals changed this turn: the stage card is shown again. */
  journeyChanged: boolean;
  stageAtStart: JourneyStage | null;
  /** Stage cards already sent this turn (by content), so none is sent twice. */
  cardsShown: Set<string>;
  publish(raw: unknown): void;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Customer words kept in the brief: one short line, no quotes or markup. */
function briefText(value: unknown, max: number): string {
  return str(value)
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}"'`<>{}[\]\\]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/* ---------------- deadline / cancellation ---------------- */

interface TurnStop {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

class KoshoyTurnStopped extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? "koshoy turn timed out" : "koshoy client went away");
  }
}

function createTurnStop(outer: AbortSignal | undefined, timeoutMs: number): TurnStop {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuter = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

function throwIfStopped(stop: TurnStop) {
  if (stop.signal.aborted) throw new KoshoyTurnStopped(stop.timedOut());
}

/**
 * Runs one model hop until it ends or the turn is stopped. Events arriving
 * after a stop are ignored, so a stalled upstream cannot keep the turn open.
 */
async function streamUntilStopped(
  stop: TurnStop,
  run: (onEvent: (event: LlmStreamEvent) => void, signal: AbortSignal) => Promise<void>,
  onEvent: (event: LlmStreamEvent) => void,
) {
  throwIfStopped(stop);
  let live = true;
  let onAbort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new KoshoyTurnStopped(stop.timedOut()));
    stop.signal.addEventListener("abort", onAbort, { once: true });
  });
  // The loser of the race must not surface as an unhandled rejection.
  stopped.catch(() => {});
  try {
    const hop = run((event) => {
      if (live) onEvent(event);
    }, stop.signal);
    hop.catch(() => {});
    await Promise.race([hop, stopped]);
  } finally {
    live = false;
    stop.signal.removeEventListener("abort", onAbort);
  }
}

/* ---------------- stream parsing ---------------- */

export function collectKoshoyToolCalls(event: string, data: unknown): KoshoyToolCall[] {
  if (event !== "tool_call" && event !== "message" && event !== "") return [];
  const rows = Array.isArray(data) ? data : [data];
  const out: KoshoyToolCall[] = [];
  for (const item of rows) {
    const row = asRecord(item);
    const id = String(row.id ?? row.callId ?? row.call_id ?? "").trim();
    const name = String(row.name ?? row.toolName ?? row.tool_name ?? "").trim();
    if (!id || !name) continue;
    const looksLikeTool =
      event === "tool_call" ||
      "arguments" in row ||
      "callId" in row ||
      "call_id" in row ||
      (KOSHOY_TOOL_NAMES as readonly string[]).includes(name);
    if (!looksLikeTool) continue;
    let args = row.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    out.push({ id, name, arguments: asRecord(args) });
  }
  return out;
}

function dedupeToolCalls(calls: KoshoyToolCall[]): KoshoyToolCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    if (seen.has(call.id)) return false;
    seen.add(call.id);
    return true;
  });
}

function textFromEvent(event: string, data: unknown): string {
  if (event !== "text") return "";
  if (typeof data === "string") return data;
  const row = asRecord(data);
  return row.text == null ? "" : String(row.text);
}

function isMissingToolOutput(data: unknown): boolean {
  const row = asRecord(data);
  return /No tool output found/i.test(String(row.message ?? row.text ?? ""));
}

/* ---------------- pending ask_user ---------------- */

/** What a journey button says, before the server has run it (runJourneyAction). */
const JOURNEY_ACTION_TEXTS: Record<JourneyAction, string> = {
  structure_skip: "Ölçü vermeden devam edelim.",
  measure: "Ölçümü yazdım.",
  approve_room: "Odamı onaylıyorum.",
  change_room: "Odada değişiklik istiyorum.",
  approve: "Bu ürünü onaylıyorum.",
  approve_same: "Aynı ürünleri birlikte onaylıyorum.",
  change: "Bu üründe değişiklik istiyorum.",
  later: "Bu ürüne sonra karar vereceğim.",
  remove: "Bu ürünü istemiyorum.",
  revisit: "Bu ürüne şimdi karar vereyim.",
};

function clientText(input: ClientInput): string {
  if (input.type === "message") return input.text;
  if (input.type === "choice") return input.label || input.selected;
  if (input.type === "journey") return JOURNEY_ACTION_TEXTS[input.action];
  // The screen already shows the cart outcome; the model must not invent a
  // cause or a fix (it used to suggest reloading the page).
  return input.ok
    ? "Müşteri tasarımı sepete ekledi."
    : "Müşteri tasarımı sepete ekleyemedi; ekran hatayı zaten gösterdi. Sebep tahmin etme, " +
        "sayfayı yenilemek gibi bir çözüm önerme. Tek cümleyle tasarımın kayıtlı kaldığını ve " +
        "birazdan tekrar deneyebileceğini söyle.";
}

/** Tools that show choices and wait for the customer; their result is the customer's answer. */
const QUESTION_TOOLS: ReadonlySet<string> = new Set(["ask_user", "ask_style"]);

export function completePendingTools(
  pendingTools: KoshoyPendingTool[],
  client: ClientInput,
): KoshoyPendingTool[] {
  return pendingTools.map((tool) => {
    if (!QUESTION_TOOLS.has(tool.name)) {
      return { id: tool.id, name: tool.name, payload: tool.payload };
    }
    const question = tool.payload.question ?? "";
    if (client.type === "choice") {
      return {
        id: tool.id,
        name: tool.name,
        payload: { question, selected: client.selected, label: client.label || client.selected },
      };
    }
    if (client.type === "add_cart_result") {
      return {
        id: tool.id,
        name: tool.name,
        payload: { question, selected: client.ok ? "cart_ok" : "cart_error", label: clientText(client) },
      };
    }
    return {
      id: tool.id,
      name: tool.name,
      payload: { question, selected: "free_text", label: clientText(client) },
    };
  });
}

/**
 * The storefront answers with the public option id ("opt_2"); map it back
 * to the id the model chose and the server-side label.
 */
export function resolveKoshoyChoice(
  session: KoshoySessionState,
  client: ClientInput,
): ClientInput {
  if (client.type !== "choice" || !session.pendingAskUser) return client;
  const option = session.pendingAskUser.options.find((item) => item.id === client.selected);
  if (!option) return client;
  return { type: "choice", selected: option.value || option.id, label: option.label };
}

export function startKoshoyHop(
  session: KoshoySessionState,
  client: ClientInput,
): { message?: string; toolResults?: KoshoyPendingTool[]; followUp?: string } {
  if (session.pendingTools.length) {
    const asked = session.pendingTools.some((tool) => QUESTION_TOOLS.has(tool.name));
    const toolResults = completePendingTools(session.pendingTools, client);
    session.pendingTools = [];
    session.pendingAskUser = null;
    // Results left by a turn that ran out of hops: answer them first, then
    // send what the customer just said.
    return asked ? { toolResults } : { toolResults, followUp: clientText(client) };
  }
  if (client.type === "choice" && session.pendingAskUser) {
    const toolResults = completePendingTools(
      [
        {
          id: session.pendingAskUser.id,
          name: session.pendingAskUser.tool ?? "ask_user",
          payload: { question: session.pendingAskUser.question },
        },
      ],
      client,
    );
    session.pendingAskUser = null;
    return { toolResults };
  }
  return { message: clientText(client) };
}

function rotateModelSession(session: KoshoySessionState) {
  session.modelSessionId = randomUUID();
  session.pendingAskUser = null;
  session.pendingTools = [];
  // A new model conversation has not seen the room photo.
  session.photoSentRoomId = null;
}

/* ---------------- tools ---------------- */

const ASK_ALONE_HINT =
  "Soru gösterilmedi. Diğer araçların sonucunu müşteriye kısaca yaz, sonra soruyu ask_user ile tek başına (aynı yanıtta başka araç olmadan) sor.";

const ASK_AGAIN_NUDGE =
  "[Sistem notu] Müşteriye seçenek gösterilmedi; ekranda tıklayabileceği bir şey yok. Soruyu şimdi ask_user ile tek başına sor.";

const SILENT_TURN_NUDGE =
  "[Sistem notu] Bu turda müşteriye hiçbir şey gösterilmedi. Müşterinin son cevabına göre devam et: gereken aracı çağır ya da kısa bir cevap yaz.";

const SET_EXISTS_HINT =
  "Bu sohbette tasarımlar zaten var. Rengi bütün sette değiştirmek için edit_design'ı allDesigns: true ile çağır; yeni ürün eklemek için plan_room'a items ver ya da plan_cabinet kullan.";

async function quoteAndPublish(ctx: TurnContext, design: KoshoyDesign, withScene: boolean) {
  const quote = await ctx.deps.pricer.quote(design.composition);
  if (withScene) ctx.publish(sceneEvent(design));
  ctx.publish(priceEvent(design, quote));
  return quote;
}

/**
 * The design an edit may change: the one on screen when the customer wrote,
 * unless the customer named the other one's kind ("gardırobu beyaz yap") or
 * it was made in this turn. What the model remembers from earlier in the
 * conversation does not count (ClickUp z8qu5d6gzx).
 */
async function editTarget(ctx: TurnContext, wanted: KoshoyDesign | null): Promise<KoshoyDesign | null> {
  const open = ctx.openDesignId;
  if (!wanted || !open || wanted.id === open) return wanted;
  if (ctx.createdIds.has(wanted.id) || kindsInText(ctx.customerText).has(wanted.kind)) return wanted;
  return (await ctx.deps.store.getDesign(ctx.session.id, open)) ?? wanted;
}

function openDesignNote(label: string): string {
  return `Müşteri ekranda ${label} tasarımına bakıyor; değişiklik yalnız ona uygulandı.`;
}

const STYLE_DECISIONS: readonly StyleDecision[] = ["level", "panel", "front", "crown", "handle"];

const STYLE_BEFORE_SET_HINT = "Tarz kararları ürünler kurulduktan sonra sorulur; önce odanın setini kur.";

const NO_HANDLES_HINT = "Kulp seçeneği yok; kulptan hiç söz etme, sıradaki karara geç.";

const ALREADY_DECIDED_HINT =
  "Bu karar zaten verildi; tekrar sorma. Müşteri bunu değiştirmek isterse ask_style'ı change: true ile çağır.";

interface PlannedItem {
  kind: DesignKind;
  count: number;
  widthMm?: number;
}

function widthMmFrom(cm: unknown): number | undefined {
  const value = Number(cm);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 10) : undefined;
}

/**
 * One planned design per product. Kinds that stand together on one wall
 * (joinSameKind, e.g. kitaplık) become one design as wide as all of them,
 * so the core splits it into equal bodies: 2 kitaplık → 3 × 64 cm.
 */
function designsToPlan(ctx: TurnContext, items: ReadonlyArray<PlannedItem>): Array<{ kind: DesignKind; widthMm?: number }> {
  const out: Array<{ kind: DesignKind; widthMm?: number }> = [];
  for (const item of items) {
    const join = ctx.deps.data.kinds.find((row) => row.kind === item.kind)?.joinSameKind === true;
    if (join && item.count > 1) {
      const single = item.widthMm ?? totalWidthMm(ctx.deps.engine.planCabinet({ kind: item.kind }).composition);
      out.push({ kind: item.kind, widthMm: single * item.count });
      continue;
    }
    for (let i = 0; i < Math.max(0, item.count); i += 1) out.push({ kind: item.kind, widthMm: item.widthMm });
  }
  return out;
}

function totalWidthMm(composition: { units: ReadonlyArray<{ widthMm: number }> }): number {
  return composition.units.reduce((sum, unit) => sum + unit.widthMm, 0);
}

/** A new design in the room's style (colour, front, crown), counted as this turn's. */
async function planStyledDesign(
  ctx: TurnContext,
  kind: DesignKind,
  targetWidthMm: number | undefined,
  color: CabinColorId | undefined,
) {
  const { session, deps } = ctx;
  const created = await createPlannedDesign(deps, session, {
    kind,
    targetWidthMm,
    color: color ?? (session.journey.style.panel || session.brief.color || undefined),
  });
  if (!created) return null;
  const design = await styleDesign(deps, session.id, created.design, { ...session.journey.style, panel: "" });
  ctx.designIds.add(design.id);
  ctx.createdIds.add(design.id);
  ctx.journeyChanged = true;
  return { design, plan: created.plan };
}

export async function executeKoshoyTool(
  call: KoshoyToolCall,
  ctx: TurnContext,
): Promise<{ payload: Record<string, unknown>; askedUser?: boolean }> {
  const { session, deps } = ctx;
  const args = call.arguments;
  if (KOSHOY_ROOM_TOOL_NAMES.includes(call.name)) {
    const room = roomToolContext(ctx);
    return { payload: room ? await runRoomTool(room, call.name, args) : { ok: false, error: "unsupported_tool" } };
  }

  if (call.name === "set_brief") {
    const color = oneOf(args.color, bodyColorIds());
    const room = briefText(args.room, BRIEF_FIELD_MAX.room);
    // The brief is replayed to the model on every hop: keep it short and flat.
    session.brief = {
      room: room || session.brief.room,
      style: briefText(args.style, BRIEF_FIELD_MAX.style) || session.brief.style,
      level: session.brief.level,
      color: color ?? session.brief.color,
      notes: briefText(args.notes, BRIEF_FIELD_MAX.notes) || session.brief.notes,
    };
    const designs = await deps.store.listDesigns(session.id);
    // The one-product buyer is decided before anything is planned.
    if (args.single === true && !designs.length) session.journey.kind = "single";
    if (room) deps.track?.("room_chosen", { room: session.brief.room });
    // A colour the customer named is the room's panel colour: it is not asked again.
    if (color && color !== session.journey.style.panel) {
      const applied = await applyStyleDecision(deps, session, deps.data, "panel", color, deps.handles);
      if (applied.designs.length) await publishDesigns(ctx, applied.designs);
      ctx.journeyChanged = true;
    }
    return { payload: { ok: true } };
  }

  if (call.name === "ask_style") {
    const decision = oneOf(args.decision, STYLE_DECISIONS);
    if (!decision) return { payload: { ok: false, error: "invalid_decision" } };
    if (decision === "handle" && !deps.handles?.handles.length) {
      return { payload: { ok: false, error: "no_handles", hint: NO_HANDLES_HINT } };
    }
    const designs = await deps.store.listDesigns(session.id);
    if (!designs.length) return { payload: { ok: false, error: "no_designs", hint: STYLE_BEFORE_SET_HINT } };
    // A decision already taken is asked again only when the customer wants to change it.
    const view = await journeyView(deps, session, deps.data, deps.handles);
    if (!view.missingStyle.includes(decision) && args.change !== true) {
      return { payload: { ok: false, error: "already_decided", hint: `${ALREADY_DECIDED_HINT} ${stageNote(view, session, deps.data)}` } };
    }
    const choice = await styleChoices(deps, designs, deps.data, decision, deps.handles);
    if (choice.options.length < 2) return { payload: { ok: false, error: "no_choice" } };
    session.pendingAskUser = { id: call.id, tool: "ask_style", question: choice.question, options: choice.options };
    ctx.publish({
      type: "choice",
      question: choice.question,
      options: choice.options.map(({ value: _value, ...option }) => option),
    });
    return {
      payload: {
        ok: true,
        question: choice.question,
        options: choice.options.map((option) => ({ label: option.label, ...(option.price ? { price: option.price } : {}) })),
      },
      askedUser: true,
    };
  }

  if (call.name === "ask_user") {
    // Choices are model text too: labels that fail the guard are dropped.
    const options: ChoiceOption[] = (Array.isArray(args.options) ? args.options : [])
      .map((option) => {
        const row = asRecord(option);
        return { id: str(row.id), label: str(row.label) };
      })
      .filter(
        (option) =>
          /^[A-Za-z0-9_-]{1,64}$/.test(option.id) &&
          option.label &&
          !checkReply(option.label, ctx.allowed, ctx.prices).issues.length,
      )
      .slice(0, 4);
    if (options.length < 2) {
      ctx.askMissed = true;
      return { payload: { ok: false, error: "need 2-4 options in product language, no numbers" } };
    }
    const asked = checkReply(str(args.question), ctx.allowed, ctx.prices);
    const question = asked.text && !asked.issues.length ? asked.text : "Hangisini seçersin?";
    // Model-chosen ids stay here; the storefront only sees opt_1..opt_4.
    const pending: KoshoyPendingOption[] = options.map((option, index) => ({
      id: `opt_${index + 1}`,
      label: option.label,
      value: option.id,
    }));
    session.pendingAskUser = { id: call.id, question, options: pending };
    ctx.publish({
      type: "choice",
      question,
      options: pending.map(({ id, label }) => ({ id, label })),
    });
    return { payload: { ok: true, question, options }, askedUser: true };
  }

  if (call.name === "plan_cabinet") {
    const kind = oneOf(args.kind, DESIGN_KINDS);
    if (!kind) return { payload: { ok: false, error: "unsupported_kind" } };
    ctx.publish({ type: "status", key: "placing" });
    const created = await planStyledDesign(ctx, kind, widthMmFrom(args.targetWidthCm), oneOf(args.color, bodyColorIds()));
    if (!created) return { payload: { ok: false, error: "design_limit", hint: DESIGN_LIMIT_HINT } };
    const { design, plan } = created;
    ctx.designIds.add(design.id);
    ctx.createdIds.add(design.id);
    ctx.summary = [`Senin için ${design.label} hazırladım.`, ...plan.notes.map((note) => `${note}.`)].join(" ");
    deps.track?.("set_planned", { kind, count: 1 });
    const quote = await quoteAndPublish(ctx, design, true);
    ctx.publish(designsEvent(await deps.store.listDesigns(session.id), session.activeDesignId));
    // With a ready room the new design walks in on its own when there is space.
    const room = roomToolContext(ctx);
    const roomNote = room ? await addNewDesignToRoom(room, design) : null;
    return {
      payload: {
        ok: true,
        notes: plan.notes,
        price: quote.display,
        design: designForModel(design, true),
        ...(roomNote ? { room: roomNote } : {}),
      },
    };
  }

  if (call.name === "plan_room") {
    const wanted = str(args.room).toLocaleLowerCase("tr-TR");
    const set = deps.data.rooms.find(
      (room) => room.id === wanted || room.label.toLocaleLowerCase("tr-TR") === wanted,
    );
    if (!set) return { payload: { ok: false, error: "unsupported_room" } };
    const asked: PlannedItem[] = (Array.isArray(args.items) ? args.items : []).flatMap((raw) => {
      const row = asRecord(raw);
      const kind = oneOf(row.kind, DESIGN_KINDS);
      const count = Number.isInteger(row.count) ? Math.min(Math.max(Number(row.count), 1), 4) : 1;
      return kind ? [{ kind, count, widthMm: widthMmFrom(row.widthCm) }] : [];
    });
    // The set is planned once; later the model changes it or adds named products.
    if (!asked.length && (await deps.store.listDesigns(session.id)).length) {
      return { payload: { ok: false, error: "set_exists", hint: SET_EXISTS_HINT } };
    }
    const color = oneOf(args.color, bodyColorIds());
    session.brief = { ...session.brief, room: session.brief.room || set.label };
    ctx.publish({ type: "status", key: "placing" });
    const planned: KoshoyDesign[] = [];
    const notes: string[] = [];
    for (const item of designsToPlan(ctx, asked.length ? asked : set.items)) {
      const created = await planStyledDesign(ctx, item.kind, item.widthMm, color);
      if (!created) {
        notes.push(DESIGN_LIMIT_HINT);
        break;
      }
      planned.push(created.design);
      notes.push(...created.plan.notes);
    }
    if (!planned.length) return { payload: { ok: false, error: "design_limit", hint: DESIGN_LIMIT_HINT } };
    // The first product of the set is the one the details start with.
    session.activeDesignId = planned[0].id;
    const priced = [];
    for (const design of planned) {
      const quote = await quoteAndPublish(ctx, design, true);
      priced.push({ ...designBriefForModel(design), price: quote.display });
    }
    ctx.publish(designsEvent(await deps.store.listDesigns(session.id), session.activeDesignId));
    const room = roomToolContext(ctx);
    const placeNote = room ? await addSetToLayout(room, planned) : null;
    if (placeNote) notes.push(placeNote);
    ctx.summary = `${set.label} için ${planned.map((design) => design.label).join(", ")} hazırladım.`;
    deps.track?.("set_planned", { room: set.id, count: planned.length });
    return {
      payload: {
        ok: true,
        room: set.label,
        designs: priced,
        ...(notes.length ? { notes } : {}),
        design: designForModel(planned[0], true),
      },
    };
  }

  if (call.name === "edit_design" && args.allDesigns === true && meansWholeSet(ctx.customerText)) {
    const op = parseEditOp(args.op);
    if (!op || op.action !== "set_color") return { payload: { ok: false, error: "invalid_op" } };
    ctx.publish({ type: "status", key: "placing" });
    const room = roomToolContext(ctx);
    let changed = 0;
    // The active design goes last, so the storefront keeps showing it.
    const designs = await deps.store.listDesigns(session.id);
    const ordered = [
      ...designs.filter((design) => design.id !== session.activeDesignId),
      ...designs.filter((design) => design.id === session.activeDesignId),
    ];
    for (const design of ordered) {
      const result = await applyDesignEdit(deps, session.id, design, op);
      if (!result.ok || !result.changed) continue;
      changed += 1;
      ctx.journeyChanged = true;
      if (room) await settleRoomAfterEdit(room, design, result.design);
      await quoteAndPublish(ctx, result.design, true);
    }
    if (changed) ctx.summary = "Bütün tasarımların rengini güncelledim.";
    return { payload: { ok: true, changed } };
  }

  if (call.name === "edit_design") {
    const wanted = await resolveDesign(deps, session, str(args.designId));
    const design = await editTarget(ctx, wanted);
    if (!design) return { payload: { ok: false, error: "design_not_found" } };
    const op = parseEditOp(args.op);
    if (!op) return { payload: { ok: false, error: "invalid_op" } };
    ctx.publish({ type: "status", key: "placing" });
    const result = await applyDesignEdit(deps, session.id, design, op);
    if (!result.ok) {
      // Product-language reason only; engine codes stay on the server.
      return { payload: { ok: false, error: "rejected", hint: editRejectHint(result.reason) } };
    }
    const switched = session.activeDesignId !== result.design.id;
    if (result.changed) {
      ctx.summary = `${result.design.label} tasarımını güncelledim.`;
      ctx.journeyChanged = true;
    }
    const room = roomToolContext(ctx);
    if (room && result.changed) await settleRoomAfterEdit(room, design, result.design);
    session.activeDesignId = result.design.id;
    const quote = await quoteAndPublish(ctx, result.design, result.changed || switched);
    if (result.design.label !== design.label || switched) {
      ctx.publish(designsEvent(await deps.store.listDesigns(session.id), session.activeDesignId));
    }
    const notes = result.changed
      ? editWarningNotes(result.warnings)
      : [editRejectHint("no_change")];
    if (design.id !== wanted?.id || args.allDesigns === true) notes.push(openDesignNote(design.label));
    return {
      payload: {
        ok: true,
        changed: result.changed,
        ...(notes.length ? { notes } : {}),
        price: quote.display,
        design: designForModel(result.design, true),
      },
    };
  }

  if (call.name === "quote") {
    const design = await resolveDesign(deps, session, str(args.designId));
    if (!design) return { payload: { ok: false, error: "design_not_found" } };
    ctx.publish({ type: "status", key: "pricing" });
    const quote = await quoteAndPublish(ctx, design, false);
    return {
      payload: {
        ok: true,
        designId: design.id,
        price: quote.display,
        priced: quote.totalCents !== null,
        parts: quoteParts(quote),
      },
    };
  }

  if (call.name === "switch_design") {
    const design = await deps.store.getDesign(session.id, str(args.designId));
    if (!design) return { payload: { ok: false, error: "design_not_found" } };
    ctx.publish({ type: "status", key: "preparing" });
    session.activeDesignId = design.id;
    ctx.publish(designsEvent(await deps.store.listDesigns(session.id), session.activeDesignId));
    const quote = await quoteAndPublish(ctx, design, true);
    return { payload: { ok: true, price: quote.display, design: designForModel(design, true) } };
  }

  if (call.name === "show_doors") {
    const design = await resolveDesign(deps, session);
    if (!design) return { payload: { ok: false, error: "design_not_found" } };
    if (!design.composition.units.some((unit) => unit.hasDoor)) {
      return { payload: { ok: false, error: "rejected", hint: editRejectHint("no_door") } };
    }
    const open = args.open !== false;
    ctx.publish({ type: "doors", open });
    return { payload: { ok: true, open } };
  }

  return { payload: { ok: false, error: "unsupported_tool" } };
}

/** Tools whose payloads are server facts; their numbers may appear in replies. */
const FACT_TOOLS = new Set(["plan_cabinet", "plan_room", "edit_design", "quote", "switch_design", "ask_style"]);

async function runTool(call: KoshoyToolCall, ctx: TurnContext) {
  const result = isKoshoyToolName(call.name)
    ? await executeKoshoyTool(call, ctx)
    : { payload: { ok: false, error: "unsupported_tool" } as Record<string, unknown> };
  if (FACT_TOOLS.has(call.name)) {
    numbersIn(result.payload, ctx.allowed);
    pricesIn(result.payload, ctx.prices);
  }
  // Room tools' lengths come from the room's measurements: never said to the
  // customer (ClickUp z8qu5d7rdp), so they never become allowed numbers.
  return result;
}

/** The room tools' view of the turn; null while the room feature is off. */
function roomToolContext(ctx: TurnContext): RoomToolContext | null {
  const room = ctx.deps.room;
  return room ? { session: ctx.session, store: ctx.deps.store, room, publish: ctx.publish } : null;
}

/* ---------------- text ---------------- */

function publishText(ctx: TurnContext, raw: string) {
  let text = raw;
  for (const id of ctx.designIds) text = text.split(id).join("");
  text = text.trim();
  if (!text) return;
  const result = checkReply(text, ctx.allowed, ctx.prices);
  if (result.issues.length) console.warn("[koshoy] reply guarded", result.issues);
  if (!result.text) return;
  ctx.publish({ type: "text", text: (ctx.textSent ? "\n\n" : "") + result.text });
  ctx.textSent = true;
}

/* ---------------- model turn ---------------- */

/**
 * A turn must not leave the customer stuck (ClickUp z8qu5d671e): a question
 * that never reached the screen, a sentence that announces choices
 * ("…rengi seçebilirsin:") without them, or nothing at all. The model gets
 * one more hop to put it right.
 */
function deadEndNudge(ctx: TurnContext, lastText: string): string | null {
  if (ctx.shown.has("choice")) return null;
  if (ctx.askMissed || /:\s*$/.test(lastText)) return ASK_AGAIN_NUDGE;
  if (!ctx.textSent && !ctx.shown.has("scene")) return SILENT_TURN_NUDGE;
  return null;
}

/**
 * With more than one design the customer's message says which one is on
 * screen: the customer may have switched with a tab since the model last spoke.
 */
function withOpenDesign(message: string, designs: readonly KoshoyDesign[], activeDesignId: string | null): string {
  const open = designs.find((design) => design.id === activeDesignId);
  return designs.length > 1 && open ? `[Ekranda açık tasarım: ${open.label}]\n${message}` : message;
}

/**
 * The same note on the customer's answer to ask_user: most turns end with a
 * question, so the customer's next request ("rengini değiştir") arrives as
 * that answer.
 */
function withOpenDesignAnswers(
  results: KoshoyPendingTool[],
  designs: readonly KoshoyDesign[],
  activeDesignId: string | null,
): KoshoyPendingTool[] {
  const open = designs.find((design) => design.id === activeDesignId);
  if (designs.length < 2 || !open) return results;
  return results.map((result) =>
    result.name === "ask_user" ? { ...result, payload: { ...result.payload, openDesign: open.label } } : result,
  );
}

async function runModelTurn(ctx: TurnContext, client: ClientInput) {
  const { session, deps } = ctx;
  const stream = deps.stream ?? streamLlmGatewayResponses;
  const lastUserText = clientText(client);
  const first = startKoshoyHop(session, client);
  let message = first.message;
  let toolResults = first.toolResults;
  let followUp = first.followUp;
  let recovered = false;
  let nudged = false;

  for (let hop = 0; hop < KOSHOY_MAX_HOPS; hop += 1) {
    if (!message && !toolResults) break;
    throwIfStopped(ctx.stop);
    ctx.publish({ type: "status", key: "thinking" });

    const designs = await deps.store.listDesigns(session.id);
    for (const design of designs) ctx.designIds.add(design.id);
    const roomContext = roomToolContext(ctx);
    const hopRoom = roomContext ? await roomHopContext(roomContext, designs, Boolean(message)) : null;
    const view = await journeyView(deps, session, deps.data, deps.handles);
    const instructionInput = {
      brief: session.brief,
      designs,
      activeDesignId: session.activeDesignId,
      roomTools: Boolean(roomContext),
      roomReady: hopRoom?.roomReady ?? false,
      room: hopRoom?.room ?? null,
      layout: hopRoom?.layout ?? null,
      data: deps.data,
      journey: session.journey,
      stage: stageNote(view, session, deps.data),
    };
    // Design facts only; the brief holds customer words, not system numbers.
    // Room sizes are never allowed: they are not said to the customer.
    numbersIn(koshoyModelContext(instructionInput).designs, ctx.allowed);

    const body: Record<string, unknown> = {
      sessionId: session.modelSessionId,
      userId: session.shop,
      tag: KOSHOY_CHAT_TAG,
      jobId: session.id,
      instructions: koshoyInstructions(instructionInput),
      tools: koshoyTools(Boolean(roomContext), { handles: Boolean(deps.handles?.handles.length) }),
      thinkingLevel: "low",
    };
    const platform = process.env.KOSHOY_CHAT_PLATFORM?.trim();
    const model = process.env.KOSHOY_CHAT_MODEL?.trim();
    if (platform) body.platform = platform;
    if (model) body.model = model;
    if (message) body.message = withOpenDesign(message, designs, session.activeDesignId);
    else body.toolResults = withOpenDesignAnswers(toolResults ?? [], designs, session.activeDesignId);
    // The room photo, once per room and model conversation, with a customer message.
    const photo = message ? hopRoom?.photo ?? null : null;
    if (photo) body.image = { contentBase64: photo.contentBase64, mimeType: photo.mimeType };

    let buffer = "";
    const calls: KoshoyToolCall[] = [];
    let upstreamError: unknown = null;
    let missingToolOutput = false;

    await streamUntilStopped(
      ctx.stop,
      (onEvent, signal) => stream(deps.apiKey, body, onEvent, signal),
      ({ event, data }) => {
        if (event === "error") {
          if (!recovered && isMissingToolOutput(data)) {
            missingToolOutput = true;
            return;
          }
          upstreamError = data ?? "error";
          return;
        }
        buffer += textFromEvent(event, data);
        calls.push(...collectKoshoyToolCalls(event, data));
      },
    );

    if (missingToolOutput && !recovered) {
      recovered = true;
      rotateModelSession(session);
      message = lastUserText;
      toolResults = undefined;
      followUp = undefined;
      continue;
    }
    if (upstreamError) {
      console.error("[koshoy] upstream error", upstreamError);
      ctx.publish(errorEvent("unavailable"));
      return;
    }
    // Seen only once the model answered this hop without an error (a timeout
    // or a closed page throws above and leaves it unseen).
    if (photo) session.photoSentRoomId = photo.seenKey;

    publishText(ctx, buffer);

    const unique = dedupeToolCalls(calls);
    if (!unique.length) {
      if (followUp) {
        message = followUp;
        toolResults = undefined;
        followUp = undefined;
        continue;
      }
      const nudge = nudged ? null : deadEndNudge(ctx, buffer);
      if (nudge) {
        nudged = true;
        message = nudge;
        toolResults = undefined;
        continue;
      }
      if (!ctx.textSent && !ctx.shown.has("choice") && !ctx.shown.has("scene")) {
        publishText(ctx, KOSHOY_SAFE_STOPPED_REPLY);
      }
      return;
    }

    const results: KoshoyPendingTool[] = [];
    let askedUser = false;
    // A question goes in a turn of its own. Asked next to other tools, the
    // customer's next words would reach the model beside those results, and it
    // answered the results instead of the customer (ClickUp z8qu5d6gzx).
    const asks = (name: string) => name === "ask_user" || name === "ask_style";
    const askAlone = unique.length > 1 && unique.some((call) => asks(call.name));
    for (const call of unique) {
      if (askAlone && asks(call.name)) {
        ctx.askMissed = true;
        results.push({ id: call.id, name: call.name, payload: { ok: false, error: "ask_alone", hint: ASK_ALONE_HINT } });
        continue;
      }
      const result = await runTool(call, ctx);
      if (result.askedUser) askedUser = true;
      results.push({ id: call.id, name: call.name, payload: result.payload });
    }
    message = undefined;
    toolResults = results;
    if (askedUser) {
      session.pendingTools = results;
      // Some models send only the choice tool; never leave the turn without text.
      if (!ctx.textSent && ctx.summary) publishText(ctx, ctx.summary);
      return;
    }
  }

  // Hop budget spent while the model still waits for tool results: keep
  // them so the next turn answers them first (the model conversation stays
  // valid), and do not leave the customer without a reply.
  if (toolResults) {
    console.error("[koshoy] hop limit reached", { hops: KOSHOY_MAX_HOPS });
    session.pendingTools = toolResults;
  }
  if (!ctx.textSent) publishText(ctx, KOSHOY_SAFE_STOPPED_REPLY);
}

/* ---------------- mock turn (no network) ---------------- */

function widthCmFromText(text: string): number | undefined {
  const match = /(\d+(?:[.,]\d+)?)\s*(cm|santim|metre|m)(?![\p{L}])/iu.exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return /^(m|metre)$/i.test(match[2]) ? Math.round(value * 100) : Math.round(value);
}

function colorFromText(text: string): CabinColorId | undefined {
  return colorIdInText(text);
}

function mockPriceText(price: unknown, lead: string): string {
  const display = String(price ?? "");
  return !display || display === PRICE_PLACEHOLDER
    ? "Fiyatı henüz hazır değil."
    : `${lead} ${display}.`;
}

function mockColorOptions(): ChoiceOption[] {
  return bodyColorIds().map((id) => ({ id: `color_${id}`, label: colorLabel(id) }));
}

const MOCK_KIND_OPTIONS: ChoiceOption[] = (
  ["gardirop", "komodin", "tv_unitesi", "kitaplik"] as const
).map((kind) => ({ id: `kind_${kind}`, label: DESIGN_KIND_LABELS[kind] }));

async function mockPlan(ctx: TurnContext, text: string, kind: (typeof DESIGN_KINDS)[number]) {
  const plan = await runTool(
    {
      id: "mock_plan",
      name: "plan_cabinet",
      arguments: { kind, targetWidthCm: widthCmFromText(text), color: colorFromText(text) },
    },
    ctx,
  );
  const payload = plan.payload;
  if (payload.ok !== true) {
    publishText(ctx, typeof payload.hint === "string" ? payload.hint : "Bu ürünü şu an hazırlayamadım.");
    return;
  }
  const design = asRecord(payload.design);
  const notes = Array.isArray(payload.notes) ? (payload.notes as string[]) : [];
  publishText(
    ctx,
    [
      `Senin için ${String(design.label ?? DESIGN_KIND_LABELS[kind]).toLocaleLowerCase("tr-TR")} hazırladım.`,
      notes.length ? `Ölçüyü kataloğa göre ayarladım: ${notes.join("; ")}.` : "",
      mockPriceText(payload.price, "Fiyatı"),
    ]
      .filter(Boolean)
      .join(" "),
  );
  await runTool(
    {
      id: "mock_ask_color",
      name: "ask_user",
      arguments: { question: "Hangi renkte olsun?", options: mockColorOptions() },
    },
    ctx,
  );
}

async function runMockTurn(ctx: TurnContext, client: ClientInput) {
  const { session } = ctx;
  for (const design of await ctx.deps.store.listDesigns(session.id)) {
    ctx.designIds.add(design.id);
  }
  ctx.publish({ type: "status", key: "thinking" });

  if (client.type === "add_cart_result") {
    publishText(
      ctx,
      client.ok
        ? "Tasarımın sepete eklendi."
        : "Tasarımı sepete ekleyemedim; birazdan tekrar deneyebilirsin.",
    );
    return;
  }

  let text = clientText(client);
  if (client.type === "choice") {
    session.pendingAskUser = null;
    session.pendingTools = [];
    const color = oneOf(/^color_([\w-]+)$/.exec(client.selected)?.[1], bodyColorIds());
    if (color && session.activeDesignId) {
      const edit = await runTool(
        {
          id: "mock_color",
          name: "edit_design",
          arguments: { op: { action: "set_color", target: "all", color } },
        },
        ctx,
      );
      publishText(
        ctx,
        edit.payload.ok
          ? `Rengi ${colorLabel(color).toLocaleLowerCase("tr-TR")} yaptım. ${mockPriceText(edit.payload.price, "Yeni fiyat")}`
          : "Bu rengi şu an uygulayamadım.",
      );
      return;
    }
    const kind = oneOf(/^kind_(\w+)$/.exec(client.selected)?.[1], DESIGN_KINDS);
    if (kind) {
      await mockPlan(ctx, "", kind);
      return;
    }
    text = client.label || client.selected;
  }

  const kind = kindFromText(text);
  if (kind) {
    await mockPlan(ctx, text, kind);
    return;
  }
  if (session.activeDesignId) {
    publishText(
      ctx,
      "Değişiklik için alttaki paneli kullanabilir ya da bana ne istediğini yazabilirsin.",
    );
    return;
  }
  publishText(ctx, "Hangi mobilyayı tasarlayalım?");
  await runTool(
    {
      id: "mock_ask_kind",
      name: "ask_user",
      arguments: { question: "Ne tasarlayalım?", options: MOCK_KIND_OPTIONS },
    },
    ctx,
  );
}

/* ---------------- journey buttons and cards ---------------- */

/**
 * Runs a journey button (journey.ts) and returns what the model is told,
 * in the customer's words; null when the model is not asked (the screen
 * already has the answer, e.g. the sign-in card).
 */
async function runJourneyAction(
  ctx: TurnContext,
  input: Extract<ClientInput, { type: "journey" }>,
): Promise<string | null> {
  const { session, deps } = ctx;
  const journey = session.journey;
  const designs = await deps.store.listDesigns(session.id);

  if (input.action === "structure_skip") {
    journey.structure = "skip";
    ctx.journeyChanged = true;
    deps.track?.("structure_skipped");
    return "Ölçü vermeden devam edelim.";
  }
  if (input.action === "measure" && input.wallCm) {
    journey.structure = "measure";
    journey.measure = { wallCm: input.wallCm, ceilingCm: input.ceilingCm ?? null };
    ctx.journeyChanged = true;
    deps.track?.("structure_measure");
    return "[Sistem notu] Müşteri kendi duvar ölçüsünü yazdı (oda bilgisinde). Ürünler sığmıyorsa küçült; ölçüyü müşteriye söyleme.";
  }
  if (input.action === "approve_room") {
    const view = await journeyView(deps, session, deps.data, deps.handles);
    if (view.stage !== "room_approval") return `[Sistem notu] Müşteri onaylamak istedi ama henüz erken. ${stageNote(view, session, deps.data)}`;
    if (!deps.customerId) {
      // "Odanı kaydedelim" comes right before the approval (ClickUp z8qu5d7rdt).
      ctx.publish({ type: "login_required" });
      return null;
    }
    journey.roomApprovedAt = Date.now();
    journey.roomApproval = {
      designs: designs.map((design) => ({ id: design.id, label: design.label, version: design.version })),
      style: { ...journey.style },
    };
    // The one-product buyer approves the product together with its room topics.
    if (journey.kind === "single") {
      for (const design of designs) journey.approvals[design.id] = { status: "approved", version: design.version };
    }
    ctx.journeyChanged = true;
    deps.track?.("room_approved", { count: designs.length });
    return journey.kind === "single" ? "Ürünü ve seçimlerimi onaylıyorum." : "Odamı onaylıyorum.";
  }
  if (input.action === "change_room") return "Odada değişiklik istiyorum.";

  const design = designs.find((item) => item.id === input.designId);
  if (!design) return "[Sistem notu] Müşterinin seçtiği ürün artık yok.";
  if (journey.roomApprovedAt === null) {
    return "[Sistem notu] Müşteri bir ürüne karar vermek istedi ama oda henüz onaylanmadı; önce oda onayına götür.";
  }
  if (input.action === "change") {
    session.activeDesignId = design.id;
    deps.track?.("product_changed", { kind: design.kind });
    return `${design.label} ürününde değişiklik istiyorum.`;
  }
  if (input.action === "approve" || input.action === "approve_same") {
    const same =
      input.action === "approve_same"
        ? designs.filter((item) => item.kind === design.kind && approvalOf(journey, item) === "pending")
        : [design];
    for (const item of [design, ...same]) journey.approvals[item.id] = { status: "approved", version: item.version };
    ctx.journeyChanged = true;
    deps.track?.("product_approved", { kind: design.kind, count: new Set([design, ...same]).size });
    return input.action === "approve_same" ? `Bütün ${design.label} ürünlerini onaylıyorum.` : `${design.label} onaylıyorum.`;
  }
  if (input.action === "revisit") {
    // A product left for later is decided after all: it is pending again.
    delete journey.approvals[design.id];
    session.activeDesignId = design.id;
    ctx.journeyChanged = true;
    return `${design.label} için şimdi karar vereyim.`;
  }
  if (input.action === "later") {
    journey.approvals[design.id] = { status: "later", version: design.version };
    ctx.journeyChanged = true;
    deps.track?.("product_later", { kind: design.kind });
    return `${design.label} için sonra karar vereceğim.`;
  }
  // remove: the product leaves the room and the conversation.
  const room = roomToolContext(ctx);
  if (room) await runRoomTool(room, "remove_from_room", { designId: design.id });
  await deps.store.deleteDesign(session.id, design.id);
  delete journey.approvals[design.id];
  const left = designs.filter((item) => item.id !== design.id);
  if (session.activeDesignId === design.id) {
    session.activeDesignId = left[0]?.id ?? null;
    if (left[0]) await quoteAndPublish(ctx, left[0], true);
  }
  ctx.publish(designsEvent(left, session.activeDesignId));
  ctx.journeyChanged = true;
  deps.track?.("product_removed", { kind: design.kind });
  return `${design.label} istemiyorum; odadan çıkar.`;
}

/**
 * Shows the card of the stage the customer is in: when the stage changed in
 * this turn, or when the turn changed designs, style or approvals. In the
 * product stage the screen moves to the product being decided on.
 */
async function publishStageCards(ctx: TurnContext) {
  const { session, deps } = ctx;
  await applyOnlyLevel(ctx);
  const view = await journeyView(deps, session, deps.data, deps.handles);
  // Compared with the stage shown last, so a change made outside a turn (a panel edit) is caught too.
  if (view.stage === session.journey.shownStage && !ctx.journeyChanged) return;
  if (ctx.stageAtStart === "room_style" && view.stage !== "room_style") deps.track?.("style_done");
  if (view.stage === "product_approval") {
    const design = focusDesign(session, view);
    if (design && design.id !== session.activeDesignId) {
      session.activeDesignId = design.id;
      ctx.publish(designsEvent(view.designs, design.id));
      await quoteAndPublish(ctx, design, true);
    }
  }
  // With a room photo, the room approval shows the first realistic picture by itself, once (map v1.1 stage 6).
  const room = roomToolContext(ctx);
  if (view.stage === "room_approval" && room && session.roomId && session.journey.autoRenderAt === null) {
    const render = await runRoomTool(room, "render_room", { designId: session.activeDesignId ?? view.designs[0]?.id });
    if (render.ok === true) session.journey.autoRenderAt = Date.now();
  }
  const cards = await stageCards(deps, session, view, deps.data, {
    photo: Boolean(deps.room),
    handles: (deps.handles ?? NO_HANDLES).handles,
  });
  for (const card of cards) {
    const key = JSON.stringify(card);
    if (ctx.cardsShown.has(key)) continue;
    ctx.cardsShown.add(key);
    ctx.publish(card);
  }
  ctx.stageAtStart = view.stage;
  session.journey.shownStage = view.stage;
  ctx.journeyChanged = false;
}

/** Every design's scene and price (a room-wide style change), the active one last so it stays on screen. */
async function publishDesigns(ctx: TurnContext, designs: readonly KoshoyDesign[]) {
  const active = ctx.session.activeDesignId;
  const ordered = [...designs.filter((design) => design.id !== active), ...designs.filter((design) => design.id === active)];
  for (const design of ordered) await quoteAndPublish(ctx, design, true);
  ctx.publish(designsEvent(await ctx.deps.store.listDesigns(ctx.session.id), active));
}

/** With a single budget level in the data there is nothing to ask: it applies by itself. */
async function applyOnlyLevel(ctx: TurnContext) {
  const { session, deps } = ctx;
  const [only, ...rest] = deps.data.levels;
  if (!only || rest.length || session.journey.style.level) return;
  const applied = await applyStyleDecision(deps, session, deps.data, "level", only.id, deps.handles);
  if (!applied.designs.length) {
    session.journey.style.level = "";
    return;
  }
  await publishDesigns(ctx, applied.designs);
  ctx.journeyChanged = true;
}

/**
 * Before the model runs: a card's intent, a journey button, or a style
 * choice is applied by the server itself. Returns the input the model gets
 * (null: no model this turn).
 */
async function applyClientToJourney(ctx: TurnContext, client: ClientInput): Promise<ClientInput | null> {
  const { session, deps } = ctx;
  if (client.type === "message") {
    if (client.card) deps.track?.("card_clicked", { card: client.card });
    if (!session.events.length) deps.track?.("first_message");
    if (client.intent && !(await deps.store.listDesigns(session.id)).length) session.journey.kind = client.intent;
    return client;
  }
  if (client.type === "choice") {
    const style = parseStyleValue(client.selected);
    if (style) {
      const applied = await applyStyleDecision(deps, session, deps.data, style.decision, style.value, deps.handles);
      if (applied.ok) {
        ctx.journeyChanged = true;
        await publishDesigns(ctx, applied.designs);
        // Server text (catalog names with sizes like "16 mm"): not model text, so no number guard.
        ctx.publish({ type: "text", text: (ctx.textSent ? "\n\n" : "") + applied.summary });
        ctx.textSent = true;
      }
    }
    return client;
  }
  if (client.type === "add_cart_result") {
    if (client.ok) deps.track?.("cart_sent", { count: client.designIds?.length ?? 0 });
    for (const design of await deps.store.listDesigns(session.id)) {
      const approval = session.journey.approvals[design.id];
      if (client.designIds?.includes(design.id) && approval?.status === "approved" && approval.version === design.version) {
        approval.sentVersion = design.version;
        ctx.journeyChanged = true;
      }
    }
    return client;
  }
  const note = await runJourneyAction(ctx, client);
  await publishStageCards(ctx);
  return note === null ? null : { type: "message", text: note };
}

/* ---------------- entry ---------------- */

/**
 * Runs one turn; never throws. Always ends with exactly one "done" event.
 */
export async function runKoshoyTurn(input: {
  client: ClientInput;
  session: KoshoySessionState;
  deps: KoshoyTurnDeps;
  emit: (event: PublicEvent) => void;
}): Promise<void> {
  const { session } = input;
  let doneSent = false;
  const stop = createTurnStop(input.deps.signal, input.deps.timeoutMs ?? KOSHOY_TURN_TIMEOUT_MS);
  const ctx: TurnContext = {
    session,
    deps: input.deps,
    allowed: new Set<string>(),
    prices: new Set<string>(),
    designIds: new Set<string>(),
    openDesignId: session.activeDesignId,
    customerText: "",
    createdIds: new Set<string>(),
    stop,
    textSent: false,
    shown: new Set<string>(),
    askMissed: false,
    summary: "",
    journeyChanged: false,
    stageAtStart: null,
    cardsShown: new Set<string>(),
    publish(raw) {
      const event = toPublicEvent(raw);
      if (!event || doneSent) return;
      if (event.type === "done") doneSent = true;
      ctx.shown.add(event.type);
      appendTranscriptEvent(session, event);
      input.emit(event);
    },
  };

  try {
    ctx.stageAtStart = (await journeyView(input.deps, session, input.deps.data, input.deps.handles)).stage;
    const resolved = resolveKoshoyChoice(session, input.client);
    ctx.customerText = clientText(resolved);
    const client = await applyClientToJourney(ctx, resolved);
    if (!client) {
      // Nothing for the model: the screen already shows the answer.
    } else if (client.type === "message" && classifyScope(client.text) === "out") {
      ctx.publish(errorEvent("out_of_scope"));
    } else if (input.deps.mock && resolved.type === "journey") {
      publishText(ctx, "Tamam.");
    } else if (input.deps.mock) {
      await runMockTurn(ctx, client);
    } else {
      await runModelTurn(ctx, client);
    }
    await publishStageCards(ctx);
  } catch (error) {
    if (error instanceof KoshoyTurnStopped) {
      // Timed out: tell the customer. Client gone: nobody is listening.
      if (error.timedOut) {
        console.error("[koshoy] turn timed out");
        ctx.publish(errorEvent("unavailable"));
      }
    } else {
      console.error("[koshoy] turn failed", error);
      ctx.publish(errorEvent("unavailable"));
    }
  } finally {
    stop.dispose();
  }

  try {
    await input.deps.store.saveSession(session);
  } catch (error) {
    console.error("[koshoy] session save failed", error);
  }
  // The set's total under the price (2+ designs); a pricing failure only skips it.
  try {
    const total = await setTotalEvent(input.deps, session.id);
    if (total) ctx.publish(total);
  } catch (error) {
    console.error("[koshoy] set total failed", error);
  }
  ctx.publish({ type: "done" });
}
