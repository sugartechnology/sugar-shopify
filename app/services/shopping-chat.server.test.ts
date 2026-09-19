import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectToolCallsFromStreamEvent,
  completePendingToolResults,
  parseClientInput,
  shoppingChatInstructions,
  startHopFromClient,
} from "./shopping-chat.server";
import { EMPTY_SHOPPING_BRIEF } from "../types/shopping-chat";
import {
  appendDisplayEvent,
  createShoppingChatSession,
  publicDisplayEvents,
} from "./shopping-chat-session.server";

describe("shopping chat client contract", () => {
  it("accepts only the three client input types", () => {
    assert.deepEqual(parseClientInput({ type: "message", text: "sofa" }), {
      type: "message",
      text: "sofa",
    });
    assert.deepEqual(parseClientInput({ type: "choice", selected: "a", label: "A" }), {
      type: "choice",
      selected: "a",
      label: "A",
    });
    assert.deepEqual(parseClientInput({ type: "add_cart_result", ok: true }), {
      type: "add_cart_result",
      ok: true,
      error: undefined,
    });
    assert.equal(parseClientInput({ type: "tool_call", name: "search_products" }), null);
  });

  it("coalesces consecutive assistant text deltas in the session transcript", () => {
    const session = createShoppingChatSession("demo.myshopify.com");
    appendDisplayEvent(session, { type: "text", text: "Ş" });
    appendDisplayEvent(session, { type: "text", text: "u" });
    appendDisplayEvent(session, { type: "text", text: " an" });
    assert.deepEqual(session.events, [{ type: "text", text: "Şu an" }]);
  });

  it("merges consecutive product listings instead of stacking pages", () => {
    const session = createShoppingChatSession("demo.myshopify.com");
    const sofa = {
      productId: "1",
      variantId: "11",
      title: "Sofa",
      handle: "sofa",
      imageUrl: "",
      price: "10.00",
      priceCents: 1000,
      currency: "TRY",
      available: true,
    };
    const rug = {
      ...sofa,
      productId: "2",
      variantId: "22",
      title: "Rug",
      handle: "rug",
    };
    appendDisplayEvent(session, { type: "products", items: [sofa] });
    appendDisplayEvent(session, { type: "products", items: [sofa, rug] });
    assert.equal(session.events.length, 1);
    assert.equal(session.events[0]?.type, "products");
    if (session.events[0]?.type === "products") {
      assert.deepEqual(
        session.events[0].items.map((item) => item.variantId),
        ["11", "22"],
      );
    }
  });

  it("strips thinking and done from hydrated transcript", () => {
    const events = publicDisplayEvents([
      { type: "thinking" },
      { type: "text", text: "hi" },
      { type: "done" },
    ]);
    assert.deepEqual(events, [{ type: "text", text: "hi" }]);
  });

  it("keeps the model brief on the server instructions, not as a client payload", () => {
    const text = shoppingChatInstructions(
      { ...EMPTY_SHOPPING_BRIEF, budgetCents: 10000, currency: "TRY" },
      "TRY",
    );
    assert.match(text, /Current brief/);
    assert.match(text, /Do not call add_to_cart/);
  });

  it("parses tool calls from id, callId, and message events", () => {
    assert.deepEqual(
      collectToolCallsFromStreamEvent("tool_call", {
        callId: "call_NGGM4gT2l0HdZDxe7g86kepY",
        name: "ask_user",
        arguments: { question: "Budget?", options: [] },
      }),
      [
        {
          id: "call_NGGM4gT2l0HdZDxe7g86kepY",
          name: "ask_user",
          arguments: { question: "Budget?", options: [] },
        },
      ],
    );
    assert.equal(
      collectToolCallsFromStreamEvent("message", { text: "hello" }).length,
      0,
    );
    assert.equal(
      collectToolCallsFromStreamEvent("message", {
        id: "call_search",
        name: "search_products",
        arguments: { q: "sofa" },
      }).length,
      1,
    );
  });

  it("posts every pending tool id, including ask_user, instead of a new user message", () => {
    const session = createShoppingChatSession("demo.myshopify.com", "TRY");
    session.pendingTools = [
      {
        id: "call_search",
        name: "search_products",
        payload: { count: 1 },
      },
      {
        id: "call_NGGM4gT2l0HdZDxe7g86kepY",
        name: "ask_user",
        payload: { question: "Budget?" },
      },
    ];
    const hop = startHopFromClient(session, {
      type: "choice",
      selected: "budget_25k",
      label: "25.000",
    });
    assert.equal(hop.message, undefined);
    assert.deepEqual(hop.toolResults, [
      { id: "call_search", name: "search_products", payload: { count: 1 } },
      {
        id: "call_NGGM4gT2l0HdZDxe7g86kepY",
        name: "ask_user",
        payload: { question: "Budget?", selected: "budget_25k", label: "25.000" },
      },
    ]);
    assert.equal(session.pendingTools.length, 0);
    assert.equal(session.pendingAskUser, null);
  });

  it("does not invent ask_N ids when a choice is displayed", () => {
    const session = createShoppingChatSession("demo.myshopify.com");
    session.pendingAskUser = {
      id: "call_NGGM4gT2l0HdZDxe7g86kepY",
      question: "Budget?",
      options: [{ id: "a", label: "A" }],
    };
    appendDisplayEvent(session, {
      type: "choice",
      question: "Budget?",
      options: [{ id: "a", label: "A" }],
    });
    assert.equal(session.pendingAskUser?.id, "call_NGGM4gT2l0HdZDxe7g86kepY");
  });

  it("completes a pending ask_user when the shopper types instead of clicking", () => {
    const results = completePendingToolResults(
      [
        {
          id: "call_NGGM4gT2l0HdZDxe7g86kepY",
          name: "ask_user",
          payload: { question: "Budget?" },
        },
      ],
      { type: "message", text: "25000" },
    );
    assert.deepEqual(results, [
      {
        id: "call_NGGM4gT2l0HdZDxe7g86kepY",
        name: "ask_user",
        payload: { question: "Budget?", selected: "free_text", label: "25000" },
      },
    ]);
  });
});
