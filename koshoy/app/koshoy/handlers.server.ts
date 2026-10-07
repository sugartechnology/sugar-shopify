/**
 * Koshoy studio endpoints (CONTRACT §1). Routes authenticate the App Proxy
 * request, build a KoshoyRequestContext and delegate here, so this file has
 * no Shopify/Prisma imports and is testable with fakes.
 *
 * Responses carry error codes only; upstream messages stay in server logs.
 */
import {
  errorEvent,
  publicEvents,
  sseFrame,
  toDesignSummary,
  toSceneView,
  type DesignSummary,
  type KoshoyErrorCode,
  type PublicEvent,
} from "./events";
import { parseClientInput, parseDesignRef, parseEditOp } from "./input";
import {
  hitAll,
  koshoyClientKey,
  type KoshoyBusyLock,
  type KoshoyRateLimiter,
} from "./rate-limit.server";
import { buildKoshoyCartLines } from "./pricing.server";
import { appendTranscriptEvent, type KoshoyDesign, type KoshoySessionState } from "./store.server";
import {
  isWellFormedKoshoyToken,
  koshoySessionCookie,
  readKoshoyToken,
} from "./token.server";
import { runKoshoyTurn, type KoshoyStreamFn } from "./turn.server";
import {
  applyDesignEdit,
  designSummaries,
  editSummaryText,
  priceEvent,
  sceneEvent,
  type KoshoyDesignDeps,
} from "./design-ops.server";

export interface KoshoyRequestContext extends KoshoyDesignDeps {
  shop: string;
  enabled: boolean;
  limits: {
    /** keyed by session id */
    turn: KoshoyRateLimiter;
    edit: KoshoyRateLimiter;
    cart: KoshoyRateLimiter;
    /** new sessions, keyed by koshoyClientKey */
    session: KoshoyRateLimiter;
    /** turns, keyed by koshoyClientKey */
    client: KoshoyRateLimiter;
    /** turns, keyed by shop */
    shop: KoshoyRateLimiter;
    /** new sessions, keyed by shop */
    shopSession: KoshoyRateLimiter;
  };
  busy: KoshoyBusyLock;
  /** Loaded lazily (shop metafields) only when a turn actually runs. */
  chatConfig(): Promise<{ apiKey: string; mock: boolean }>;
  stream?: KoshoyStreamFn;
}

export const KOSHOY_WELCOME_CARDS = [
  {
    id: "gardirop",
    label: "Yatak odası için gardırop",
    prompt: "Yatak odam için sade bir gardırop istiyorum.",
  },
  {
    id: "tv_unitesi",
    label: "Salon için TV ünitesi",
    prompt: "Salonum için kapaklı bir TV ünitesi istiyorum.",
  },
  {
    id: "kitaplik",
    label: "Kitaplık",
    prompt: "Çalışma odam için bir kitaplık istiyorum.",
  },
  {
    id: "vestiyer",
    label: "Antre için vestiyer",
    prompt: "Antre için kapaklı bir vestiyer istiyorum.",
  },
] as const;

const STATUS_BY_CODE: Record<KoshoyErrorCode, number> = {
  unavailable: 503,
  rate_limited: 429,
  session_expired: 401,
  invalid_input: 400,
  // Body-level outcomes: the storefront reads ok:false + latest state.
  edit_rejected: 200,
  out_of_scope: 200,
  cart_failed: 200,
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function koshoyJson(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/** JSON error body shared by session/edit/cart (and turn in JSON mode). */
export function koshoyErrorResponse(code: KoshoyErrorCode, status = STATUS_BY_CODE[code]): Response {
  return koshoyJson({ ok: false, error: code, events: [errorEvent(code)] }, status);
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("application/json");
}

function turnErrorResponse(
  code: KoshoyErrorCode,
  json: boolean,
  status = STATUS_BY_CODE[code],
): Response {
  const events: PublicEvent[] = [errorEvent(code), { type: "done" }];
  if (json) return koshoyJson({ events }, status);
  return new Response(events.map(sseFrame).join(""), { status, headers: SSE_HEADERS });
}

/** /turn errors raised before the handler runs (auth, method): still end with done. */
export function koshoyTurnError(
  request: Request,
  code: KoshoyErrorCode,
  status = STATUS_BY_CODE[code],
): Response {
  return turnErrorResponse(code, wantsJson(request), status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "HEAD") return {};
  return asRecord(await request.json().catch(() => null));
}

/** Authorization header, then cookie, then {session} in the JSON body (proxy-safe fallback). */
function presentedToken(request: Request, body: Record<string, unknown>): string {
  const fromBody =
    typeof body.session === "string" && isWellFormedKoshoyToken(body.session) ? body.session : "";
  return readKoshoyToken(request) || fromBody;
}

async function loadSession(
  request: Request,
  ctx: KoshoyRequestContext,
  body: Record<string, unknown>,
): Promise<KoshoySessionState | null> {
  const token = presentedToken(request, body);
  return token ? ctx.store.findSession(token, ctx.shop) : null;
}

/**
 * The session as saved by whoever held its lock before us. The copy read
 * before acquiring may predate that holder's save (a turn's transcript,
 * active design, pending choice), and saving it would undo that work.
 */
async function lockedSession(
  request: Request,
  ctx: KoshoyRequestContext,
  body: Record<string, unknown>,
  id: string,
): Promise<KoshoySessionState | null> {
  const session = await loadSession(request, ctx, body);
  return session && session.id === id ? session : null;
}

function summaries(designs: readonly KoshoyDesign[], activeId: string | null): DesignSummary[] {
  return designSummaries(designs, activeId)
    .map(toDesignSummary)
    .filter((item): item is DesignSummary => item !== null);
}

/* ---------------- POST /session ---------------- */

export async function handleKoshoySession(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled) {
      return koshoyJson({
        enabled: false,
        session: "",
        activeDesignId: null,
        designs: [],
        events: [],
        welcome: { cards: [] },
      });
    }
    const body = await readJson(request);
    const presented = presentedToken(request, body);
    let token = presented;
    let session =
      body.reset !== true && presented ? await ctx.store.findSession(presented, ctx.shop) : null;
    if (!session) {
      // Every new session is a DB row and a fresh per-session turn budget.
      if (
        !hitAll([
          [ctx.limits.shopSession, ctx.shop],
          [ctx.limits.session, koshoyClientKey(ctx.shop, request)],
        ])
      ) {
        return koshoyErrorResponse("rate_limited");
      }
      const created = await ctx.store.createSession(ctx.shop);
      session = created.session;
      token = created.token;
    }

    const designs = await ctx.store.listDesigns(session.id);
    const active = designs.find((design) => design.id === session.activeDesignId) ?? null;
    const events: unknown[] = [...session.events];
    if (active) {
      const quote = await ctx.pricer.quote(active.composition);
      events.push(sceneEvent(active), priceEvent(active, quote));
    }

    return koshoyJson(
      {
        enabled: true,
        session: token,
        activeDesignId: active?.id ?? null,
        designs: summaries(designs, active?.id ?? null),
        events: publicEvents(events),
        welcome: { cards: KOSHOY_WELCOME_CARDS },
      },
      200,
      { "Set-Cookie": koshoySessionCookie(token) },
    );
  } catch (error) {
    console.error("[koshoy] session failed", error);
    return koshoyErrorResponse("unavailable");
  }
}

/* ---------------- POST /turn ---------------- */

export async function handleKoshoyTurn(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  const json = wantsJson(request);
  let lockedId = "";
  // Stops the model loop when the storefront goes away.
  const gone = new AbortController();
  const onGone = () => gone.abort();
  if (request.signal?.aborted) gone.abort();
  else request.signal?.addEventListener("abort", onGone, { once: true });
  try {
    if (!ctx.enabled) return turnErrorResponse("unavailable", json);
    const body = await readJson(request);
    const found = await loadSession(request, ctx, body);
    if (!found) return turnErrorResponse("session_expired", json);
    const client = parseClientInput(body.input);
    if (!client) return turnErrorResponse("invalid_input", json);
    if (
      !hitAll([
        [ctx.limits.shop, ctx.shop],
        [ctx.limits.client, koshoyClientKey(ctx.shop, request)],
        [ctx.limits.turn, found.id],
      ])
    ) {
      return turnErrorResponse("rate_limited", json);
    }
    if (!ctx.busy.acquire(found.id)) return turnErrorResponse("rate_limited", json);
    lockedId = found.id;
    const session = await lockedSession(request, ctx, body, found.id);
    if (!session) {
      ctx.busy.release(lockedId);
      lockedId = "";
      return turnErrorResponse("session_expired", json);
    }

    const chat = await ctx.chatConfig();
    const run = (emit: (event: PublicEvent) => void) =>
      runKoshoyTurn({
        client,
        session,
        deps: {
          store: ctx.store,
          engine: ctx.engine,
          pricer: ctx.pricer,
          apiKey: chat.apiKey,
          mock: chat.mock,
          stream: ctx.stream,
          signal: gone.signal,
        },
        emit,
      })
        .catch((error) => console.error("[koshoy] turn crashed", error))
        .finally(() => {
          ctx.busy.release(session.id);
          request.signal?.removeEventListener("abort", onGone);
        });

    if (json) {
      const events: PublicEvent[] = [];
      lockedId = "";
      await run((event) => events.push(event));
      return koshoyJson({ events });
    }

    const encoder = new TextEncoder();
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const emit = (event: PublicEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(sseFrame(event)));
          } catch {
            open = false;
            gone.abort();
          }
        };
        void run(emit).finally(() => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // client already gone
          }
        });
      },
      cancel() {
        gone.abort();
      },
    });
    lockedId = "";
    return new Response(sse, { headers: SSE_HEADERS });
  } catch (error) {
    console.error("[koshoy] turn failed", error);
    if (lockedId) ctx.busy.release(lockedId);
    return turnErrorResponse("unavailable", json);
  }
}

/* ---------------- POST /edit ---------------- */

async function rejectedEdit(ctx: KoshoyRequestContext, design: KoshoyDesign): Promise<Response> {
  const quote = await ctx.pricer.quote(design.composition);
  return koshoyJson({
    ok: false,
    events: publicEvents([errorEvent("edit_rejected"), sceneEvent(design), priceEvent(design, quote)]),
  });
}

export async function handleKoshoyEdit(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  let locked = "";
  try {
    if (!ctx.enabled) return koshoyErrorResponse("unavailable");
    const body = await readJson(request);
    const found = await loadSession(request, ctx, body);
    if (!found) return koshoyErrorResponse("session_expired");
    const ref = parseDesignRef(body);
    const op = parseEditOp(body.op);
    if (!ref || !op) return koshoyErrorResponse("invalid_input");
    if (!ctx.limits.edit.hit(found.id)) return koshoyErrorResponse("rate_limited");

    // A running turn saves the whole session when it ends and would drop
    // this edit's transcript line / active design: refuse with the latest state.
    if (!ctx.busy.acquire(found.id)) {
      const current = await ctx.store.getDesign(found.id, ref.designId);
      return current ? rejectedEdit(ctx, current) : koshoyErrorResponse("invalid_input");
    }
    locked = found.id;
    const session = await lockedSession(request, ctx, body, found.id);
    if (!session) return koshoyErrorResponse("session_expired");

    const design = await ctx.store.getDesign(session.id, ref.designId);
    if (!design) return koshoyErrorResponse("invalid_input");
    if (design.version !== ref.version) return rejectedEdit(ctx, design);

    const result = await applyDesignEdit(ctx, session.id, design, op);
    if (!result.ok) {
      const latest =
        result.reason === "stale" ? await ctx.store.getDesign(session.id, design.id) : design;
      return rejectedEdit(ctx, latest ?? design);
    }

    const quote = await ctx.pricer.quote(result.design.composition);
    const events: unknown[] = [sceneEvent(result.design), priceEvent(result.design, quote)];
    if (result.changed) {
      const text: PublicEvent = {
        type: "text",
        text: editSummaryText(op, result.design, result.warnings),
      };
      appendTranscriptEvent(session, text);
      events.push(text);
    }
    session.activeDesignId = result.design.id;
    await ctx.store.saveSession(session);
    return koshoyJson({ ok: true, events: publicEvents(events) });
  } catch (error) {
    console.error("[koshoy] edit failed", error);
    return koshoyErrorResponse("unavailable");
  } finally {
    if (locked) ctx.busy.release(locked);
  }
}

/* ---------------- POST /cart ---------------- */

export async function handleKoshoyCart(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled) return koshoyErrorResponse("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyErrorResponse("session_expired");
    const ref = parseDesignRef(body);
    if (!ref) return koshoyErrorResponse("invalid_input");
    if (!ctx.limits.cart.hit(session.id)) return koshoyErrorResponse("rate_limited");

    const design = await ctx.store.getDesign(session.id, ref.designId);
    if (!design) return koshoyErrorResponse("invalid_input");

    // BOM, SKUs and prices are recomputed from the stored design; only the
    // design id and version come from the browser. A design the storefront
    // cannot draw in full is never billed.
    const quote = await ctx.pricer.quote(design.composition);
    const drawable = toSceneView(design.composition) !== null;
    const lines =
      drawable && design.version === ref.version ? buildKoshoyCartLines(quote, design.id) : null;
    if (!lines) {
      return koshoyJson({ ok: false, error: "cart_failed", lines: [], display: quote.display });
    }
    return koshoyJson({ ok: true, lines, display: quote.display });
  } catch (error) {
    console.error("[koshoy] cart failed", error);
    return koshoyErrorResponse("unavailable");
  }
}

export function koshoyMethodNotAllowed(): Response {
  return koshoyErrorResponse("invalid_input", 405);
}
