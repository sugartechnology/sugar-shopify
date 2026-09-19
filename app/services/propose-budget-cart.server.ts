import type {
  ShoppingCartLine,
  ShoppingProductCard,
  ShoppingProposedCart,
} from "../types/shopping-chat";

export interface ProposeCartInputItem {
  variantId: string;
  quantity?: number;
}

function normalizeQuantity(raw: unknown): number {
  const qty = Number(raw);
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return Math.min(99, Math.floor(qty));
}

export function proposeBudgetCart(input: {
  budgetCents: number;
  currency: string;
  requested: ProposeCartInputItem[];
  catalog: ShoppingProductCard[];
  allowedVariantIds: string[];
}): ShoppingProposedCart {
  const budgetCents = Math.max(0, Math.floor(input.budgetCents));
  const byVariant = new Map(input.catalog.map((item) => [item.variantId, item]));
  const allowed = new Set(input.allowedVariantIds);
  const dropped: ShoppingProposedCart["dropped"] = [];
  const candidates: ShoppingCartLine[] = [];

  for (const request of input.requested) {
    const variantId = String(request.variantId ?? "").trim();
    const product = byVariant.get(variantId);
    if (!variantId || !product) {
      dropped.push({
        variantId,
        title: variantId || "unknown",
        reason: "not_in_search",
      });
      continue;
    }
    if (allowed.size && !allowed.has(variantId)) {
      dropped.push({
        variantId,
        title: product.title,
        reason: "not_allowed",
      });
      continue;
    }
    if (!product.available) {
      dropped.push({
        variantId,
        title: product.title,
        reason: "unavailable",
      });
      continue;
    }
    candidates.push({
      variantId: product.variantId,
      productId: product.productId,
      title: product.title,
      handle: product.handle,
      quantity: normalizeQuantity(request.quantity),
      priceCents: product.priceCents,
      currency: product.currency || input.currency,
      imageUrl: product.imageUrl,
    });
  }

  candidates.sort((a, b) => a.priceCents * a.quantity - b.priceCents * b.quantity);

  const items: ShoppingCartLine[] = [];
  let totalCents = 0;
  for (const line of candidates) {
    const lineTotal = line.priceCents * line.quantity;
    if (budgetCents > 0 && totalCents + lineTotal > budgetCents) {
      dropped.push({
        variantId: line.variantId,
        title: line.title,
        reason: "over_budget",
      });
      continue;
    }
    items.push(line);
    totalCents += lineTotal;
  }

  return {
    items,
    totalCents,
    remainingCents: Math.max(0, budgetCents - totalCents),
    budgetCents,
    currency: input.currency,
    dropped,
  };
}

export function cartToDisplay(cart: ShoppingProposedCart) {
  return {
    type: "cart" as const,
    items: cart.items,
    total: cart.totalCents,
    remaining: cart.remainingCents,
    dropped: cart.dropped,
    currency: cart.currency,
    budget: cart.budgetCents,
  };
}
