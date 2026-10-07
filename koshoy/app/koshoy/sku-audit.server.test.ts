import { test } from "node:test";
import assert from "node:assert/strict";
import { getCabinetEngine } from "./engine";
import { auditSkus, requiredTemplateSkus } from "./sku-audit.server";

test("requiredTemplateSkus covers every template part, unique and sorted", () => {
  const rows = requiredTemplateSkus(getCabinetEngine());
  assert.ok(rows.length > 0);
  const skus = rows.map((row) => row.sku);
  assert.deepEqual(skus, [...new Set(skus)].sort((a, b) => a.localeCompare(b)));
  assert.ok(rows.every((row) => row.usedBy.length > 0));
  assert.ok(rows.some((row) => row.line.part === "GOVDE"));
});

test("auditSkus matches case-insensitively and marks missing ones", () => {
  const [first, second] = requiredTemplateSkus(getCabinetEngine());
  const audit = auditSkus([first, second], [
    { productTitle: "Gövde", productStatus: "DRAFT", variantTitle: "x", sku: first.sku.toLowerCase(), price: "10.00" },
  ]);
  assert.equal(audit[0].found?.productTitle, "Gövde");
  assert.equal(audit[1].found, null);
});
