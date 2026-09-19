import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proposeBudgetCart } from "./propose-budget-cart.server";
import type { ShoppingProductCard } from "../types/shopping-chat";

const catalog: ShoppingProductCard[] = [
  {
    productId: "1",
    variantId: "11",
    title: "Sofa",
    handle: "sofa",
    imageUrl: "",
    price: "200.00",
    priceCents: 20000,
    currency: "TRY",
    available: true,
  },
  {
    productId: "2",
    variantId: "22",
    title: "Lamp",
    handle: "lamp",
    imageUrl: "",
    price: "50.00",
    priceCents: 5000,
    currency: "TRY",
    available: true,
  },
  {
    productId: "3",
    variantId: "33",
    title: "Rug",
    handle: "rug",
    imageUrl: "",
    price: "80.00",
    priceCents: 8000,
    currency: "TRY",
    available: false,
  },
];

describe("proposeBudgetCart", () => {
  it("keeps cheaper items and drops over-budget and unavailable", () => {
    const cart = proposeBudgetCart({
      budgetCents: 26000,
      currency: "TRY",
      requested: [
        { variantId: "11", quantity: 1 },
        { variantId: "22", quantity: 1 },
        { variantId: "33", quantity: 1 },
      ],
      catalog,
      allowedVariantIds: ["11", "22", "33"],
    });
    assert.equal(cart.items.length, 2);
    assert.equal(cart.totalCents, 25000);
    assert.equal(cart.remainingCents, 1000);
    assert.ok(cart.dropped.some((row) => row.reason === "unavailable"));
  });

  it("rejects ids that were not searched", () => {
    const cart = proposeBudgetCart({
      budgetCents: 100000,
      currency: "TRY",
      requested: [{ variantId: "999" }],
      catalog,
      allowedVariantIds: ["11"],
    });
    assert.equal(cart.items.length, 0);
    assert.equal(cart.dropped[0]?.reason, "not_in_search");
  });
});
