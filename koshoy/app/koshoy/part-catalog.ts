/**
 * Koshoy's part products in the shop, read by structure instead of by exact name.
 * Every part title (or its `koshoy.parca` metafield, when the shop sets one) is
 * read as part + front series + colour + size, so a title written in another
 * order, case or spacing still finds the same product. The part names live in
 * shop-parts.json: a new front series is a row there, not code.
 */
import type { BomPart } from "./engine";
import shopParts from "./shop-parts.json";

/** One shop variant as the Admin API returns it. */
export interface ShopVariant {
  variantId: string;
  productTitle: string;
  productStatus: string;
  variantTitle: string;
  sku: string;
  price: string;
  /** Product metafield koshoy.parca: the part written like a title; wins over the title. */
  partField: string;
}

export interface PartName {
  name: string;
  part: BomPart;
  series?: string;
  /** The size in the title does not matter (handles: "Serek Kulp 128 Siyah" or "Serek Kulp SİYAH"). */
  anySize?: boolean;
}

/** One shop product read as a part. */
export interface ShopPart {
  part: BomPart;
  /** Front series id (`CABINET_RULES.frontSeries`), "" for parts without one. */
  series: string;
  /** Shop colour in upper case, e.g. "LAKE BEYAZ"; "" when the title has none (askı). */
  color: string;
  /** "960x2304x640", or one number for parts sized by width only (askı). */
  size: string;
  /** False for bodies sold without plinth ("(bazasız)"). */
  plinth: boolean;
}

export const PART_NAMES: readonly PartName[] = shopParts.partNames as PartName[];

// Longest first, so "Acıbay Çekmece" is found before "Acıbay".
const NAMES_LONGEST_FIRST = [...PART_NAMES].sort((a, b) => b.name.length - a.name.length);

const NO_PLINTH = / \(?BAZASIZ\)? /;

function words(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleUpperCase("tr-TR")
    .replace(/[^\p{L}\p{N}()]+/gu, " ")
    .trim();
}

/** Reads a part title such as "Bakay LAKE BEYAZ 960x2304x640 mm"; null when no part name is in it. */
export function readPartTitle(title: string): ShopPart | null {
  let rest = ` ${words(title)} `;
  const name = NAMES_LONGEST_FIRST.find((row) => rest.includes(` ${words(row.name)} `));
  if (!name) return null;
  rest = rest.replace(` ${words(name.name)} `, " ");

  const plinth = !NO_PLINTH.test(rest);
  rest = rest.replace(NO_PLINTH, " ");

  let size = "";
  const box = /(\d+) ?X ?(\d+) ?X ?(\d+)( ?MM)?/.exec(rest);
  const width = /(\d+)( ?MM)?/.exec(rest);
  if (box) {
    size = `${box[1]}x${box[2]}x${box[3]}`;
    rest = rest.replace(box[0], " ");
  } else if (width) {
    size = width[1];
    rest = rest.replace(width[0], " ");
  }

  return {
    part: name.part,
    series: name.series ?? "",
    color: rest.replace(/\s+/g, " ").trim(),
    size: name.anySize ? "" : size,
    plinth,
  };
}

/** Same key for the same part however its title is written. */
export function partKey(part: ShopPart): string {
  return [part.part, part.series, part.color, part.size, part.plinth ? "" : "bazasız"].join("|");
}

/** Key of a title, or null when the title is not a known part. */
export function partKeyOfTitle(title: string): string | null {
  const part = readPartTitle(title);
  return part ? partKey(part) : null;
}

export interface PartCatalog {
  byKey: Map<string, ShopVariant>;
  /** The same part sold twice: no price until only one is left, never a guess. */
  ambiguous: Map<string, ShopVariant[]>;
  /** Products whose title is not a part (e.g. "Test"). */
  unread: ShopVariant[];
  /** Colours the shop sells bodies in (upper case), e.g. "LAKE BEYAZ". */
  bodyColors: Set<string>;
}

/** Only these can go in a cart; draft and archived products are left out. */
const SELLABLE = new Set(["ACTIVE", "UNLISTED"]);

function partText(variant: ShopVariant): string {
  if (variant.partField.trim()) return variant.partField;
  const option = variant.variantTitle && variant.variantTitle !== "Default Title" ? ` ${variant.variantTitle}` : "";
  return `${variant.productTitle}${option}`;
}

export function readPartCatalog(variants: readonly ShopVariant[]): PartCatalog {
  const candidates = new Map<string, ShopVariant[]>();
  const unread: ShopVariant[] = [];
  const bodyColors = new Set<string>();
  for (const variant of variants) {
    if (!SELLABLE.has(variant.productStatus)) continue;
    const part = readPartTitle(partText(variant));
    if (!part) {
      unread.push(variant);
      continue;
    }
    if (part.part === "GOVDE" && part.color) bodyColors.add(part.color);
    const key = partKey(part);
    candidates.set(key, [...(candidates.get(key) ?? []), variant]);
  }

  const byKey = new Map<string, ShopVariant>();
  const ambiguous = new Map<string, ShopVariant[]>();
  for (const [key, list] of candidates) {
    if (list.length === 1) byKey.set(key, list[0]);
    else ambiguous.set(key, list);
  }
  return { byKey, ambiguous, unread, bodyColors };
}

/** The shop variant for a part title (our expected title or any spelling of it). */
export function findPart(catalog: PartCatalog, title: string): ShopVariant | null {
  const key = partKeyOfTitle(title);
  return key ? catalog.byKey.get(key) ?? null : null;
}
