import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { getCabinetEngine } from "./engine";
import { catalogGaps, clickUpTaskOpener, reportCatalogGaps, type KoshoyAlarmDb } from "./catalog-alarm.server";
import { readPartCatalog, type ShopVariant } from "./part-catalog";
import { requiredTemplateSkus } from "./sku-audit.server";

function memoryDb(): KoshoyAlarmDb {
  const rows = new Map<string, string>();
  return {
    koshoyAlarm: {
      async findUnique({ where }) {
        const signature = rows.get(where.key);
        return signature === undefined ? null : { signature };
      },
      async upsert({ where, update }) {
        rows.set(where.key, update.signature);
        return null;
      },
    },
  };
}

const variant = (id: number, productTitle: string): ShopVariant => ({
  variantId: `gid://shopify/ProductVariant/${id}`,
  productTitle,
  productStatus: "ACTIVE",
  variantTitle: "Default Title",
  sku: "",
  price: "10.00",
  partField: "",
});

describe("koshoy catalog alarm", () => {
  it("lists every template part the shop cannot price, twins apart", () => {
    const engine = getCabinetEngine();
    const [first, second, ...rest] = requiredTemplateSkus(engine).map((row) => row.sku);
    const catalog = readPartCatalog([
      variant(1, first),
      variant(2, second),
      variant(3, second),
      ...rest.slice(1).map((title, index) => variant(10 + index, title)),
    ]);
    assert.deepEqual(catalogGaps(engine, catalog), [
      { title: second, problem: "twins" },
      { title: rest[0], problem: "missing" },
    ]);
  });

  it("reports a changed gap list once, also across restarts, and says when it closes", async () => {
    const errors = mock.method(console, "error", () => {});
    const infos = mock.method(console, "info", () => {});
    const db = memoryDb();
    const tasks: string[] = [];
    const deps = { db, openTask: async (name: string) => void tasks.push(name) };
    const gaps = [{ title: "Bakay KUMTAŞI 960x2304x640 mm", problem: "missing" as const }];
    assert.equal(await reportCatalogGaps("s", gaps, deps), "reported");
    assert.equal(await reportCatalogGaps("s", gaps, deps), "unchanged");
    assert.equal(await reportCatalogGaps("s", [], deps), "closed");
    assert.equal(await reportCatalogGaps("s", [], deps), "unchanged");
    assert.deepEqual(tasks, ["Koshoy katalog: 1 parça fiyatlanamıyor"]);
    assert.ok(errors.mock.calls.some((call) => call.arguments[0] === "[koshoy] catalog gap"));
    errors.mock.restore();
    infos.mock.restore();
  });

  it("opens ClickUp tasks only when a token is set", () => {
    assert.equal(clickUpTaskOpener({}), undefined);
    assert.equal(typeof clickUpTaskOpener({ KOSHOY_ALARM_CLICKUP_TOKEN: "x" }), "function");
  });
});
