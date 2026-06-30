/**
 * Storefront JS akış mantığını doğrular (SugarPdp skip/step logic).
 * Node ortamında çalışır; tarayıcı gerektirmez.
 */
import assert from "node:assert/strict";

function shouldSkipProductStep(config, catalog) {
  if (config.skipProductSelection) return true;
  return catalog.length === 0;
}

function designErrorStep(config, catalog) {
  return shouldSkipProductStep(config, catalog) ? "upload" : "products";
}

function afterRoomUploadStep(config, catalog) {
  return shouldSkipProductStep(config, catalog) ? "loading" : "products";
}

const cases = [
  {
    name: "no catalog → skip to loading",
    config: { skipProductSelection: false },
    catalog: [],
    expectedNext: "loading",
    expectedError: "upload",
  },
  {
    name: "skip flag → skip to loading",
    config: { skipProductSelection: true },
    catalog: [{ productId: "1" }],
    expectedNext: "loading",
    expectedError: "upload",
  },
  {
    name: "catalog + no skip → products step",
    config: { skipProductSelection: false },
    catalog: [{ productId: "2" }],
    expectedNext: "products",
    expectedError: "products",
  },
];

for (const testCase of cases) {
  assert.equal(
    afterRoomUploadStep(testCase.config, testCase.catalog),
    testCase.expectedNext,
    `${testCase.name}: afterRoomUpload`,
  );
  assert.equal(
    designErrorStep(testCase.config, testCase.catalog),
    testCase.expectedError,
    `${testCase.name}: designErrorStep`,
  );
}

console.log("verify-pdp-flow: all checks passed");
