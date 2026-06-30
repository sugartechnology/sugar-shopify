/**
 * Saved design localStorage grouping logic.
 */
import assert from "node:assert/strict";

const DESIGN_STORAGE_KEY = "sugar_pdp_visitor_designs";

function readDesignStore(raw) {
  if (!raw) return { version: 1, byProduct: {} };
  const parsed = JSON.parse(raw);
  if (!parsed.byProduct) parsed.byProduct = {};
  return parsed;
}

function saveDesignForProduct(store, productId, record, maxCount) {
  const key = String(productId);
  let list = store.byProduct[key] || [];
  const id = String(record.id || record.generationId);
  list = list.filter((item) => String(item.id) !== id);
  list.unshift({
    id,
    generationId: record.generationId || id,
    imageUrl: record.imageUrl,
    createdAt: record.createdAt || Date.now(),
    products: record.products || [],
  });
  store.byProduct[key] = list.slice(0, maxCount);
  return store;
}

const store = readDesignStore(null);
saveDesignForProduct(store, "111", { id: "a", generationId: "a", imageUrl: "x.jpg" }, 20);
saveDesignForProduct(store, "111", { id: "b", generationId: "b", imageUrl: "y.jpg" }, 20);
saveDesignForProduct(store, "222", { id: "c", generationId: "c", imageUrl: "z.jpg" }, 20);

assert.equal(store.byProduct["111"].length, 2);
assert.equal(store.byProduct["222"].length, 1);
assert.equal(store.byProduct["111"][0].id, "b");

saveDesignForProduct(store, "111", { id: "a", generationId: "a", imageUrl: "x2.jpg", createdAt: 99 }, 20);
assert.equal(store.byProduct["111"][0].id, "a");
assert.equal(store.byProduct["111"][0].imageUrl, "x2.jpg");

console.log("verify-saved-designs: all checks passed");
