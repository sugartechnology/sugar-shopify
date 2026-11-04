/**
 * Catalog alarm: after every catalog read, every part the configurator can
 * produce (requiredCatalogSkus: part × size × colour, not only templates) is
 * checked against the shop. When the list of problems changes it is logged
 * once ("[koshoy] catalog gap") and, with KOSHOY_ALARM_CLICKUP_TOKEN set,
 * opened as one ClickUp task in KoshoyBugs, so a data change in the shop is
 * seen before a customer sees [FİYAT]. The last report is kept in
 * KoshoyAlarm, so a restart never repeats it.
 */
import type { CabinetEngine } from "./engine";
import { findPart, partKeyOfTitle, type PartCatalog } from "./part-catalog";
import { requiredCatalogSkus } from "./sku-audit.server";

export interface CatalogGap {
  /** Part title the configurator can need. */
  title: string;
  /** missing: no shop product; twins: more than one, so none is used. */
  problem: "missing" | "twins";
}

export function catalogGaps(engine: CabinetEngine, catalog: PartCatalog): CatalogGap[] {
  const gaps: CatalogGap[] = [];
  for (const row of requiredCatalogSkus(engine)) {
    if (findPart(catalog, row.sku)) continue;
    const twins = catalog.ambiguous.has(partKeyOfTitle(row.sku) ?? "");
    gaps.push({ title: row.sku, problem: twins ? "twins" : "missing" });
  }
  return gaps;
}

/** The part of Prisma the alarm needs. */
export interface KoshoyAlarmDb {
  koshoyAlarm: {
    findUnique(args: { where: { key: string } }): Promise<{ signature: string } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; signature: string };
      update: { signature: string };
    }): Promise<unknown>;
  };
}

export interface CatalogAlarmDeps {
  db: KoshoyAlarmDb;
  /** Opens one ClickUp task; leave out to only log. */
  openTask?: (name: string, markdown: string) => Promise<void>;
}

/** A ClickUp task stays readable: the full list is on the admin page. */
const ALARM_MAX_LINES = 50;

const PROBLEM_TEXT: Record<CatalogGap["problem"], string> = {
  missing: "mağazada yok",
  twins: "iki ürün var, hangisi bilinmiyor",
};

function alarmText(shop: string, gaps: CatalogGap[]): { name: string; markdown: string } {
  const shown = gaps.slice(0, ALARM_MAX_LINES);
  const lines = shown.map((gap) => `- \`${gap.title}\` — ${PROBLEM_TEXT[gap.problem]}`);
  if (gaps.length > shown.length) lines.push(`- … ve ${gaps.length - shown.length} parça daha (admin sayfası → Katalog sağlığı, ya da CSV)`);
  return {
    name: `Koshoy katalog: ${gaps.length} parça fiyatlanamıyor`,
    markdown: [
      `Mağaza: ${shop}`,
      "",
      "Koshoy'un tasarlayabileceği bu parçalar mağazada bulunamadı. Bu parçaları içeren tasarımlarda fiyat yerine [FİYAT] görünür, sepete eklenmez.",
      "",
      ...lines,
      "",
      "Ad biçimi: `{Parça} {RENK} {G}x{Y}x{D} mm` (ör. `Bakay LAKE BEYAZ 960x2304x640 mm`). Ayrıntı: Koshoy Studio admin sayfası → Katalog sağlığı.",
    ].join("\n"),
  };
}

/** Reports a changed gap list once; returns what it did. */
export async function reportCatalogGaps(
  shop: string,
  gaps: CatalogGap[],
  deps: CatalogAlarmDeps,
): Promise<"unchanged" | "closed" | "reported"> {
  const key = `catalog-gaps:${shop}`;
  const signature = gaps.map((gap) => `${gap.problem}:${gap.title}`).sort().join("\n");
  const last = await deps.db.koshoyAlarm.findUnique({ where: { key } });
  if ((last?.signature ?? "") === signature) return "unchanged";
  await deps.db.koshoyAlarm.upsert({ where: { key }, create: { key, signature }, update: { signature } });

  if (!gaps.length) {
    console.info("[koshoy] catalog gap closed", { shop });
    return "closed";
  }
  console.error("[koshoy] catalog gap", {
    shop,
    missing: gaps.filter((gap) => gap.problem === "missing").length,
    twins: gaps.filter((gap) => gap.problem === "twins").length,
    first: gaps.slice(0, 10).map((gap) => gap.title),
  });
  if (deps.openTask) {
    const { name, markdown } = alarmText(shop, gaps);
    try {
      await deps.openTask(name, markdown);
    } catch (error) {
      console.error("[koshoy] catalog alarm task failed", error instanceof Error ? error.message : error);
    }
  }
  return "reported";
}

/** KoshoyBugs; KOSHOY_ALARM_CLICKUP_LIST overrides it. */
const KOSHOY_BUGS_LIST = "1100330000094036";

/** ClickUp task opener from the environment, or undefined when no token is set. */
export function clickUpTaskOpener(env: Record<string, string | undefined> = process.env): CatalogAlarmDeps["openTask"] {
  const token = env.KOSHOY_ALARM_CLICKUP_TOKEN?.trim();
  if (!token) return undefined;
  const list = env.KOSHOY_ALARM_CLICKUP_LIST?.trim() || KOSHOY_BUGS_LIST;
  return async (name, markdown) => {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${list}/task`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ name, markdown_description: markdown }),
    });
    if (!response.ok) throw new Error(`ClickUp ${response.status}`);
  };
}
