/**
 * Koshoy rules — single source for the model instructions and the
 * server-side output guard (checkReply). Change a rule here, both follow.
 */
import { DESIGN_KIND_LABELS, DESIGN_KINDS, type DesignKind } from "./engine";
import { PRICE_PLACEHOLDER } from "./events";

export interface KoshoyRule {
  id: string;
  /** Model-facing directive (Turkish, addressed to the assistant). */
  text: string;
  /** Sentences matching any pattern are replaced by KOSHOY_SAFE_TOPIC_REPLY. */
  guard?: RegExp[];
}

export const KOSHOY_RULES: readonly KoshoyRule[] = [
  {
    id: "no_room_dimensions",
    text: "Oda ölçüsü söylemezsin; odanın boyutları, metrekaresi ya da duvar ölçüsü hakkında konuşmazsın.",
    guard: [
      /oda(?:n[ıi]n|m[ıi]n|s[ıi]n[ıi]n)?\s+(?:ölçü|boyut|genişli|uzunlu|eni\b|boyu\b)/iu,
      /duvar(?:[ıi]n)?\s+(?:ölçü|boyut|genişli|uzunlu)/iu,
      // "m²" arrives as "m2" after NFKC normalisation
      /metrekare|m²|(?<![\p{L}\p{N}])m2(?![\p{L}\p{N}])/iu,
    ],
  },
  {
    id: "no_service_topics",
    text: "Teslimat, kurulum, garanti ve ödeme konularını konuşmazsın.",
    guard: [
      /teslim|kargo|nakliye|sevk|kurulum|montaj|monte|garanti|taksit|kredi\s*kart|havale|fatura|iade|nakit|sipari[şs]|(?<![\p{L}])öde(?!v)|(?<![\p{L}\p{N}])eft(?![\p{L}\p{N}])/iu,
      // "kurar", "kurulur", "kurduk", "kuracak"… but not "kural", "kurdele"
      /(?<![\p{L}])kur(?:ar|arız|arlar|ul\p{L}*|du\p{L}*|ma[kmn]\p{L}*|acak\p{L}*|acağ\p{L}*|uyor\p{L}*)(?![\p{L}])/iu,
      /(?<![\p{L}])usta(?:m[ıi]z|lar\p{L}*|n[ıi]z)?(?![\p{L}])/iu,
      // shipping in "we / it gets" forms: "gönderiyoruz", "yollarız", "ulaştırılır";
      // "fotoğraf gönderebilirsin" or "hale getirdim" stay untouched
      /(?<![\p{L}])(?:gönder(?:iyoruz|iriz|eceğiz|il\p{L}*|im\p{L}*)|yoll(?:uyoruz|ar[ıi]z|ayaca[kğ][ıi]z|an\p{L}*)|ulaştır\p{L}*|getir(?:iyoruz|iriz|eceğiz))(?![\p{L}])/iu,
      // "takarız", "takıyoruz" (not "takım", "takma")
      /(?<![\p{L}])tak(?:ar[ıi]z|[ıi]yoruz|aca[kğ][ıi]z|arlar)(?![\p{L}])/iu,
      /(?:parça\p{L}*|kendin)\s+(?:\p{L}+\s+){0,2}birleştir/iu,
      /(?<![\p{L}])(?:peşin(?:at\p{L}*)?|kap[ıi]da|kap[ıi]n(?:[ıi]z)?a|teminat\p{L}*)(?![\p{L}])|kap[ıi]ya\s+kadar/iu,
      /değişim\s+hakk|değiştirme\s+hakk|ücretsiz\s+değişim/iu,
    ],
  },
  {
    id: "address_sen",
    text: "Müşteriye her zaman \"sen\" diye hitap edersin, \"siz\" demezsin.",
  },
  {
    id: "no_invented_numbers",
    text: `Rakam uydurmazsın. Ölçü ve fiyat yalnızca araçlardan gelir; fiyat gelmediyse ${PRICE_PLACEHOLDER} yazarsın.`,
  },
  {
    id: "product_language",
    text: "Ürün dili kullanırsın: gövde, kapak, raf, çekmece, askı, renk, genişlik. Modül, grid, id, SKU, araç ya da sistem adı gibi teknik terimler kullanmazsın.",
    guard: [
      /(?<![\p{L}\p{N}])(?:mcp|sku|grid|tagservice|decor[- ]?ai|openai|chatgpt|gpt|gemini|claude|anthropic|opus|sonnet|haiku|llm|prompt|shopify|api|json)(?![\p{L}\p{N}])/iu,
      /sugar/iu,
      // self-references to the model / platform
      /yapay\s*zek[aâ]|dil\s+modeli|(?<![\p{L}])model(?:iyim|im)(?![\p{L}])/iu,
      // snake_case identifiers: tool names, enum slugs
      /(?<![\p{L}\p{N}])[a-z]+_[a-z_]+(?![\p{L}\p{N}])/u,
      // camelCase identifiers (case-sensitive on purpose)
      /(?<![\p{L}\p{N}])[a-z]+[A-Z][A-Za-z]*(?![\p{L}\p{N}])/u,
      // URLs and hosts: storage buckets, CDNs, any domain
      /https?:\/\/|(?<![\p{L}\p{N}])www\.|amazonaws|cloudfront|(?<![\p{L}\p{N}])s3[.-]/iu,
      /(?<![\p{L}\p{N}])[\p{L}\p{N}-]+\.(?:com|net|org|io|app|dev|ai|co|tr)(?![\p{L}\p{N}])/iu,
    ],
  },
  {
    id: "simple_panel_only",
    text: "Tam konfigüratör müşteriye kapalıdır; müşteri yalnız sade paneli görür, ondan başka bir araç önermezsin.",
  },
  {
    id: "photo_context_only",
    text: "Fotoğraf yalnızca bağlam olarak kullanılır; fotoğraftan ölçü çıkarmazsın.",
  },
];

export const KOSHOY_SCOPE = {
  inScope: DESIGN_KINDS.map((kind) => ({ kind, label: DESIGN_KIND_LABELS[kind] })),
  outOfScope: ["koltuk", "kanepe", "yatak", "sandalye", "mutfak dolabı"],
} as const;

export const KOSHOY_SAFE_TOPIC_REPLY =
  "Bu konuda bilgi veremiyorum; istersen tasarımın üzerinden devam edelim.";
export const KOSHOY_SAFE_EMPTY_REPLY =
  "Bunu şu an net söyleyemiyorum; istersen tasarımın üzerinden devam edelim.";
export const KOSHOY_SAFE_STOPPED_REPLY =
  "Bunu şu an tamamlayamadım; istersen ne istediğini biraz daha açık yazar mısın?";

/* ---------------- scope pre-check ---------------- */

const IN_SCOPE_WORDS =
  /gard[ıi]?rop|dola[pb]|komodin|[sş]ifonyer|(?<![\p{L}])tv(?![\p{L}])|televizyon|kitapl[ıi]k|vestiyer|portmanto|ayakkab[ıi]l[ıi]k|(?<![\p{L}])raf/iu;
const OUT_OF_SCOPE_PHRASES = /mutfak\s+(?:dola[pb]|tezgah)/iu;
const OUT_OF_SCOPE_WORDS =
  /koltu[kğ]|kanepe|berjer|sandalye|yata[kğ](?!\s*oda)|mutfa[kğ]/iu;

/** "out" only when a clearly unsupported product is asked and nothing in scope is. */
export function classifyScope(text: string): "in" | "out" | "unknown" {
  const value = text.toLocaleLowerCase("tr-TR");
  if (OUT_OF_SCOPE_PHRASES.test(value)) return "out";
  if (IN_SCOPE_WORDS.test(value)) return "in";
  if (OUT_OF_SCOPE_WORDS.test(value)) return "out";
  return "unknown";
}

export function kindFromText(text: string): DesignKind | null {
  const value = text.toLocaleLowerCase("tr-TR");
  if (/komodin/u.test(value)) return "komodin";
  if (/[sş]ifonyer/u.test(value)) return "sifonyer";
  if (/(?<![\p{L}])tv(?![\p{L}])|televizyon/u.test(value)) return "tv_unitesi";
  if (/kitapl[ıi]k/u.test(value)) return "kitaplik";
  if (/vestiyer|portmanto/u.test(value)) return "vestiyer";
  if (/gard[ıi]?rop|dola[pb]/u.test(value)) return "gardirop";
  return null;
}

/* ---------------- number handling ---------------- */

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/gu;
/** Reply side also joins digit groups split by spaces ("15 958,14", "1 5 9 5 8"). */
const REPLY_NUMBER_TOKEN = /\d+(?:[.,]\d+)*(?: \d+(?:[.,]\d+)*)*/gu;
const CURRENCY = String.raw`(?:TL|₺|TRY|lira\p{L}*)(?![\p{L}])`;
const CURRENCY_AFTER = new RegExp(String.raw`^\s*${CURRENCY}`, "iu");
const CURRENCY_BEFORE = /₺\s*$/u;
/** Prices are TL only: an amount in any other currency is always invented. */
const FOREIGN_AFTER =
  /^\s*(?:(?:dolar|euro|avro|sterlin|kuruş)\p{L}*|USD|EUR|GBP|[$€£])(?![\p{L}])/iu;
const FOREIGN_BEFORE = /[$€£]\s*$/u;
/** "5 bin TL": the scale word is part of the amount. */
const SCALE_AFTER = /^\s*(bin|milyon|milyar)(?![\p{L}])/iu;
const SCALES: Record<string, number> = { bin: 1e3, milyon: 1e6, milyar: 1e9 };
const UNIT_AFTER = /^\s*(?:cm|mm|m|metre|santim|%)(?![\p{L}])/iu;
const PERCENT_BEFORE = /(?:%|yüzde)\s*$/iu;
/** A sentence about cost: a bare amount in it is read as a price. */
const PRICE_WORDS = /fiyat|tutar(?!l[ıi])|ücret|maliyet|bütçe|(?<![\p{L}])(?:para|eder)(?![\p{L}])/u;
/**
 * "960 olur", "960 civarı", "960." — nothing counted follows the number, so
 * in a price sentence it is an amount. "960 cm", "2 raf" are not.
 */
const BARE_AFTER =
  /^\s*(?:$|[^\s\p{L}\p{N}]|(?:civar|kadar|gibi|ol|eder|ediyor|tutar|falan|filan|ile|ila|aras|veya|yaklaşık)\p{L}*)/u;
/** "2. gövde": an ordinal, not the end of a sentence (no i flag: \p{Ll} must stay lowercase). */
const ORDINAL_AFTER = /^\.\s+\p{Ll}/u;
/** Turkish number words; longer words first ("altmış" before "altı"). */
const NUMBER_WORD =
  "(?:altmış|altı|yetmiş|yedi|seksen|sekiz|doksan|dokuz|bir|iki|üç|dört|beş|on|yirmi|otuz|kırk|elli|yüz|bin|milyon|milyar|buçuk)";
/** A run of number words, spaced or joined ("on beş bin", "onbeş", "yüzelli"). */
const SPELLED_RUN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${NUMBER_WORD}(?:\s*${NUMBER_WORD})*(?![\p{L}])`,
  "gu",
);
const SPELLED_WORD = new RegExp(NUMBER_WORD, "gu");
const WORD_VALUES: Record<string, number> = {
  bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9,
  on: 10, yirmi: 20, otuz: 30, kırk: 40, elli: 50, altmış: 60, yetmiş: 70, seksen: 80, doksan: 90,
  yüz: 100, bin: 1e3, milyon: 1e6, milyar: 1e9,
};
/** Zero-width and other format characters used to split forbidden words. */
const FORMAT_CHARS = /\p{Cf}/gu;
/** Plain counts ("2 çekmece") are not facts the model can invent dangerously. */
const SMALL_COUNT_MAX = 10;

function canonical(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Any decimal digit (Arabic-Indic "١٦", Devanagari…) to ASCII; NFKC only
 * folds the full-width ones. Unicode encodes decimal digits in runs of ten
 * starting at zero, so the offset from the run start is the digit.
 */
function asciiDigits(text: string): string {
  return text.replace(/(?![0-9])\p{Nd}/gu, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    let start = code;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

/**
 * The one reading of a numeric token, Turkish style: "15.958,14" and
 * "1.000" are thousands, "230,4" is a decimal, "230.4" (no 3-digit groups)
 * is a plain decimal, "15 958,14" uses spaces for thousands. Mixed or odd
 * formats ("1 5 9 5 8") are never trusted.
 */
function readingOf(token: string): number | null {
  let value = Number.NaN;
  if (/^\d+$/.test(token)) value = Number(token);
  else if (
    /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(token) ||
    /^\d{1,3}(?: \d{3})+(?:,\d+)?$/.test(token) ||
    /^\d+,\d+$/.test(token)
  ) {
    value = Number(token.replace(/[. ]/g, "").replace(",", "."));
  } else if (/^\d+\.\d+$/.test(token)) value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** "on beş bin" → 15000, "bin beş yüz" → 1500, "iki buçuk" → 2.5. */
function spelledValue(words: readonly string[]): number {
  let total = 0;
  let group = 0;
  for (const word of words) {
    if (word === "buçuk") {
      group += 0.5;
      continue;
    }
    const value = WORD_VALUES[word] ?? 0;
    if (value === 100) group = (group || 1) * 100;
    else if (value >= 1000) {
      total += (group || 1) * value;
      group = 0;
    } else group += value;
  }
  return total + group;
}

function readings(token: string): string[] {
  const value = readingOf(token);
  return value === null ? [] : [canonical(value)];
}

function scaleAfter(after: string): { factor: number; length: number } | null {
  const match = SCALE_AFTER.exec(after);
  if (!match) return null;
  return { factor: SCALES[match[1].toLocaleLowerCase("tr-TR")] ?? 1, length: match[0].length };
}

function walkFacts(
  value: unknown,
  out: Set<string>,
  onNumber: ((value: number, out: Set<string>) => void) | null,
  onText: (value: string, out: Set<string>) => void,
) {
  if (typeof value === "number") {
    if (onNumber && Number.isFinite(value)) onNumber(value, out);
    return;
  }
  if (typeof value === "string") {
    onText(value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkFacts(item, out, onNumber, onText);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "id" || key.endsWith("Id")) continue;
      walkFacts(item, out, onNumber, onText);
    }
  }
}

/**
 * Collects every number in a tool payload / summary (numbers and numeric
 * text). Typed numbers (sizes) also allow their rounding ("230,4" → "230");
 * text such as price displays stays exact. id fields are skipped so digits
 * inside opaque ids never count.
 */
export function numbersIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  walkFacts(
    value,
    out,
    (number, set) => {
      set.add(canonical(number));
      set.add(canonical(Math.round(number)));
    },
    (text, set) => {
      for (const match of text.matchAll(NUMBER_TOKEN)) {
        for (const reading of readings(match[0])) set.add(reading);
      }
    },
  );
  return out;
}

/**
 * Collects the prices a reply may quote: only amounts written with a
 * currency in tool text (the price displays, "15.958,14 TL"). Typed numbers
 * (sizes, counts, indexes) are never prices.
 */
export function pricesIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  walkFacts(value, out, null, (text, set) => {
    for (const match of text.matchAll(NUMBER_TOKEN)) {
      const at = match.index ?? 0;
      const after = text.slice(at + match[0].length);
      const scale = scaleAfter(after);
      const rest = scale ? after.slice(scale.length) : after;
      if (!CURRENCY_AFTER.test(rest) && !CURRENCY_BEFORE.test(text.slice(0, at))) continue;
      const reading = readingOf(match[0]);
      if (reading !== null) set.add(canonical(reading * (scale?.factor ?? 1)));
    }
  });
  return out;
}

/* ---------------- output guard ---------------- */

export type GuardIssue = "topic" | "leak" | "price" | "number";

export interface CheckReplyResult {
  text: string;
  changed: boolean;
  issues: GuardIssue[];
}

/** Sentence boundaries that ignore decimal/thousand separators ("15.958,14"). */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n") {
      out.push(text.slice(start, i + 1));
      start = i + 1;
      continue;
    }
    if (".!?…".includes(ch)) {
      if (ch === "." && /\d/.test(text[i - 1] ?? "") && ORDINAL_AFTER.test(text.slice(i))) continue;
      let end = i + 1;
      while (end < text.length && ".!?…".includes(text[end])) end += 1;
      if (end >= text.length || /\s/.test(text[end])) {
        while (end < text.length && text[end] !== "\n" && /\s/.test(text[end])) end += 1;
        out.push(text.slice(start, end));
        start = end;
        i = end - 1;
      }
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

function ruleHit(sentence: string): GuardIssue | null {
  const lower = sentence.toLocaleLowerCase("tr-TR");
  for (const rule of KOSHOY_RULES) {
    for (const pattern of rule.guard ?? []) {
      if (pattern.test(sentence) || pattern.test(lower)) {
        return rule.id === "product_language" ? "leak" : "topic";
      }
    }
  }
  return null;
}

function trailingSpace(sentence: string): string {
  return /\s*$/.exec(sentence)?.[0] ?? "";
}

function isBare(after: string): boolean {
  return !ORDINAL_AFTER.test(after) && BARE_AFTER.test(after.toLocaleLowerCase("tr-TR"));
}

interface AmountToken {
  at: number;
  /** End of the amount, a following scale word included ("5 bin"). */
  end: number;
  value: string | null;
  spelled: boolean;
  /** A plain small integer, i.e. a count such as "2 çekmece". */
  small: boolean;
}

/**
 * Every amount in a sentence: digit tokens and runs of number words. A
 * single number word only counts when it is clearly an amount ("bin",
 * "on cm", "elli TL", "yüzde on"), so "bir raf" or "ön yüz" stay words.
 */
function amountTokens(sentence: string): AmountToken[] {
  const tokens: AmountToken[] = [];
  for (const match of sentence.matchAll(REPLY_NUMBER_TOKEN)) {
    const at = match.index ?? 0;
    const token = match[0];
    const scale = scaleAfter(sentence.slice(at + token.length));
    const reading = readingOf(token);
    tokens.push({
      at,
      end: at + token.length + (scale?.length ?? 0),
      value: reading === null ? null : canonical(reading * (scale?.factor ?? 1)),
      spelled: false,
      small: !scale && /^\d+$/.test(token) && Number(token) <= SMALL_COUNT_MAX,
    });
  }
  // Number words are matched on the tr-TR lowercase copy when it lines up.
  const lower = sentence.toLocaleLowerCase("tr-TR");
  const words = lower.length === sentence.length ? lower : sentence;
  for (const match of words.matchAll(SPELLED_RUN)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    const parts = match[0].match(SPELLED_WORD) ?? [];
    const scaled = parts.some((word) => word in SCALES);
    const after = sentence.slice(end);
    const amount =
      parts.length > 1 ||
      scaled ||
      CURRENCY_AFTER.test(after) ||
      FOREIGN_AFTER.test(after) ||
      UNIT_AFTER.test(after) ||
      PERCENT_BEFORE.test(sentence.slice(0, at));
    if (!amount) continue;
    const value = spelledValue(parts);
    tokens.push({
      at,
      end,
      value: canonical(value),
      spelled: true,
      small: !scaled && Number.isInteger(value) && value <= SMALL_COUNT_MAX,
    });
  }
  return tokens.sort((a, b) => a.at - b.at);
}

/**
 * Checks one buffered model reply before it is emitted.
 * - text is NFKC-normalised, every decimal digit is mapped to ASCII and
 *   format characters are removed first, so full-width or Arabic-Indic
 *   digits and zero-width splits cannot slip past the patterns
 * - forbidden topic / internals → sentence replaced by a safe sentence (once)
 * - an amount with a TL currency must equal a known price exactly (tr-TR
 *   reading), otherwise → [FİYAT]; sizes and counts never pass as prices
 * - an amount in another currency, a spelled-out amount next to a currency
 *   and a bare amount in a sentence about price are prices too → [FİYAT]
 *   unless they are a known price written in digits
 * - any other number (digits or number words) not allowed, except small
 *   counts → sentence dropped
 *
 * allowedPrices: canonical values from pricesIn(). When omitted they are
 * read from the currency amounts inside allowedNumbers.
 */
export function checkReply(
  text: string,
  allowedNumbers: Iterable<unknown>,
  allowedPrices?: ReadonlySet<string>,
): CheckReplyResult {
  const facts = [...allowedNumbers];
  const allowed = new Set<string>();
  for (const item of facts) numbersIn(item, allowed);
  const prices = allowedPrices ?? pricesIn(facts);
  const issues = new Set<GuardIssue>();
  let safeUsed = false;
  const kept: string[] = [];
  const source = asciiDigits(text.normalize("NFKC").replace(FORMAT_CHARS, ""));

  for (const sentence of splitSentences(source)) {
    const hit = ruleHit(sentence);
    if (hit) {
      issues.add(hit);
      if (!safeUsed) {
        kept.push(KOSHOY_SAFE_TOPIC_REPLY + (trailingSpace(sentence) || " "));
        safeUsed = true;
      }
      continue;
    }

    const priceTalk = PRICE_WORDS.test(sentence.toLocaleLowerCase("tr-TR"));
    let drop = false;
    let rebuilt = "";
    let cursor = 0;
    let consumed = 0;
    for (const token of amountTokens(sentence)) {
      if (token.at < consumed) continue;
      const before = sentence.slice(0, token.at);
      const after = sentence.slice(token.end);
      const foreign = FOREIGN_AFTER.exec(after);
      const foreignBefore = FOREIGN_BEFORE.test(before);
      const currency = CURRENCY_AFTER.exec(after);
      const currencyBefore = CURRENCY_BEFORE.test(before);
      // Prices are only ever quoted as digits from a tool; words never are.
      const quoted = !token.spelled && token.value !== null && prices.has(token.value);
      let replace: boolean;
      if (foreign || foreignBefore) replace = true;
      else if (currency || currencyBefore) replace = !quoted;
      else if (priceTalk && isBare(after) && !PERCENT_BEFORE.test(before)) {
        replace = !quoted;
      } else {
        consumed = token.end;
        if (token.value !== null && allowed.has(token.value)) continue;
        if (token.small && !UNIT_AFTER.test(after) && !PERCENT_BEFORE.test(before)) continue;
        issues.add("number");
        drop = true;
        break;
      }
      const marker = foreign ?? currency;
      const end = token.end + (marker ? marker[0].length : 0);
      consumed = end;
      if (!replace) continue;
      issues.add("price");
      let start = token.at;
      if (foreignBefore) start = before.replace(FOREIGN_BEFORE, "").length;
      else if (currencyBefore) start = before.replace(CURRENCY_BEFORE, "").length;
      rebuilt += sentence.slice(cursor, Math.max(start, cursor)) + PRICE_PLACEHOLDER;
      cursor = end;
    }
    if (drop) continue;
    kept.push(rebuilt + sentence.slice(cursor));
  }

  let out = kept.join("").replace(/[ \t]+\n/g, "\n").trim();
  if (!out && text.trim()) {
    out = KOSHOY_SAFE_EMPTY_REPLY;
  }
  return { text: out, changed: out !== text.trim(), issues: [...issues] };
}
