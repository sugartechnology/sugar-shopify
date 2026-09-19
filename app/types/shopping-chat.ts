export type ShoppingDisplayEventType =
  | "text"
  | "products"
  | "cart"
  | "choice"
  | "thinking"
  | "done"
  | "error";

export interface ShoppingProductCard {
  productId: string;
  variantId: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: string;
  priceCents: number;
  currency: string;
  available: boolean;
}

export interface ShoppingCartLine {
  variantId: string;
  productId: string;
  title: string;
  handle?: string;
  quantity: number;
  priceCents: number;
  currency: string;
  imageUrl: string;
}

export interface ShoppingProposedCart {
  items: ShoppingCartLine[];
  totalCents: number;
  remainingCents: number;
  budgetCents: number;
  currency: string;
  dropped: Array<{ variantId: string; title: string; reason: string }>;
}

export interface ShoppingChoiceOption {
  id: string;
  label: string;
}

export type ShoppingDisplayEvent =
  | { type: "text"; text: string }
  | { type: "products"; items: ShoppingProductCard[] }
  | { type: "cart"; items: ShoppingCartLine[]; total: number; remaining: number; dropped: ShoppingProposedCart["dropped"]; currency: string; budget: number }
  | { type: "choice"; question: string; options: ShoppingChoiceOption[] }
  | { type: "thinking" }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ShoppingBrief {
  budgetCents: number | null;
  currency: string;
  room: string;
  style: string;
  mustHave: string[];
  exclude: string[];
  notes: string;
}

export const EMPTY_SHOPPING_BRIEF: ShoppingBrief = {
  budgetCents: null,
  currency: "",
  room: "",
  style: "",
  mustHave: [],
  exclude: [],
  notes: "",
};

export type ShoppingClientInput =
  | { type: "message"; text: string }
  | { type: "choice"; selected: string; label?: string }
  | { type: "add_cart_result"; ok: boolean; error?: string };

export interface ShoppingAssistantFilters {
  collectionIds: string[];
  inStockOnly: boolean;
  minPriceCents: number | null;
  maxPriceCents: number | null;
}

export interface ShoppingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ShoppingPendingTool {
  id: string;
  name: string;
  payload: Record<string, unknown>;
}
