import { randomUUID } from "node:crypto";
import {
  EMPTY_SHOPPING_BRIEF,
  type ShoppingBrief,
  type ShoppingDisplayEvent,
  type ShoppingProductCard,
  type ShoppingPendingTool,
  type ShoppingProposedCart,
  type ShoppingChoiceOption,
} from "../types/shopping-chat";

const TTL_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = "sugar_sa_sid";

export interface ShoppingChatSessionState {
  id: string;
  shop: string;
  brief: ShoppingBrief;
  events: ShoppingDisplayEvent[];
  proposedCart: ShoppingProposedCart | null;
  /** decor-ai / OpenAI conversation id; rotated if a hop left unmatched tool calls. */
  modelSessionId: string;
  pendingAskUser: {
    id: string;
    question: string;
    options: ShoppingChoiceOption[];
  } | null;
  /** Executed tool payloads waiting to be posted as toolResults (every call id). */
  pendingTools: ShoppingPendingTool[];
  allowedVariantIds: string[];
  catalog: ShoppingProductCard[];
  createdAt: number;
}

const sessions = new Map<string, ShoppingChatSessionState>();

function prune(now = Date.now()) {
  const cutoff = now - TTL_MS;
  for (const [id, value] of sessions) {
    if (value.createdAt < cutoff) sessions.delete(id);
  }
}

export function createShoppingChatSession(
  shop: string,
  currency = "",
): ShoppingChatSessionState {
  prune();
  const session: ShoppingChatSessionState = {
    id: randomUUID(),
    shop,
    brief: { ...EMPTY_SHOPPING_BRIEF, currency },
    events: [],
    proposedCart: null,
    modelSessionId: randomUUID(),
    pendingAskUser: null,
    pendingTools: [],
    allowedVariantIds: [],
    catalog: [],
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getShoppingChatSession(
  sessionId: string,
  shop: string,
): ShoppingChatSessionState | null {
  prune();
  const session = sessions.get(sessionId);
  if (!session || session.shop !== shop) return null;
  if (!session.modelSessionId) session.modelSessionId = session.id;
  if (!session.pendingTools) session.pendingTools = [];
  return session;
}

export function saveShoppingChatSession(session: ShoppingChatSessionState) {
  sessions.set(session.id, session);
}

function mergeProductCards(
  current: ShoppingProductCard[],
  incoming: ShoppingProductCard[],
): ShoppingProductCard[] {
  const seen = new Set<string>();
  const out: ShoppingProductCard[] = [];
  for (const item of [...current, ...incoming]) {
    const id = String(item?.variantId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

export function appendDisplayEvent(
  session: ShoppingChatSessionState,
  event: ShoppingDisplayEvent,
) {
  if (event.type === "thinking") return;
  if (event.type === "done") return;
  const last = session.events[session.events.length - 1];
  if (event.type === "text" && last?.type === "text") {
    last.text += event.text;
    return;
  }
  if (event.type === "products" && last?.type === "products") {
    last.items = mergeProductCards(last.items, event.items);
    return;
  }
  session.events.push(event);
  if (event.type === "cart") {
    session.proposedCart = {
      items: event.items,
      totalCents: event.total,
      remainingCents: event.remaining,
      budgetCents: event.budget,
      currency: event.currency,
      dropped: event.dropped,
    };
  }
}

export function rememberAllowedVariants(
  session: ShoppingChatSessionState,
  variantIds: string[],
) {
  const seen = new Set(session.allowedVariantIds);
  for (const id of variantIds) {
    const trimmed = String(id ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    session.allowedVariantIds.push(trimmed);
  }
}

export function clearPendingAskUser(session: ShoppingChatSessionState) {
  session.pendingAskUser = null;
}

export function clearPendingToolHop(session: ShoppingChatSessionState) {
  session.pendingAskUser = null;
  session.pendingTools = [];
}

export function rotateModelSession(session: ShoppingChatSessionState) {
  session.modelSessionId = randomUUID();
  clearPendingToolHop(session);
}

export function readSessionCookie(request: Request): string {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey?.trim() === COOKIE_NAME) {
      return decodeURIComponent(rest.join("=").trim());
    }
  }
  return "";
}

export function sessionCookieHeader(sessionId: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${Math.floor(
    TTL_MS / 1000,
  )}; HttpOnly; Secure; SameSite=Lax`;
}

export function publicDisplayEvents(
  events: ShoppingDisplayEvent[],
): ShoppingDisplayEvent[] {
  return events.filter(
    (event) =>
      event.type === "text" ||
      event.type === "products" ||
      event.type === "cart" ||
      event.type === "choice" ||
      event.type === "error",
  );
}
