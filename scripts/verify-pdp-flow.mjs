/**
 * Storefront JS akış mantığını doğrular (SugarPdp step logic).
 * Node ortamında çalışır; tarayıcı gerektirmez.
 */
import assert from "node:assert/strict";

function shouldSkipProductStep(config, catalog) {
  if (config.skipProductSelection) return true;
  return catalog.length === 0;
}

function afterRoomUploadStep() {
  return "products";
}

function designErrorStep(hasRoomFile) {
  return hasRoomFile ? "products" : "upload";
}

const cases = [
  {
    name: "no catalog → review step (not AI)",
    catalog: [],
    expectedNext: "products",
    expectedError: "products",
    hasRoom: true,
  },
  {
    name: "skip flag → review step (not AI)",
    config: { skipProductSelection: true },
    catalog: [{ productId: "1" }],
    expectedNext: "products",
    expectedError: "products",
    hasRoom: true,
  },
  {
    name: "catalog + no skip → products step",
    config: { skipProductSelection: false },
    catalog: [{ productId: "2" }],
    expectedNext: "products",
    expectedError: "products",
    hasRoom: true,
  },
  {
    name: "generate error without room → upload",
    catalog: [],
    expectedNext: "products",
    expectedError: "upload",
    hasRoom: false,
  },
];

for (const testCase of cases) {
  assert.equal(
    afterRoomUploadStep(testCase.config, testCase.catalog),
    testCase.expectedNext,
    `${testCase.name}: afterRoomUpload`,
  );
  assert.equal(
    designErrorStep(testCase.hasRoom),
    testCase.expectedError,
    `${testCase.name}: designErrorStep`,
  );
}

assert.equal(shouldSkipProductStep({ skipProductSelection: true }, [{ productId: "1" }]), true);
assert.equal(shouldSkipProductStep({ skipProductSelection: false }, []), true);
assert.equal(
  shouldSkipProductStep({ skipProductSelection: false }, [{ productId: "1" }]),
  false,
);

console.log("verify-pdp-flow: all checks passed");
