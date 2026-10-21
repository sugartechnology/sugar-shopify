/**
 * PublicEvent whitelist (CONTRACT §4). Every event that reaches the
 * storefront is rebuilt field by field here; anything else is dropped.
 */
import {
  CABIN_COLOR_IDS,
  CABIN_FIT_KINDS,
  DESIGN_KINDS,
  KOSHOY_MAX_FITTINGS_PER_UNIT,
  type CabinColorId,
  type CabinFitKind,
  type DesignKind,
} from "./engine";

export const KOSHOY_ERROR_CODES = [
  "unavailable",
  "rate_limited",
  "session_expired",
  "invalid_input",
  "edit_rejected",
  "out_of_scope",
  "cart_failed",
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
}

/** CabinComposition without open/doorOpen flags and widestUnits. */
export interface SceneView {
  units: SceneUnit[];
  depthMm: number;
  hasPlinth: boolean;
  color?: CabinColorId;
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
}

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
    }
  | { type: "price"; designId: string; version: number; display: string }
  | { type: "designs"; items: DesignSummary[] }
  | { type: "choice"; question?: string; options: ChoiceOption[] }
  | { type: "error"; code: KoshoyErrorCode }
  | { type: "done" };

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
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
  const color = oneOf(row.color, CABIN_COLOR_IDS);
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
  const color = oneOf(row.color, CABIN_COLOR_IDS);
  const doorColor = oneOf(row.doorColor, CABIN_COLOR_IDS);
  if (color) unit.color = color;
  if (doorColor) unit.doorColor = doorColor;
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
  const color = oneOf(row.color, CABIN_COLOR_IDS);
  if (color) view.color = color;
  return view;
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
  return id && name ? { id, label: name } : null;
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
      return { type: "scene", designId, version: v, kind, label: name, view };
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
