/**
 * PublicEvent whitelist (CONTRACT §4). Every event that reaches the
 * storefront is rebuilt field by field here; anything else is dropped.
 */
import {
  CABIN_FIT_KINDS,
  CABIN_WIDTHS_MM,
  DESIGN_KINDS,
  KOSHOY_MAX_FITTINGS_PER_UNIT,
  type CabinColorId,
  type CabinFitKind,
  type DesignKind,
} from "./engine";
import { findFrontSeries } from "./cabinet-core";
import { MAX_CLEAN_TEXT, MAX_PHOTO_ITEMS } from "./photo-items";
import { MAX_LAYOUT_ITEMS } from "./room-layout";
import { knownColorIds } from "./shop-colors";

export const KOSHOY_ERROR_CODES = [
  "unavailable",
  "rate_limited",
  "session_expired",
  "invalid_input",
  "edit_rejected",
  "out_of_scope",
  "cart_failed",
  /** /room-clean only (CONTRACT §2.9): this photo had its 5 distinct item removals */
  "clean_limit",
] as const;
export type KoshoyErrorCode = (typeof KOSHOY_ERROR_CODES)[number];

export const KOSHOY_STATUS_KEYS = [
  "thinking",
  "placing",
  "pricing",
  "preparing",
] as const;
export type KoshoyStatusKey = (typeof KOSHOY_STATUS_KEYS)[number];

export const PRICE_PLACEHOLDER = "[FİYAT]";

export interface SceneFitting {
  id: string;
  kind: CabinFitKind;
  color?: CabinColorId;
}

export interface SceneUnit {
  id: string;
  widthMm: number;
  heightMm: number;
  fittings: SceneFitting[];
  hasDoor: boolean;
  color?: CabinColorId;
  doorColor?: CabinColorId;
  /** Only written when on. */
  hasCrown?: true;
}

/** CabinComposition without open/doorOpen flags and widestUnits. */
export interface SceneView {
  units: SceneUnit[];
  depthMm: number;
  hasPlinth: boolean;
  color?: CabinColorId;
  /** Front series id of the core table (no shop names); missing = default. */
  frontSeries?: string;
  /** Handle colour id; missing = no handles. */
  handleColor?: CabinColorId;
}

export interface DesignSummary {
  designId: string;
  label: string;
  kind: DesignKind;
  active: boolean;
}

export interface ChoiceOption {
  id: string;
  label: string;
  /** Style info note: a small realistic picture of this option (prepared set, data images doc). */
  image?: string;
  /** Style info note: the whole room's price with this option. */
  price?: string;
}

/** One line of the room summary or the cart summary. */
export interface JourneyItemView {
  designId: string;
  label: string;
}

export interface CartItemView extends JourneyItemView {
  version: number;
  display: string;
}

export type ProductStatusView = "pending" | "approved" | "later";

/** Where a design stands (CONTRACT v2 §6, room-layout LayoutPlace). Metres. */
export type LayoutPlaceView =
  | { surface: "wall"; alongM: number }
  | { surface: "floor"; xM: number; forwardM: number; rotDeg: number };

export interface LayoutItemView {
  designId: string;
  /** null = no free spot: the storefront shows it as a preview */
  place: LayoutPlaceView | null;
}

/**
 * Where the layout stands (CONTRACT v2.1-2): along a wall (the room's
 * visible wall, or the studio's virtual wall) or free on the floor.
 */
export interface LayoutTargetView {
  surface: "wall" | "floor";
  wall?: { fromM: number; toM: number };
}

/** Designs that may stand in one layout (room or studio). */
export const KOSHOY_MAX_LAYOUT_ITEMS = MAX_LAYOUT_ITEMS;

export type PublicEvent =
  | { type: "status"; key: KoshoyStatusKey }
  | { type: "text"; text: string }
  | {
      type: "scene";
      designId: string;
      version: number;
      kind: DesignKind;
      label: string;
      view: SceneView;
      /** Unit widths this kind allows (panel width steppers). */
      unitWidthsMm?: number[];
    }
  | { type: "price"; designId: string; version: number; display: string }
  /** The whole set: sum of every design's price (2+ designs); [FİYAT] while one is not priced. */
  | { type: "total"; count: number; display: string }
  | { type: "designs"; items: DesignSummary[] }
  | { type: "choice"; question?: string; options: ChoiceOption[] }
  /** show_in_room: the storefront puts that design into the room photo. */
  | { type: "room_show"; designId: string }
  /** render_room: the storefront captures the 3D view and calls POST /render. */
  | { type: "render_request"; designId: string }
  | { type: "layout"; version: number; items: LayoutItemView[]; target?: LayoutTargetView }
  /** View only: open or close the doors in the 3D view. */
  | { type: "doors"; open: boolean }
  /** /session only: the room photo the customer added, at its place in the thread (GET /room-file). */
  | { type: "photo"; roomId: string }
  /** /session only: a finished realistic picture, at its place in the thread (GET /render-file). */
  | { type: "render"; renderId: string }
  /** offer_photo_cleanup: the storefront opens the item removal card, these items ticked, the text in its field (CONTRACT §2.9). */
  | { type: "photo_items"; preselect: string[]; text?: string }
  /** Stage 4: photo / own measurements / go on without; `photo` false when the room feature is off. */
  | { type: "structure"; photo: boolean }
  /** Stage 6: what the customer approves (products, style, total). `single`: the one-product buyer. */
  | {
      type: "room_summary";
      items: JourneyItemView[];
      style: Array<{ label: string; value: string }>;
      total: string;
      approved: boolean;
      single: boolean;
    }
  /** Stage 7: the product being decided on, with the progress of the room. */
  | {
      type: "product_card";
      designId: string;
      label: string;
      status: ProductStatusView;
      /** 1-based place among the room's products, and how many there are. */
      index: number;
      count: number;
      approvedCount: number;
      /** Other undecided products of the same kind ("2 komodin"): one approval may take them all. */
      sameKind: number;
      notes: string[];
    }
  /** Stage 8: approved products go to the cart, "later" ones are reminded. */
  | {
      type: "cart_summary";
      approved: CartItemView[];
      later: JourneyItemView[];
      /** Already sent to the cart (this version); not offered again. */
      inCart: JourneyItemView[];
      total: string;
      warning: string;
    }
  /** "Odanı kaydedelim": the room approval needs a signed-in customer. */
  | { type: "login_required" }
  | { type: "error"; code: KoshoyErrorCode }
  | { type: "done" };

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Info note pictures come from the shop's own image CDN only (data images doc). */
const IMAGE_URL = /^https:\/\/image-s3\.sm\.mncdn\.com\/[A-Za-z0-9._~%\/-]{1,400}$/;
const MAX_JOURNEY_ITEMS = 12;
const PRICE_DISPLAY = /^\d{1,3}(?:\.\d{3})*,\d{2} TL$/;
const MAX_TEXT = 8000;
const MAX_LABEL = 160;
const MAX_UNITS = 16;
/** Same cap the engine enforces on edits: a unit is never cut short. */
const MAX_FITTINGS = KOSHOY_MAX_FITTINGS_PER_UNIT;
const MAX_OPTIONS = 6;
const MAX_DESIGNS = 24;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function opaqueId(value: unknown): string | null {
  return typeof value === "string" && OPAQUE_ID.test(value) ? value : null;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LABEL) return null;
  return trimmed;
}

function positiveMm(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10000
    ? Math.round(value)
    : null;
}

function version(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

export function isKoshoyErrorCode(value: unknown): value is KoshoyErrorCode {
  return oneOf(value, KOSHOY_ERROR_CODES) !== undefined;
}

export function isValidPriceDisplay(value: unknown): value is string {
  return value === PRICE_PLACEHOLDER || (typeof value === "string" && PRICE_DISPLAY.test(value));
}

function toSceneFitting(raw: unknown): SceneFitting | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = opaqueId(row.id);
  const kind = oneOf(row.kind, CABIN_FIT_KINDS);
  if (!id || !kind) return null;
  const color = oneOf(row.color, knownColorIds());
  return color ? { id, kind, color } : { id, kind };
}

function toSceneUnit(raw: unknown): SceneUnit | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = opaqueId(row.id);
  const widthMm = positiveMm(row.widthMm);
  const heightMm = positiveMm(row.heightMm);
  if (!id || !widthMm || !heightMm || !Array.isArray(row.fittings)) return null;
  // Dropping fittings would draw less than the BOM bills: no scene instead.
  if (row.fittings.length > MAX_FITTINGS) return null;
  const fittings: SceneFitting[] = [];
  for (const item of row.fittings) {
    const fitting = toSceneFitting(item);
    if (!fitting) return null;
    fittings.push(fitting);
  }
  const unit: SceneUnit = {
    id,
    widthMm,
    heightMm,
    fittings,
    hasDoor: row.hasDoor === true,
  };
  const color = oneOf(row.color, knownColorIds());
  const doorColor = oneOf(row.doorColor, knownColorIds());
  if (color) unit.color = color;
  if (doorColor) unit.doorColor = doorColor;
  if (row.hasCrown === true) unit.hasCrown = true;
  return unit;
}

/** Accepts a CabinComposition (or anything) and returns the public view. */
export function toSceneView(raw: unknown): SceneView | null {
  const row = asRecord(raw);
  if (!row || !Array.isArray(row.units) || !row.units.length) return null;
  if (row.units.length > MAX_UNITS) return null;
  const units: SceneUnit[] = [];
  for (const item of row.units) {
    const unit = toSceneUnit(item);
    if (!unit) return null;
    units.push(unit);
  }
  const depthMm = positiveMm(row.depthMm);
  if (!depthMm) return null;
  const view: SceneView = { units, depthMm, hasPlinth: row.hasPlinth !== false };
  const color = oneOf(row.color, knownColorIds());
  if (color) view.color = color;
  const series = findFrontSeries(row.frontSeries);
  if (series) view.frontSeries = series.id;
  const handleColor = oneOf(row.handleColor, knownColorIds());
  if (handleColor) view.handleColor = handleColor;
  return view;
}

/** Metres along a wall or across the floor: a room is never 50 m away. */
function metres(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 50 ? value : null;
}

/** null for anything that is not one of the two place shapes. */
export function toLayoutPlace(raw: unknown): LayoutPlaceView | null {
  const row = asRecord(raw);
  if (row?.surface === "wall") {
    const alongM = metres(row.alongM);
    return alongM === null ? null : { surface: "wall", alongM };
  }
  if (row?.surface === "floor") {
    const xM = metres(row.xM);
    const forwardM = metres(row.forwardM);
    const rotDeg = row.rotDeg;
    if (xM === null || forwardM === null) return null;
    if (typeof rotDeg !== "number" || !Number.isFinite(rotDeg) || Math.abs(rotDeg) > 180) return null;
    return { surface: "floor", xM, forwardM, rotDeg };
  }
  return null;
}

/** A layout item; a place that is set but malformed drops the item. */
export function toLayoutItem(raw: unknown): LayoutItemView | null {
  const row = asRecord(raw);
  const designId = opaqueId(row?.designId);
  if (!row || !designId) return null;
  if (row.place === null) return { designId, place: null };
  const place = toLayoutPlace(row.place);
  return place ? { designId, place } : null;
}

export function toLayoutTarget(raw: unknown): LayoutTargetView | null {
  const row = asRecord(raw);
  if (row?.surface === "floor") return { surface: "floor" };
  if (row?.surface !== "wall") return null;
  const wall = asRecord(row.wall);
  if (!wall) return { surface: "wall" };
  const fromM = metres(wall.fromM);
  const toM = metres(wall.toM);
  return fromM !== null && toM !== null && toM > fromM ? { surface: "wall", wall: { fromM, toM } } : null;
}

export function toDesignSummary(raw: unknown): DesignSummary | null {
  const row = asRecord(raw);
  if (!row) return null;
  const designId = opaqueId(row.designId);
  const name = label(row.label);
  const kind = oneOf(row.kind, DESIGN_KINDS);
  if (!designId || !name || !kind) return null;
  return { designId, label: name, kind, active: row.active === true };
}

function toChoiceOption(raw: unknown): ChoiceOption | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = opaqueId(row.id);
  const name = label(row.label);
  if (!id || !name) return null;
  const option: ChoiceOption = { id, label: name };
  if (typeof row.image === "string" && IMAGE_URL.test(row.image)) option.image = row.image;
  if (isValidPriceDisplay(row.price)) option.price = row.price;
  return option;
}

function toJourneyItem(raw: unknown): JourneyItemView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const designId = opaqueId(row.designId);
  const name = label(row.label);
  return designId && name ? { designId, label: name } : null;
}

function toCartItem(raw: unknown): CartItemView | null {
  const item = toJourneyItem(raw);
  const row = asRecord(raw);
  const v = version(row?.version);
  if (!item || v === null || !isValidPriceDisplay(row?.display)) return null;
  return { ...item, version: v, display: row!.display as string };
}

function list<T>(raw: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_JOURNEY_ITEMS) return null;
  const items = raw.map(read);
  return items.some((item) => item === null) ? null : (items as T[]);
}

function count(value: unknown, max = MAX_DESIGNS): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Whitelist serializer. Returns a freshly built event or null; unknown
 * error codes collapse to "unavailable" so upstream codes never leak.
 */
export function toPublicEvent(raw: unknown): PublicEvent | null {
  const row = asRecord(raw);
  if (!row) return null;
  switch (row.type) {
    case "status": {
      const key = oneOf(row.key, KOSHOY_STATUS_KEYS);
      return key ? { type: "status", key } : null;
    }
    case "text": {
      if (typeof row.text !== "string" || !row.text) return null;
      return { type: "text", text: row.text.slice(0, MAX_TEXT) };
    }
    case "scene": {
      const designId = opaqueId(row.designId);
      const v = version(row.version);
      const kind = oneOf(row.kind, DESIGN_KINDS);
      const name = label(row.label);
      const view = toSceneView(row.view);
      if (!designId || !v || !kind || !name || !view) return null;
      const widths = Array.isArray(row.unitWidthsMm)
        ? row.unitWidthsMm.filter((value): value is number =>
            (CABIN_WIDTHS_MM as readonly unknown[]).includes(value),
          )
        : [];
      return widths.length
        ? { type: "scene", designId, version: v, kind, label: name, view, unitWidthsMm: widths }
        : { type: "scene", designId, version: v, kind, label: name, view };
    }
    case "price": {
      const designId = opaqueId(row.designId);
      const v = version(row.version);
      if (!designId || !v || !isValidPriceDisplay(row.display)) return null;
      return { type: "price", designId, version: v, display: row.display };
    }
    case "designs": {
      if (!Array.isArray(row.items)) return null;
      const items = row.items
        .slice(0, MAX_DESIGNS)
        .map(toDesignSummary)
        .filter((item): item is DesignSummary => item !== null);
      return { type: "designs", items };
    }
    case "choice": {
      if (!Array.isArray(row.options)) return null;
      const options = row.options
        .slice(0, MAX_OPTIONS)
        .map(toChoiceOption)
        .filter((item): item is ChoiceOption => item !== null);
      if (!options.length) return null;
      const question =
        typeof row.question === "string" && row.question.trim()
          ? row.question.trim().slice(0, 300)
          : undefined;
      return question
        ? { type: "choice", question, options }
        : { type: "choice", options };
    }
    case "layout": {
      const v = typeof row.version === "number" && Number.isInteger(row.version) && row.version >= 0
        ? row.version
        : null;
      if (v === null || !Array.isArray(row.items) || row.items.length > KOSHOY_MAX_LAYOUT_ITEMS) {
        return null;
      }
      const items = row.items.map(toLayoutItem);
      // The 3D view must never draw less than the layout holds.
      if (items.some((item) => item === null)) return null;
      const event: PublicEvent = { type: "layout", version: v, items: items as LayoutItemView[] };
      if (row.target === undefined) return event;
      const target = toLayoutTarget(row.target);
      return target ? { ...event, target } : null;
    }
    case "room_show":
    case "render_request": {
      const designId = opaqueId(row.designId);
      return designId ? { type: row.type, designId } : null;
    }
    case "doors":
      return typeof row.open === "boolean" ? { type: "doors", open: row.open } : null;
    case "total": {
      const count = typeof row.count === "number" && Number.isInteger(row.count) ? row.count : 0;
      return count >= 2 && count <= MAX_DESIGNS && isValidPriceDisplay(row.display)
        ? { type: "total", count, display: row.display }
        : null;
    }
    case "photo": {
      const roomId = opaqueId(row.roomId);
      return roomId ? { type: "photo", roomId } : null;
    }
    case "render": {
      const renderId = opaqueId(row.renderId);
      return renderId ? { type: "render", renderId } : null;
    }
    case "photo_items": {
      const ids = Array.isArray(row.preselect) ? row.preselect.map(opaqueId) : [];
      const preselect = [...new Set(ids.filter((id): id is string => id !== null))].slice(0, MAX_PHOTO_ITEMS);
      const text = shortText(row.text, MAX_CLEAN_TEXT);
      return text ? { type: "photo_items", preselect, text } : { type: "photo_items", preselect };
    }
    case "structure":
      return { type: "structure", photo: row.photo === true };
    case "room_summary": {
      const items = list(row.items, toJourneyItem);
      const style = list(row.style, (raw) => {
        const pair = asRecord(raw);
        const name = shortText(pair?.label, 60);
        const value = shortText(pair?.value, 80);
        return name && value ? { label: name, value } : null;
      });
      if (!items?.length || !style || !isValidPriceDisplay(row.total)) return null;
      return {
        type: "room_summary",
        items,
        style,
        total: row.total,
        approved: row.approved === true,
        single: row.single === true,
      };
    }
    case "product_card": {
      const designId = opaqueId(row.designId);
      const name = label(row.label);
      const status = oneOf(row.status, ["pending", "approved", "later"] as const);
      const index = count(row.index);
      const total = count(row.count);
      const approvedCount = count(row.approvedCount);
      const sameKind = count(row.sameKind);
      const notes = list(row.notes ?? [], (raw) => shortText(raw, 120));
      if (!designId || !name || !status || !index || !total || index > total) return null;
      if (approvedCount === null || sameKind === null || !notes) return null;
      return {
        type: "product_card",
        designId,
        label: name,
        status,
        index,
        count: total,
        approvedCount,
        sameKind,
        notes,
      };
    }
    case "cart_summary": {
      const approved = list(row.approved, toCartItem);
      const later = list(row.later, toJourneyItem);
      const inCart = list(row.inCart ?? [], toJourneyItem);
      const warning = shortText(row.warning, 300);
      if (!approved || !later || !inCart || !warning || !isValidPriceDisplay(row.total)) return null;
      return { type: "cart_summary", approved, later, inCart, total: row.total, warning };
    }
    case "login_required":
      return { type: "login_required" };
    case "error":
      return {
        type: "error",
        code: isKoshoyErrorCode(row.code) ? row.code : "unavailable",
      };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

export function publicEvents(raw: readonly unknown[]): PublicEvent[] {
  const out: PublicEvent[] = [];
  for (const item of raw) {
    const event = toPublicEvent(item);
    if (event) out.push(event);
  }
  return out;
}

export function errorEvent(code: KoshoyErrorCode): PublicEvent {
  return { type: "error", code };
}

/** One SSE frame. Only call with an already serialized PublicEvent. */
export function sseFrame(event: PublicEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
