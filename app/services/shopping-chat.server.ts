import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ShopConfig } from "../types/sugar";
import type {
  ShoppingBrief,
  ShoppingClientInput,
  ShoppingDisplayEvent,
  ShoppingPendingTool,
  ShoppingProductCard,
  ShoppingToolCall,
} from "../types/shopping-chat";
import { cartToDisplay, proposeBudgetCart } from "./propose-budget-cart.server";
import {
  filtersFromShopConfig,
  priceToCents,
  searchShopifyProducts,
} from "./search-shopify-products.server";
import {
  gidToNumericId,
  resolveDesignProductsFromShopify,
} from "./resolve-shopify-products.server";
import {
  appendDisplayEvent,
  clearPendingAskUser,
  clearPendingToolHop,
  rememberAllowedVariants,
  rotateModelSession,
  saveShoppingChatSession,
  type ShoppingChatSessionState,
} from "./shopping-chat-session.server";
import { getShopApiKey, isSugarApiMockMode } from "./sugar-api.server";
import { streamTagserviceShoppingResponses } from "./tagservice-shopping.server";

function catalogMap(session: ShoppingChatSessionState) {
  return new Map(session.catalog.map((item) => [item.variantId, item]));
}

function persistCatalog(
  session: ShoppingChatSessionState,
  catalog: Map<string, ShoppingProductCard>,
) {
  session.catalog = [...catalog.values()];
}

const MAX_HOPS = 16;
const SERVER_TOOLS = new Set([
  "search_products",
  "get_product",
  "propose_cart",
  "set_brief",
  "ask_user",
]);

export const SHOPPING_CHAT_TOOLS = [
  {
    name: "search_products",
    description:
      "Search the Shopify catalog. Pass each need as its own queries item (e.g. [\"sofa\", \"rug\"]). Use only returned variantIds later. Merchant collection/stock/price filters are applied server-side.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Search terms in the shopper language",
        },
        q: { type: "string", description: "Single term if queries is empty" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_product",
    description: "Load one product/variant that already appeared in search_products.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        variantId: { type: "string" },
      },
      required: ["variantId"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_cart",
    description:
      "Build a cart under the shopper budget. Server validates prices, availability, and filters. Do not invent variantIds.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        budget: { type: "number", description: "Budget in shop currency major units" },
        currency: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variantId: { type: "string" },
              quantity: { type: "integer" },
            },
            required: ["variantId"],
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "set_brief",
    description:
      "Store needs on the server: budget, room, style, must-haves, exclusions. Call when the shopper states constraints.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        budget: { type: "number" },
        currency: { type: "string" },
        room: { type: "string" },
        style: { type: "string" },
        mustHave: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description:
      "Show 2–4 clickable choices and wait. The storefront always numbers them and adds one Other free-text field. Do not add Other yourself. Use instead of yes/no prose (budget bands, room type).",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
            },
            required: ["id", "label"],
          },
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
  },
];

export function shoppingChatInstructions(
  brief: ShoppingBrief,
  currency: string,
): string {
  return [
    "You are Sugar Shop Assistant, a storefront shopping helper.",
    "Talk to the shopper, learn needs and budget, search real Shopify products, and propose a cart under budget.",
    "Never invent product or variant ids. Only use ids from search_products.",
    "Call set_brief when budget, room, style, or constraints are stated.",
    "Call ask_user for short choices (budget band, room) instead of open yes/no questions.",
    "After you have needs, search then propose_cart. The server enforces budget math.",
    "Do not call add_to_cart. The shopper confirms in the UI.",
    `Current brief: ${JSON.stringify(brief)}`,
    `Shop currency: ${currency || brief.currency || "unknown"}`,
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = String(value ?? "").trim();
    return single ? [single] : [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function collectToolCallsFromStreamEvent(
  event: string,
  data: unknown,
): ShoppingToolCall[] {
  if (event !== "tool_call" && event !== "message" && event !== "") return [];
  const rows = Array.isArray(data) ? data : [data];
  const out: ShoppingToolCall[] = [];
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
      SERVER_TOOLS.has(name);
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

function dedupeToolCalls(calls: ShoppingToolCall[]): ShoppingToolCall[] {
  const seen = new Set<string>();
  const out: ShoppingToolCall[] = [];
  for (const call of calls) {
    if (seen.has(call.id)) continue;
    seen.add(call.id);
    out.push(call);
  }
  return out;
}

function missingToolOutputMessage(data: unknown): boolean {
  const row = asRecord(data);
  return /No tool output found/i.test(String(row.message ?? row.text ?? ""));
}

function clientText(input: ShoppingClientInput): string {
  if (input.type === "message") return input.text;
  if (input.type === "choice") return input.label || input.selected;
  return input.ok
    ? "The shopper added the proposed cart to Shopify cart successfully."
    : `The shopper could not add the cart: ${input.error || "unknown error"}`;
}

export function completePendingToolResults(
  pendingTools: ShoppingPendingTool[],
  client: ShoppingClientInput,
): ShoppingPendingTool[] {
  return pendingTools.map((tool) => {
    if (tool.name !== "ask_user") {
      return { id: tool.id, name: tool.name, payload: tool.payload };
    }
    if (client.type === "choice") {
      return {
        id: tool.id,
        name: tool.name,
        payload: {
          question: tool.payload.question ?? "",
          selected: client.selected,
          label: client.label || client.selected,
        },
      };
    }
    if (client.type === "message") {
      return {
        id: tool.id,
        name: tool.name,
        payload: {
          question: tool.payload.question ?? "",
          selected: "free_text",
          label: client.text,
        },
      };
    }
    return {
      id: tool.id,
      name: tool.name,
      payload: {
        question: tool.payload.question ?? "",
        selected: client.ok ? "cart_ok" : "cart_error",
        label: client.ok
          ? "The shopper added items to the cart."
          : client.error || "Cart add failed",
      },
    };
  });
}

export function startHopFromClient(
  session: ShoppingChatSessionState,
  client: ShoppingClientInput,
): {
  message?: string;
  toolResults?: ShoppingPendingTool[];
} {
  if (session.pendingTools.length) {
    const toolResults = completePendingToolResults(session.pendingTools, client);
    clearPendingToolHop(session);
    return { toolResults };
  }
  if (client.type === "choice" && session.pendingAskUser) {
    const toolResults = completePendingToolResults(
      [
        {
          id: session.pendingAskUser.id,
          name: "ask_user",
          payload: { question: session.pendingAskUser.question },
        },
      ],
      client,
    );
    clearPendingAskUser(session);
    return { toolResults };
  }
  return { message: clientText(client) };
}

function textFromEvent(event: string, data: unknown): string {
  if (event !== "text") return "";
  if (typeof data === "string") return data;
  const row = asRecord(data);
  if (row.text == null) return "";
  return String(row.text);
}

export async function executeShoppingTool(
  call: ShoppingToolCall,
  input: {
    admin: AdminApiContext["admin"];
    config: ShopConfig;
    session: ShoppingChatSessionState;
    catalog: Map<string, ShoppingProductCard>;
  },
): Promise<{ payload: Record<string, unknown>; events: ShoppingDisplayEvent[] }> {
  const filters = filtersFromShopConfig(input.config);
  const args = call.arguments;

  if (call.name === "set_brief") {
    const budget = Number(args.budget);
    input.session.brief = {
      ...input.session.brief,
      budgetCents: Number.isFinite(budget) && budget > 0 ? priceToCents(budget) : input.session.brief.budgetCents,
      currency: String(args.currency ?? input.session.brief.currency ?? "").trim(),
      room: String(args.room ?? input.session.brief.room ?? "").trim(),
      style: String(args.style ?? input.session.brief.style ?? "").trim(),
      mustHave: args.mustHave ? asStringArray(args.mustHave) : input.session.brief.mustHave,
      exclude: args.exclude ? asStringArray(args.exclude) : input.session.brief.exclude,
      notes: String(args.notes ?? input.session.brief.notes ?? ""),
    };
    return { payload: { ok: true }, events: [] };
  }

  if (call.name === "ask_user") {
    const options = (Array.isArray(args.options) ? args.options : [])
      .map((option) => {
        const row = asRecord(option);
        return {
          id: String(row.id ?? "").trim(),
          label: String(row.label ?? "").trim(),
        };
      })
      .filter((option) => option.id && option.label)
      .slice(0, 4);
    if (options.length < 2) {
      return { payload: { ok: false, error: "need 2-4 options" }, events: [] };
    }
    const question = String(args.question ?? "").trim() || "Choose one";
    const event: ShoppingDisplayEvent = {
      type: "choice",
      question,
      options,
    };
    return { payload: { ok: true, question, options }, events: [event] };
  }

  if (call.name === "search_products") {
    const queries = asStringArray(args.queries);
    if (!queries.length && args.q) queries.push(String(args.q));
    const result = await searchShopifyProducts(input.admin, queries, filters);
    if (result.currency) input.session.brief.currency = result.currency;
    for (const product of result.products) {
      input.catalog.set(product.variantId, product);
    }
    persistCatalog(input.session, input.catalog);
    rememberAllowedVariants(
      input.session,
      result.products.map((product) => product.variantId),
    );
    return {
      payload: {
        count: result.products.length,
        queries,
        products: result.products.map((product) => ({
          id: product.productId,
          variantId: product.variantId,
          title: product.title,
          handle: product.handle,
          imageUrl: product.imageUrl,
          price: product.price,
          currency: product.currency,
          available: product.available,
        })),
      },
      events: result.products.length
        ? [{ type: "products", items: result.products }]
        : [],
    };
  }

  if (call.name === "get_product") {
    const variantId = gidToNumericId(String(args.variantId ?? ""));
    if (!variantId) {
      return { payload: { error: "missing variantId" }, events: [] };
    }
    const resolved = await resolveDesignProductsFromShopify(input.admin, [
      { productId: "", variantId },
    ]);
    const product = resolved[0];
    if (!product) {
      return { payload: { error: "not_found" }, events: [] };
    }
    const card: ShoppingProductCard = {
      productId: gidToNumericId(product.productId) || product.productId,
      variantId: gidToNumericId(product.variantId) || product.variantId,
      title: product.title,
      handle: product.handle,
      imageUrl: product.imageUrl || product.images[0] || "",
      price: product.price,
      priceCents: priceToCents(product.price),
      currency: product.currency,
      available: true,
    };
    input.catalog.set(card.variantId, card);
    persistCatalog(input.session, input.catalog);
    rememberAllowedVariants(input.session, [card.variantId]);
    return {
      payload: {
        ...card,
        description: product.description ?? "",
        details: product.productDetails ?? [],
      },
      events: [{ type: "products", items: [card] }],
    };
  }

  if (call.name === "propose_cart") {
    const budgetMajor = Number(args.budget);
    const budgetCents =
      Number.isFinite(budgetMajor) && budgetMajor > 0
        ? priceToCents(budgetMajor)
        : input.session.brief.budgetCents ?? 0;
    const requested = Array.isArray(args.items)
      ? (args.items as Array<Record<string, unknown>>).map((item) => ({
          variantId: gidToNumericId(String(item.variantId ?? "")),
          quantity: Number(item.quantity),
        }))
      : [];
    const cart = proposeBudgetCart({
      budgetCents,
      currency:
        String(args.currency ?? "").trim() ||
        input.session.brief.currency ||
        "TRY",
      requested,
      catalog: [...input.catalog.values()],
      allowedVariantIds: input.session.allowedVariantIds,
    });
    input.session.brief.budgetCents = cart.budgetCents;
    return {
      payload: {
        items: cart.items,
        total: cart.totalCents,
        remaining: cart.remainingCents,
        dropped: cart.dropped,
        currency: cart.currency,
        budget: cart.budgetCents,
      },
      events: [cartToDisplay(cart)],
    };
  }

  return { payload: { error: "unknown_tool" }, events: [] };
}

export function parseClientInput(body: unknown): ShoppingClientInput | null {
  const row = asRecord(body);
  const type = String(row.type ?? "");
  if (type === "message") {
    const text = String(row.text ?? "").trim();
    if (!text) return null;
    return { type: "message", text };
  }
  if (type === "choice") {
    const selected = String(row.selected ?? "").trim();
    if (!selected) return null;
    return {
      type: "choice",
      selected,
      label: String(row.label ?? "").trim() || undefined,
    };
  }
  if (type === "add_cart_result") {
    return {
      type: "add_cart_result",
      ok: row.ok === true,
      error: String(row.error ?? "").trim() || undefined,
    };
  }
  return null;
}

function extractBudgetCents(text: string): number | null {
  const match = text.replace(/\./g, "").match(/(\d[\d\s]*)/);
  if (!match) return null;
  const value = Number(String(match[1]).replace(/\s/g, ""));
  if (!Number.isFinite(value) || value < 50) return null;
  return priceToCents(value);
}

export async function runMockShoppingTurn(
  input: ShoppingClientInput,
  context: {
    admin: AdminApiContext["admin"];
    config: ShopConfig;
    session: ShoppingChatSessionState;
    catalog: Map<string, ShoppingProductCard>;
  },
): Promise<ShoppingDisplayEvent[]> {
  const events: ShoppingDisplayEvent[] = [];
  if (input.type === "add_cart_result") {
    events.push({
      type: "text",
      text: input.ok
        ? "Ürünler sepete eklendi. Tema sepetinden ödemeye geçebilirsin."
        : input.error || "Sepete eklenemedi.",
    });
    events.push({ type: "done" });
    return events;
  }

  let message = "";
  if (input.type === "choice") {
    const option = context.session.pendingAskUser?.options.find(
      (item) => item.id === input.selected,
    );
    const label = input.label || option?.label || input.selected;
    const budget = extractBudgetCents(label);
    if (budget) context.session.brief.budgetCents = budget;
    if (/salon|yatak|mutfak|ofis|living|bedroom|kitchen/i.test(label)) {
      context.session.brief.room = label;
    }
    message = label;
    clearPendingAskUser(context.session);
  } else {
    message = input.text;
    const budget = extractBudgetCents(message);
    if (budget) context.session.brief.budgetCents = budget;
  }

  if (!context.session.brief.budgetCents) {
    events.push({
      type: "text",
      text: "Bütçeni ve ihtiyacını söyle, mağazadan uygun ürünleri getireyim.",
    });
    const options = [
      { id: "budget_10k", label: "10.000" },
      { id: "budget_25k", label: "25.000" },
      { id: "budget_50k", label: "50.000" },
      { id: "budget_100k", label: "100.000" },
    ];
    events.push({
      type: "choice",
      question: "Bütçe aralığın nedir?",
      options,
    });
    context.session.pendingAskUser = {
      id: "mock_ask",
      question: "Bütçe aralığın nedir?",
      options,
    };
    events.push({ type: "done" });
    return events;
  }

  const queries = message
    .split(/[,\n]| ve | and /i)
    .map((part) => part.replace(/\d+/g, "").trim())
    .filter((part) => part.length > 2)
    .slice(0, 6);
  const search = await executeShoppingTool(
    {
      id: "mock_search",
      name: "search_products",
      arguments: { queries: queries.length ? queries : [message] },
    },
    context,
  );
  events.push({
    type: "text",
    text: search.events.some((event) => event.type === "products")
      ? "İhtiyacına uygun ürünleri getirdim. Bütçene göre bir sepet öneriyorum."
      : "Bu aramada ürün bulunamadı. Başka bir ihtiyaç dene.",
  });
  events.push(...search.events);

  const catalog = [...context.catalog.values()];
  if (catalog.length && context.session.brief.budgetCents) {
    const proposed = await executeShoppingTool(
      {
        id: "mock_cart",
        name: "propose_cart",
        arguments: {
          budget: context.session.brief.budgetCents / 100,
          items: catalog.slice(0, 6).map((item) => ({
            variantId: item.variantId,
            quantity: 1,
          })),
        },
      },
      context,
    );
    events.push(...proposed.events);
  }
  events.push({ type: "done" });
  return events;
}

export async function runShoppingChatTurn(input: {
  client: ShoppingClientInput;
  admin: AdminApiContext["admin"];
  config: ShopConfig;
  session: ShoppingChatSessionState;
  emit: (event: ShoppingDisplayEvent) => void;
}): Promise<void> {
  const catalog = catalogMap(input.session);
  const publish = (event: ShoppingDisplayEvent) => {
    appendDisplayEvent(input.session, event);
    input.emit(event);
  };

  if (isSugarApiMockMode(input.config) || !getShopApiKey(input.config)) {
    const events = await runMockShoppingTurn(input.client, {
      admin: input.admin,
      config: input.config,
      session: input.session,
      catalog,
    });
    persistCatalog(input.session, catalog);
    for (const event of events) publish(event);
    saveShoppingChatSession(input.session);
    return;
  }

  const currency = input.session.brief.currency;
  const instructions = shoppingChatInstructions(input.session.brief, currency);
  const lastUserText = clientText(input.client);
  const first = startHopFromClient(input.session, input.client);
  let message = first.message;
  let toolResults = first.toolResults;
  let recoveredMissingTools = false;

  const apiKey = getShopApiKey(input.config);
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const pendingCalls: ShoppingToolCall[] = [];
    let sawError = false;
    let pendingToolOutputError = "";
    publish({ type: "thinking" });

    const body: Record<string, unknown> = {
      sessionId: input.session.modelSessionId || input.session.id,
      userId: input.session.shop,
      tag: "shopping-chat",
      jobId: input.session.id,
      instructions,
      tools: SHOPPING_CHAT_TOOLS,
      thinkingLevel: "low",
    };
    const platform = process.env.SHOPPING_CHAT_PLATFORM?.trim();
    const model = process.env.SHOPPING_CHAT_MODEL?.trim();
    if (platform) body.platform = platform;
    if (model) body.model = model;
    if (message) body.message = message;
    else if (toolResults) body.toolResults = toolResults;
    else break;

    await streamTagserviceShoppingResponses(apiKey, body, ({ event, data }) => {
      if (event === "error") {
        if (missingToolOutputMessage(data) && !recoveredMissingTools) {
          pendingToolOutputError = String(
            asRecord(data).message ?? "No tool output found",
          );
          return;
        }
        sawError = true;
        const row = asRecord(data);
        publish({
          type: "error",
          message: String(row.message ?? "Shopping assistant failed"),
        });
        return;
      }
      const text = textFromEvent(event, data);
      if (text) publish({ type: "text", text });
      pendingCalls.push(...collectToolCallsFromStreamEvent(event, data));
    });

    if (pendingToolOutputError && !recoveredMissingTools) {
      recoveredMissingTools = true;
      rotateModelSession(input.session);
      message = lastUserText;
      toolResults = undefined;
      continue;
    }
    if (sawError) break;

    const calls = dedupeToolCalls(pendingCalls);
    if (!calls.length) {
      publish({ type: "done" });
      break;
    }

    toolResults = [];
    message = undefined;
    let askedUser = false;
    for (const call of calls) {
      if (!SERVER_TOOLS.has(call.name)) {
        toolResults.push({
          id: call.id,
          name: call.name,
          payload: { error: "unsupported_tool" },
        });
        continue;
      }
      const result = await executeShoppingTool(call, {
        admin: input.admin,
        config: input.config,
        session: input.session,
        catalog,
      });
      for (const event of result.events) {
        publish(event);
        if (event.type === "choice") {
          askedUser = true;
          input.session.pendingAskUser = {
            id: call.id,
            question: event.question,
            options: event.options,
          };
        }
      }
      toolResults.push({
        id: call.id,
        name: call.name,
        payload: result.payload,
      });
    }
    if (askedUser) {
      input.session.pendingTools = toolResults;
      publish({ type: "done" });
      break;
    }
  }

  persistCatalog(input.session, catalog);
  saveShoppingChatSession(input.session);
}

export function shoppingCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
