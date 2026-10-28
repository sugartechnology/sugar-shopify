/**
 * Journey data the store team (Akın) changes without a code change: room
 * sets, product kinds and their questions, budget levels, scope, texts, info
 * images and the look of the shop's colours. Seven JSON documents in Koshoy's own database (KoshoyDataDoc),
 * written only through the data API (data-api.server.ts, docs/veri-api.md)
 * and read by the turn code through `koshoyData().snapshot()`.
 *
 * Bad data never breaks the shop: a document is validated before it is
 * saved, and a stored document that no longer validates (the code changed
 * since) falls back to its code default. `audit()` lists those.
 */
import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import { DESIGN_KIND_LABELS, DESIGN_KINDS, type DesignKind } from "./engine";
import { KOSHOY_SCOPE } from "./rules";
import { colorIdOf, DEFAULT_COLOR_LOOKS, shopColorKey, type ColorLook } from "./shop-colors";

export const KOSHOY_DATA_KEYS = ["rooms", "kinds", "levels", "scope", "texts", "images", "colors"] as const;
export type KoshoyDataKey = (typeof KOSHOY_DATA_KEYS)[number];

/** Largest stored document (JSON bytes). */
export const KOSHOY_DATA_MAX_BYTES = 64 * 1024;

/* ---------------- document types ---------------- */

export interface KoshoyDataRoom {
  id: string;
  /** Customer-facing room name. */
  label: string;
  /** Other words customers use for the room ("oturma odası" for salon). */
  synonyms: string[];
  items: { kind: DesignKind; count: number }[];
}

export interface KoshoyQuestionOption {
  id: string;
  label: string;
  /** Short instruction for the assistant, e.g. "toplam genişlik 192 cm". */
  hint: string;
}

export interface KoshoyQuestion {
  id: string;
  /** room: changes the outer size (asked before room approval); product: interior. */
  level: "room" | "product";
  question: string;
  options: KoshoyQuestionOption[];
}

export interface KoshoyDataKind {
  kind: DesignKind;
  label: string;
  synonyms: string[];
  /** Several of this kind in a room stand side by side as one piece. */
  joinSameKind: boolean;
  questions: KoshoyQuestion[];
}

/** auto: comes by itself and the customer is told; ask: asked with both totals. */
export type KoshoyLevelChoice = "auto" | "ask";

export interface KoshoyDataLevel {
  id: string;
  /** The choice as the customer clicks it ("Fiyatına bakarak seçeyim"). */
  label: string;
  /** Short name in the room summary next to "Bütçe" ("Fiyata göre"); the label when not given. */
  name: string;
  /** Crown on tall bodies. */
  crown: KoshoyLevelChoice;
  /** The matte front series (Aruuke, core series id `kapak-18`). */
  front: KoshoyLevelChoice;
}

export interface KoshoyDataScope {
  /** Products Koshoy does not make. */
  outOfScope: string[];
  /** Topics the assistant never brings up. */
  unsaid: string[];
}

export interface KoshoyDataTexts {
  customMadeWarning: string;
  promiseLine: string;
}

export interface KoshoyDataImage {
  /** "*" = every kind. */
  kind: DesignKind | "*";
  /** crown_on, crown_off, front_<series>, panel_<x>, handle_<x> */
  option: string;
  url: string;
}

export interface KoshoyDataDocs {
  rooms: KoshoyDataRoom[];
  kinds: KoshoyDataKind[];
  levels: KoshoyDataLevel[];
  scope: KoshoyDataScope;
  texts: KoshoyDataTexts;
  images: KoshoyDataImage[];
  /** Look of each shop colour (shop-colors.ts); a shop colour without one is not offered. */
  colors: ColorLook[];
}

export type KoshoyDataResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ---------------- code defaults ---------------- */

const DEFAULT_ROOMS: KoshoyDataRoom[] = [
  {
    id: "yatak_odasi",
    label: "Yatak odası",
    synonyms: [],
    items: [
      { kind: "gardirop", count: 1 },
      { kind: "komodin", count: 2 },
      { kind: "sifonyer", count: 1 },
    ],
  },
  {
    id: "salon",
    label: "Salon",
    synonyms: [],
    items: [
      { kind: "tv_unitesi", count: 1 },
      { kind: "kitaplik", count: 1 },
    ],
  },
  {
    id: "antre",
    label: "Antre",
    synonyms: [],
    items: [
      { kind: "vestiyer", count: 1 },
      { kind: "ayakkabilik", count: 1 },
    ],
  },
  { id: "mutfak", label: "Mutfak", synonyms: [], items: [{ kind: "kiler", count: 1 }] },
  { id: "banyo", label: "Banyo", synonyms: [], items: [{ kind: "banyo_dolabi", count: 1 }] },
  {
    id: "cocuk_odasi",
    label: "Çocuk odası",
    synonyms: [],
    items: [
      { kind: "gardirop", count: 1 },
      { kind: "kitaplik", count: 1 },
      { kind: "komodin", count: 1 },
    ],
  },
  { id: "calisma_odasi", label: "Çalışma odası", synonyms: [], items: [{ kind: "kitaplik", count: 2 }] },
];

const DEFAULT_QUESTIONS: Partial<Record<DesignKind, KoshoyQuestion[]>> = {
  gardirop: [
    {
      id: "kisi_sayisi",
      level: "room",
      question: "Gardırobu kaç kişi kullanacak?",
      options: [
        { id: "1_kisi", label: "1 kişi", hint: "toplam genişlik 96 cm" },
        { id: "2_kisi", label: "2 kişi", hint: "toplam genişlik 192 cm" },
        { id: "3_ve_ustu", label: "3 ve üstü", hint: "toplam genişlik 288 cm" },
      ],
    },
    {
      id: "kiyafet_duzeni",
      level: "product",
      question: "Kıyafetler çoğunlukla nasıl duruyor?",
      options: [
        { id: "askida", label: "Askıda", hint: "askı alanı çok, raf az" },
        { id: "katli", label: "Katlı", hint: "raf ve çekmece çok, askı az" },
        { id: "ikisi_de", label: "İkisi de", hint: "askı ve raf dengeli" },
      ],
    },
  ],
  ayakkabilik: [
    {
      id: "kutu",
      level: "product",
      question: "Ayakkabılar kutuda mı duruyor?",
      options: [
        { id: "kutuda", label: "Kutuda", hint: "derinlik 48 cm" },
        { id: "kutusuz", label: "Kutusuz", hint: "derinlik 32 cm" },
      ],
    },
  ],
  kitaplik: [
    {
      id: "raf_icerigi",
      level: "product",
      question: "Raflarda çoğunlukla ne duracak?",
      options: [
        { id: "kitap", label: "Kitap", hint: "raf aralığı sık" },
        { id: "kutu_dekor", label: "Kutu ve dekor", hint: "raf aralığı geniş" },
      ],
    },
  ],
};

export const KOSHOY_DATA_DEFAULTS: KoshoyDataDocs = {
  rooms: DEFAULT_ROOMS,
  kinds: DESIGN_KINDS.map((kind) => ({
    kind,
    label: DESIGN_KIND_LABELS[kind],
    synonyms: [],
    joinSameKind: kind === "kitaplik",
    questions: DEFAULT_QUESTIONS[kind] ?? [],
  })),
  levels: [
    { id: "en_iyisi", label: "En iyisi olsun", name: "En iyisi", crown: "auto", front: "auto" },
    { id: "fiyatina_bakarak", label: "Fiyatına bakarak seçeyim", name: "Fiyata göre", crown: "ask", front: "ask" },
  ],
  scope: { outOfScope: [...KOSHOY_SCOPE.outOfScope], unsaid: ["nem dayanımı"] },
  texts: {
    customMadeWarning: "Bu ürünler yalnız senin için tasarlanan özel üretimdir.",
    promiseLine: "Bunlar adresini aldığımızda netleşir; sepette göreceksin.",
  },
  images: [],
  colors: DEFAULT_COLOR_LOOKS,
};

/** A fresh copy, so a caller changing a snapshot never changes the defaults. */
function defaultDoc<K extends KoshoyDataKey>(key: K): KoshoyDataDocs[K] {
  return structuredClone(KOSHOY_DATA_DEFAULTS[key]);
}

/* ---------------- validation helpers ---------------- */
// Each reader adds a short Turkish error naming the row and returns a
// placeholder, so one pass reports every problem in the document.

const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const IMAGE_OPTION = /^(crown_on|crown_off|front_[a-z0-9-]+|panel_[a-z0-9_-]+|handle_[a-z0-9_-]+)$/;
const IMAGE_HOST = "image-s3.sm.mncdn.com";
const LEVEL_FORBIDDEN = /ucuz|hesapl[ıi]/u;
const MAX_ERRORS = 30;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(errors: string[], where: string, field: string, value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && text.length <= max) return text;
  errors.push(`${where}: "${field}" 1–${max} karakterlik bir metin olmalı.`);
  return "";
}

function readSlug(errors: string[], where: string, field: string, value: unknown): string {
  if (typeof value === "string" && SLUG.test(value)) return value;
  errors.push(`${where}: "${field}" yalnız küçük harf (Türkçe harfsiz), rakam, _ ve - olabilir; en fazla 40 karakter.`);
  return "";
}

function readList(
  errors: string[],
  where: string,
  field: string,
  value: unknown,
  min: number,
  max: number,
): unknown[] {
  if (Array.isArray(value) && value.length >= min && value.length <= max) return value;
  const name = field ? `"${field}" ` : "";
  errors.push(`${where}: ${name}${min}–${max} elemanlı bir liste olmalı.`);
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function readInteger(
  errors: string[],
  where: string,
  field: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) return value;
  errors.push(`${where}: "${field}" ${min} ile ${max} arasında tam sayı olmalı.`);
  return min;
}

function readTextList(
  errors: string[],
  where: string,
  field: string,
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  return readList(errors, where, field, value, 0, maxItems).map((item, index) =>
    readText(errors, where, `${field} ${index + 1}`, item, maxLength),
  );
}

function readOneOf<T extends string>(
  errors: string[],
  where: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  errors.push(`${where}: "${field}" şunlardan biri olmalı: ${allowed.join(", ")}.`);
  return allowed[0];
}

function readBoolean(errors: string[], where: string, field: string, value: unknown): boolean {
  if (typeof value === "boolean") return value;
  errors.push(`${where}: "${field}" true ya da false olmalı.`);
  return false;
}

/** "Oda 2 (salon)" — position counted from 1, id when it has one. */
function rowName(name: string, index: number, id: unknown): string {
  return typeof id === "string" && id ? `${name} ${index + 1} (${id.slice(0, 40)})` : `${name} ${index + 1}`;
}

function result<T>(errors: string[], value: T): KoshoyDataResult<T> {
  return errors.length ? { ok: false, errors: errors.slice(0, MAX_ERRORS) } : { ok: true, value };
}

function noteDuplicate(errors: string[], seen: Set<string>, where: string, what: string, value: string) {
  if (!value) return;
  if (seen.has(value)) errors.push(`${where}: ${what} "${value.slice(0, 40)}" iki kez yazılmış.`);
  seen.add(value);
}

/* ---------------- validators ---------------- */

export function validateRooms(value: unknown): KoshoyDataResult<KoshoyDataRoom[]> {
  const errors: string[] = [];
  if (!Array.isArray(value)) return { ok: false, errors: ["rooms bir liste olmalı: [ {oda}, {oda} ]."] };
  const ids = new Set<string>();
  const rooms = readList(errors, "rooms", "", value, 1, 30).map((raw, index) => {
    const row = asRecord(raw);
    const where = rowName("Oda", index, row.id);
    const id = readSlug(errors, where, "id", row.id);
    noteDuplicate(errors, ids, where, "id", id);
    const kinds = new Set<string>();
    const items = readList(errors, where, "items", row.items, 1, 6).map((rawItem, itemIndex) => {
      const item = asRecord(rawItem);
      const itemWhere = `${where}, ürün ${itemIndex + 1}`;
      const kind = readOneOf(errors, itemWhere, "kind", item.kind, DESIGN_KINDS);
      noteDuplicate(errors, kinds, itemWhere, "kind", typeof item.kind === "string" ? item.kind : "");
      return { kind, count: readInteger(errors, itemWhere, "count", item.count, 1, 4) };
    });
    return {
      id,
      label: readText(errors, where, "label", row.label, 60),
      synonyms: readTextList(errors, where, "synonyms", row.synonyms, 20, 40),
      items,
    };
  });
  return result(errors, rooms);
}

function readQuestion(errors: string[], where: string, raw: unknown): KoshoyQuestion {
  const row = asRecord(raw);
  const optionIds = new Set<string>();
  const options = readList(errors, where, "options", row.options, 2, 4).map((rawOption, index) => {
    const option = asRecord(rawOption);
    const optionWhere = `${where}, ${rowName("seçenek", index, option.id)}`;
    const id = readSlug(errors, optionWhere, "id", option.id);
    noteDuplicate(errors, optionIds, optionWhere, "id", id);
    return {
      id,
      label: readText(errors, optionWhere, "label", option.label, 60),
      hint: readText(errors, optionWhere, "hint", option.hint, 120),
    };
  });
  return {
    id: readSlug(errors, where, "id", row.id),
    level: readOneOf(errors, where, "level", row.level, ["room", "product"] as const),
    question: readText(errors, where, "question", row.question, 200),
    options,
  };
}

export function validateKinds(value: unknown): KoshoyDataResult<KoshoyDataKind[]> {
  const errors: string[] = [];
  if (!Array.isArray(value)) return { ok: false, errors: ["kinds bir liste olmalı: [ {tür}, {tür} ]."] };
  const seenKinds = new Set<string>();
  const kinds = readList(errors, "kinds", "", value, 1, DESIGN_KINDS.length).map((raw, index) => {
    const row = asRecord(raw);
    const where = rowName("Tür", index, row.kind);
    const kind = readOneOf(errors, where, "kind", row.kind, DESIGN_KINDS);
    noteDuplicate(errors, seenKinds, where, "kind", typeof row.kind === "string" ? row.kind : "");
    const questionIds = new Set<string>();
    const questions = readList(errors, where, "questions", row.questions, 0, 6).map((rawQuestion, qIndex) => {
      const questionWhere = `${where}, ${rowName("soru", qIndex, asRecord(rawQuestion).id)}`;
      const question = readQuestion(errors, questionWhere, rawQuestion);
      noteDuplicate(errors, questionIds, questionWhere, "id", question.id);
      return question;
    });
    return {
      kind,
      label: readText(errors, where, "label", row.label, 60),
      synonyms: readTextList(errors, where, "synonyms", row.synonyms, 20, 40),
      joinSameKind: readBoolean(errors, where, "joinSameKind", row.joinSameKind),
      questions,
    };
  });
  return result(errors, kinds);
}

export function validateLevels(value: unknown): KoshoyDataResult<KoshoyDataLevel[]> {
  const errors: string[] = [];
  if (!Array.isArray(value)) return { ok: false, errors: ["levels bir liste olmalı: [ {seviye}, {seviye} ]."] };
  const ids = new Set<string>();
  const choices = ["auto", "ask"] as const;
  const levels = readList(errors, "levels", "", value, 1, 4).map((raw, index) => {
    const row = asRecord(raw);
    const where = rowName("Seviye", index, row.id);
    const id = readSlug(errors, where, "id", row.id);
    noteDuplicate(errors, ids, where, "id", id);
    const label = readText(errors, where, "label", row.label, 60);
    const name = row.name === undefined ? label : readText(errors, where, "name", row.name, 40);
    for (const [field, text] of [["label", label], ["name", name]] as const) {
      if (LEVEL_FORBIDDEN.test(text.toLocaleLowerCase("tr-TR"))) {
        errors.push(`${where}: "${field}" içinde "ucuz" ya da "hesaplı" geçemez.`);
      }
    }
    return {
      id,
      label,
      name,
      crown: readOneOf(errors, where, "crown", row.crown, choices),
      front: readOneOf(errors, where, "front", row.front, choices),
    };
  });
  return result(errors, levels);
}

export function validateScope(value: unknown): KoshoyDataResult<KoshoyDataScope> {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ['scope bir nesne olmalı: { "outOfScope": [...], "unsaid": [...] }.'] };
  }
  const row = asRecord(value);
  return result(errors, {
    outOfScope: readTextList(errors, "scope", "outOfScope", row.outOfScope, 50, 60),
    unsaid: readTextList(errors, "scope", "unsaid", row.unsaid, 50, 60),
  });
}

export function validateTexts(value: unknown): KoshoyDataResult<KoshoyDataTexts> {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ['texts bir nesne olmalı: { "customMadeWarning": "...", "promiseLine": "..." }.'] };
  }
  const row = asRecord(value);
  return result(errors, {
    customMadeWarning: readText(errors, "texts", "customMadeWarning", row.customMadeWarning, 300),
    promiseLine: readText(errors, "texts", "promiseLine", row.promiseLine, 300),
  });
}

/** The same pattern the storefront whitelist uses (events.ts): a picture saved here is always shown. */
const IMAGE_URL = /^https:\/\/image-s3\.sm\.mncdn\.com\/[A-Za-z0-9._~%\/-]{1,400}$/;

function isAllowedImageUrl(value: string): boolean {
  return IMAGE_URL.test(value);
}

export function validateImages(value: unknown): KoshoyDataResult<KoshoyDataImage[]> {
  const errors: string[] = [];
  if (!Array.isArray(value)) return { ok: false, errors: ["images bir liste olmalı: [ {resim}, {resim} ]."] };
  const pairs = new Set<string>();
  const kinds = ["*", ...DESIGN_KINDS] as const;
  const images = readList(errors, "images", "", value, 0, 200).map((raw, index) => {
    const row = asRecord(raw);
    const where = `Resim ${index + 1}`;
    const kind = readOneOf(errors, where, "kind", row.kind, kinds);
    const option = typeof row.option === "string" ? row.option : "";
    if (!IMAGE_OPTION.test(option)) {
      errors.push(`${where}: "option" crown_on, crown_off, front_…, panel_… ya da handle_… olmalı.`);
    } else {
      noteDuplicate(errors, pairs, where, "kind + option", `${kind} ${option}`);
    }
    const url = typeof row.url === "string" ? row.url : "";
    if (url.length > 500 || !isAllowedImageUrl(url)) {
      errors.push(`${where}: "url" https://${IMAGE_HOST}/… ile başlamalı.`);
    }
    return { kind, option, url };
  });
  return result(errors, images);
}

const CSS_COLOR = /^#[0-9a-fA-F]{6}$/;

export function validateColors(value: unknown): KoshoyDataResult<ColorLook[]> {
  const errors: string[] = [];
  if (!Array.isArray(value)) return { ok: false, errors: ["colors bir liste olmalı: [ {renk}, {renk} ]."] };
  const ids = new Set<string>();
  const colors = readList(errors, "colors", "", value, 1, 30).map((raw, index) => {
    const row = asRecord(raw);
    const where = `Renk ${index + 1}`;
    const shopColor = shopColorKey(readText(errors, where, "shopColor", row.shopColor, 40));
    if (shopColor) noteDuplicate(errors, ids, where, "shopColor", colorIdOf(shopColor));
    const label = readText(errors, where, "label", row.label, 40);
    const css = typeof row.css === "string" && CSS_COLOR.test(row.css) ? row.css.toLowerCase() : "";
    if (!css) errors.push(`${where}: "css" #rrggbb biçiminde bir renk kodu olmalı (ör. #f1eee7).`);
    const use = readOneOf(errors, where, "use", row.use, ["body", "handle"] as const);
    return { shopColor, label, css, use };
  });
  if (!colors.some((color) => color.use === "body")) errors.push('colors: en az bir "use": "body" (dolap rengi) olmalı.');
  return result(errors, colors);
}

const VALIDATORS: { [K in KoshoyDataKey]: (value: unknown) => KoshoyDataResult<KoshoyDataDocs[K]> } = {
  rooms: validateRooms,
  kinds: validateKinds,
  levels: validateLevels,
  scope: validateScope,
  texts: validateTexts,
  images: validateImages,
  colors: validateColors,
};

export function isKoshoyDataKey(value: string): value is KoshoyDataKey {
  return (KOSHOY_DATA_KEYS as readonly string[]).includes(value);
}

/** Size cap, then the document's own validator. Unknown fields are dropped. */
export function validateKoshoyData<K extends KoshoyDataKey>(
  key: K,
  value: unknown,
): KoshoyDataResult<KoshoyDataDocs[K]> {
  const json = JSON.stringify(value);
  if (json === undefined) return { ok: false, errors: ["Belge boş."] };
  if (Buffer.byteLength(json) > KOSHOY_DATA_MAX_BYTES) {
    return { ok: false, errors: [`Belge çok büyük (en fazla ${KOSHOY_DATA_MAX_BYTES / 1024} KB).`] };
  }
  return VALIDATORS[key](value);
}

/* ---------------- store ---------------- */

export interface KoshoyDataDocRow {
  key: string;
  version: number;
  json: string;
  updatedAt: Date;
}

export interface KoshoyDataHistoryRow {
  id: string;
  key: string;
  version: number;
  json: string;
  createdAt: Date;
}

/** The slice of the Prisma client the store uses (tests pass an in-memory one). */
export interface KoshoyDataDb {
  koshoyDataDoc: {
    findMany(): Promise<KoshoyDataDocRow[]>;
    findUnique(args: { where: { key: string } }): Promise<KoshoyDataDocRow | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; version: number; json: string };
      update: { version: { increment: number }; json: string };
    }): Promise<KoshoyDataDocRow>;
  };
  koshoyDataHistory: {
    create(args: {
      data: { id: string; key: string; version: number; json: string };
    }): Promise<KoshoyDataHistoryRow>;
    findMany(args: {
      where: { key: string };
      orderBy: { version: "desc" };
      take: number;
    }): Promise<KoshoyDataHistoryRow[]>;
  };
}

export interface KoshoyDataEntry<K extends KoshoyDataKey = KoshoyDataKey> {
  /** Stored version; 0 = never saved. */
  version: number;
  /** default: the code default is live (nothing saved, or the saved one no longer validates — see audit). */
  source: "db" | "default";
  value: KoshoyDataDocs[K];
}

export interface KoshoyDataHistoryEntry {
  version: number;
  createdAt: string;
  /** As saved; null if the row is not readable JSON. */
  value: unknown;
}

export type KoshoyDataPutResult = { ok: true; version: number } | { ok: false; errors: string[] };

export interface KoshoyDataStore {
  /** All six documents for a turn. Cached; never throws. Treat as read-only. */
  snapshot(): Promise<KoshoyDataDocs>;
  get<K extends KoshoyDataKey>(key: K): Promise<KoshoyDataEntry<K>>;
  /** Validates, then saves as the next version and keeps the old one in history. */
  put(key: KoshoyDataKey, value: unknown): Promise<KoshoyDataPutResult>;
  /** Saved versions, newest first. */
  history(key: KoshoyDataKey): Promise<KoshoyDataHistoryEntry[]>;
  /** Stored documents that do not validate today (their default is live instead). */
  audit(): Promise<{ key: KoshoyDataKey; errors: string[] }[]>;
}

const HISTORY_LIMIT = 50;

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** A stored row as it is live today: its value, or the default with the reasons. */
function readRow<K extends KoshoyDataKey>(
  key: K,
  row: KoshoyDataDocRow | null,
): { entry: KoshoyDataEntry<K>; errors: string[] } {
  if (!row) return { entry: { version: 0, source: "default", value: defaultDoc(key) }, errors: [] };
  const parsed = parseJson(row.json);
  const checked = parsed.ok
    ? validateKoshoyData(key, parsed.value)
    : { ok: false as const, errors: ["Kayıtlı JSON okunamıyor."] };
  if (checked.ok) return { entry: { version: row.version, source: "db", value: checked.value }, errors: [] };
  return { entry: { version: row.version, source: "default", value: defaultDoc(key) }, errors: checked.errors };
}

function defaultDocs(): KoshoyDataDocs {
  return structuredClone(KOSHOY_DATA_DEFAULTS);
}

export function createKoshoyDataStore(
  db: KoshoyDataDb,
  options: { now?: () => number; cacheMs?: number } = {},
): KoshoyDataStore {
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? 60_000;
  let cache: { at: number; docs: KoshoyDataDocs } | null = null;

  return {
    async snapshot() {
      const at = now();
      if (cache && at - cache.at < cacheMs) return cache.docs;
      let docs: KoshoyDataDocs;
      try {
        const rows = new Map((await db.koshoyDataDoc.findMany()).map((row) => [row.key, row]));
        docs = defaultDocs();
        for (const key of KOSHOY_DATA_KEYS) {
          const { entry, errors } = readRow(key, rows.get(key) ?? null);
          if (errors.length) console.warn("[koshoy] stored data no longer valid, default used", key);
          (docs as Record<KoshoyDataKey, unknown>)[key] = entry.value;
        }
      } catch (error) {
        console.warn("[koshoy] data read failed, last good data used", error);
        docs = cache?.docs ?? defaultDocs();
      }
      cache = { at, docs };
      return docs;
    },

    async get(key) {
      return readRow(key, await db.koshoyDataDoc.findUnique({ where: { key } })).entry;
    },

    async put(key, value) {
      const checked = validateKoshoyData(key, value);
      if (!checked.ok) return checked;
      const json = JSON.stringify(checked.value);
      const row = await db.koshoyDataDoc.upsert({
        where: { key },
        create: { key, version: 1, json },
        update: { version: { increment: 1 }, json },
      });
      await db.koshoyDataHistory.create({
        data: { id: randomUUID(), key, version: row.version, json },
      });
      cache = null;
      return { ok: true, version: row.version };
    },

    async history(key) {
      const rows = await db.koshoyDataHistory.findMany({
        where: { key },
        orderBy: { version: "desc" },
        take: HISTORY_LIMIT,
      });
      return rows.map((row) => {
        const parsed = parseJson(row.json);
        return {
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          value: parsed.ok ? parsed.value : null,
        };
      });
    },

    async audit() {
      const rows = await db.koshoyDataDoc.findMany();
      return rows
        .filter((row) => isKoshoyDataKey(row.key))
        .map((row) => ({ key: row.key as KoshoyDataKey, errors: readRow(row.key as KoshoyDataKey, row).errors }))
        .filter((item) => item.errors.length > 0);
    },
  };
}

let sharedStore: KoshoyDataStore | null = null;

/** The app's data store over the real database (built on first use). */
export function koshoyData(): KoshoyDataStore {
  sharedStore ??= createKoshoyDataStore(prisma as unknown as KoshoyDataDb);
  return sharedStore;
}
