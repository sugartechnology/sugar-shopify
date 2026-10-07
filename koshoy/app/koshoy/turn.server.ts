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
  CABIN_COLOR_IDS,
  CABIN_COLOR_LABELS,
  DESIGN_KIND_LABELS,
  DESIGN_KINDS,
  PLAN_LEVELS,
  type CabinColorId,
} from "./engine";
import {
  errorEvent,
  PRICE_PLACEHOLDER,
  toPublicEvent,
  type ChoiceOption,
  type PublicEvent,
} from "./events";
import { parseEditOp, type ClientInput } from "./input";
import { koshoyInstructions, koshoyModelContext } from "./instructions";
import {
  checkReply,
  classifyScope,
  kindFromText,
  KOSHOY_SAFE_STOPPED_REPLY,
  numbersIn,
  pricesIn,
} from "./rules";
import { isKoshoyToolName, KOSHOY_TOOL_NAMES, KOSHOY_TOOLS } from "./tools";
import {
  applyDesignEdit,
  createPlannedDesign,
  designForModel,
  designsEvent,
  DESIGN_LIMIT_HINT,
  editRejectHint,
  editWarningNotes,
  priceEvent,
  quoteParts,
  resolveDesign,
  sceneEvent,
  type KoshoyDesignDeps,
} from "./design-ops.server";
import {
  appendTranscriptEvent,
  type KoshoyDesign,
  type KoshoyPendingOption,
  type KoshoyPendingTool,
  type KoshoySessionState,
} from "./store.server";

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
  stop: TurnStop;
  textSent: boolean;
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

function clientText(input: ClientInput): string {
  if (input.type === "message") return input.text;
  if (input.type === "choice") return input.label || input.selected;
  return input.ok
    ? "Müşteri tasarımı sepete ekledi."
    : "Müşteri tasarımı sepete ekleyemedi.";
}

export function completePendingTools(
  pendingTools: KoshoyPendingTool[],
  client: ClientInput,
): KoshoyPendingTool[] {
  return pendingTools.map((tool) => {
    if (tool.name !== "ask_user") {
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
    if (client.type === "message") {
      return {
        id: tool.id,
        name: tool.name,
        payload: { question, selected: "free_text", label: client.text },
      };
    }
    return {
      id: tool.id,
      name: tool.name,
      payload: { question, selected: client.ok ? "cart_ok" : "cart_error", label: clientText(client) },
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
    const asked = session.pendingTools.some((tool) => tool.name === "ask_user");
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
          name: "ask_user",
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
}

/* ---------------- tools ---------------- */

async function quoteAndPublish(ctx: TurnContext, design: KoshoyDesign, withScene: boolean) {
  const quote = await ctx.deps.pricer.quote(design.composition);
  if (withScene) ctx.publish(sceneEvent(design));
  ctx.publish(priceEvent(design, quote));
  return quote;
}

export async function executeKoshoyTool(
  call: KoshoyToolCall,
  ctx: TurnContext,
): Promise<{ payload: Record<string, unknown>; askedUser?: boolean }> {
  const { session, deps } = ctx;
  const args = call.arguments;

  if (call.name === "set_brief") {
    const level = oneOf(args.level, PLAN_LEVELS);
    const color = oneOf(args.color, CABIN_COLOR_IDS);
    // The brief is replayed to the model on every hop: keep it short and flat.
    session.brief = {
      room: briefText(args.room, BRIEF_FIELD_MAX.room) || session.brief.room,
      style: briefText(args.style, BRIEF_FIELD_MAX.style) || session.brief.style,
      level: level ?? session.brief.level,
      color: color ?? session.brief.color,
      notes: briefText(args.notes, BRIEF_FIELD_MAX.notes) || session.brief.notes,
    };
    return { payload: { ok: true } };
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
    const widthCm = Number(args.targetWidthCm);
    ctx.publish({ type: "status", key: "placing" });
    const created = await createPlannedDesign(deps, session, {
      kind,
      targetWidthMm: Number.isFinite(widthCm) && widthCm > 0 ? Math.round(widthCm * 10) : undefined,
      level: oneOf(args.level, PLAN_LEVELS) ?? (session.brief.level || undefined),
      color: oneOf(args.color, CABIN_COLOR_IDS) ?? (session.brief.color || undefined),
    });
    if (!created) return { payload: { ok: false, error: "design_limit", hint: DESIGN_LIMIT_HINT } };
    const { design, plan } = created;
    ctx.designIds.add(design.id);
    const quote = await quoteAndPublish(ctx, design, true);
    ctx.publish(designsEvent(await deps.store.listDesigns(session.id), session.activeDesignId));
    return {
      payload: { ok: true, notes: plan.notes, price: quote.display, design: designForModel(design, true) },
    };
  }

  if (call.name === "edit_design") {
    const design = await resolveDesign(deps, session, str(args.designId));
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
    session.activeDesignId = result.design.id;
    const quote = await quoteAndPublish(ctx, result.design, result.changed || switched);
    if (result.design.label !== design.label || switched) {
      ctx.publish(designsEvent(await deps.store.listDesigns(session.id), session.activeDesignId));
    }
    const notes = result.changed
      ? editWarningNotes(result.warnings)
      : [editRejectHint("no_change")];
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

  return { payload: { ok: false, error: "unsupported_tool" } };
}

/** Tools whose payloads are server facts; their numbers may appear in replies. */
const FACT_TOOLS = new Set(["plan_cabinet", "edit_design", "quote", "switch_design"]);

async function runTool(call: KoshoyToolCall, ctx: TurnContext) {
  const result = isKoshoyToolName(call.name)
    ? await executeKoshoyTool(call, ctx)
    : { payload: { ok: false, error: "unsupported_tool" } as Record<string, unknown> };
  if (FACT_TOOLS.has(call.name)) {
    numbersIn(result.payload, ctx.allowed);
    pricesIn(result.payload, ctx.prices);
  }
  return result;
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

async function runModelTurn(ctx: TurnContext, client: ClientInput) {
  const { session, deps } = ctx;
  const stream = deps.stream ?? streamLlmGatewayResponses;
  const lastUserText = clientText(client);
  const first = startKoshoyHop(session, client);
  let message = first.message;
  let toolResults = first.toolResults;
  let followUp = first.followUp;
  let recovered = false;

  for (let hop = 0; hop < KOSHOY_MAX_HOPS; hop += 1) {
    if (!message && !toolResults) break;
    throwIfStopped(ctx.stop);
    ctx.publish({ type: "status", key: "thinking" });

    const designs = await deps.store.listDesigns(session.id);
    for (const design of designs) ctx.designIds.add(design.id);
    const instructionInput = {
      brief: session.brief,
      designs,
      activeDesignId: session.activeDesignId,
    };
    // Design facts only; the brief holds customer words, not system numbers.
    numbersIn(koshoyModelContext(instructionInput).designs, ctx.allowed);

    const body: Record<string, unknown> = {
      sessionId: session.modelSessionId,
      userId: session.shop,
      tag: KOSHOY_CHAT_TAG,
      jobId: session.id,
      instructions: koshoyInstructions(instructionInput),
      tools: KOSHOY_TOOLS,
      thinkingLevel: "low",
    };
    const platform = process.env.KOSHOY_CHAT_PLATFORM?.trim();
    const model = process.env.KOSHOY_CHAT_MODEL?.trim();
    if (platform) body.platform = platform;
    if (model) body.model = model;
    if (message) body.message = message;
    else body.toolResults = toolResults;

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

    publishText(ctx, buffer);

    const unique = dedupeToolCalls(calls);
    if (!unique.length) {
      if (!followUp) return;
      message = followUp;
      toolResults = undefined;
      followUp = undefined;
      continue;
    }

    const results: KoshoyPendingTool[] = [];
    let askedUser = false;
    for (const call of unique) {
      const result = await runTool(call, ctx);
      if (result.askedUser) askedUser = true;
      results.push({ id: call.id, name: call.name, payload: result.payload });
    }
    message = undefined;
    toolResults = results;
    if (askedUser) {
      session.pendingTools = results;
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
  const value = text.toLocaleLowerCase("tr-TR");
  if (/beyaz|krem|açık renk/u.test(value)) return "ivory";
  if (/mavi|lacivert/u.test(value)) return "blue";
  if (/ahşap|meşe|ceviz|doğal/u.test(value)) return "wood";
  return undefined;
}

function mockPriceText(price: unknown, lead: string): string {
  const display = String(price ?? "");
  return !display || display === PRICE_PLACEHOLDER
    ? "Fiyatı henüz hazır değil."
    : `${lead} ${display}.`;
}

const MOCK_COLOR_OPTIONS: ChoiceOption[] = CABIN_COLOR_IDS.map((id) => ({
  id: `color_${id}`,
  label: CABIN_COLOR_LABELS[id],
}));

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
      arguments: { question: "Hangi renkte olsun?", options: MOCK_COLOR_OPTIONS },
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

  let text = client.type === "message" ? client.text : client.label || client.selected;
  if (client.type === "choice") {
    session.pendingAskUser = null;
    session.pendingTools = [];
    const color = oneOf(/^color_(\w+)$/.exec(client.selected)?.[1], CABIN_COLOR_IDS);
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
          ? `Rengi ${CABIN_COLOR_LABELS[color].toLocaleLowerCase("tr-TR")} yaptım. ${mockPriceText(edit.payload.price, "Yeni fiyat")}`
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
    stop,
    textSent: false,
    publish(raw) {
      const event = toPublicEvent(raw);
      if (!event || doneSent) return;
      if (event.type === "done") doneSent = true;
      appendTranscriptEvent(session, event);
      input.emit(event);
    },
  };

  try {
    const client = resolveKoshoyChoice(session, input.client);
    if (client.type === "message" && classifyScope(client.text) === "out") {
      ctx.publish(errorEvent("out_of_scope"));
    } else if (input.deps.mock) {
      await runMockTurn(ctx, client);
    } else {
      await runModelTurn(ctx, client);
    }
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
  ctx.publish({ type: "done" });
}
