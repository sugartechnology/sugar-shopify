/**
 * Shape validation for everything the storefront (or the model) sends.
 * Value rules (grid sizes, door height…) belong to the engine.
 */
import {
  CABIN_COLOR_IDS,
  CABIN_FIT_KINDS,
  type CabinColorId,
  type CabinFitKind,
  type EditOp,
} from "./engine";

export type ClientInput =
  | { type: "message"; text: string }
  | { type: "choice"; selected: string; label?: string }
  | { type: "add_cart_result"; ok: boolean; error?: string };

const MAX_MESSAGE = 2000;
const MAX_CHOICE_ID = 64;
const MAX_CHOICE_LABEL = 200;
const MAX_CART_ERROR = 64;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function parseClientInput(body: unknown): ClientInput | null {
  const row = asRecord(body);
  if (row.type === "message") {
    if (typeof row.text !== "string") return null;
    const text = row.text.trim();
    if (!text || text.length > MAX_MESSAGE) return null;
    return { type: "message", text };
  }
  if (row.type === "choice") {
    const selected = typeof row.selected === "string" ? row.selected.trim() : "";
    if (!selected || selected.length > MAX_CHOICE_ID) return null;
    const label =
      typeof row.label === "string" ? row.label.trim().slice(0, MAX_CHOICE_LABEL) : "";
    return label ? { type: "choice", selected, label } : { type: "choice", selected };
  }
  if (row.type === "add_cart_result") {
    if (typeof row.ok !== "boolean") return null;
    const error =
      typeof row.error === "string"
        ? row.error.replace(/[^\w.-]/g, "").slice(0, MAX_CART_ERROR)
        : "";
    return error
      ? { type: "add_cart_result", ok: row.ok, error }
      : { type: "add_cart_result", ok: row.ok };
  }
  return null;
}

function int(value: unknown, min = 0, max = 10_000): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Accepts an EditOp object (or its JSON text, as models sometimes send). */
export function parseEditOp(raw: unknown): EditOp | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const row = asRecord(value);
  const unit = int(row.unit, 0, 64);
  switch (row.action) {
    case "add_fitting": {
      const kind = oneOf<CabinFitKind>(row.kind, CABIN_FIT_KINDS);
      return unit !== null && kind ? { action: "add_fitting", unit, kind } : null;
    }
    case "remove_fitting": {
      const index = int(row.index, 0, 64);
      return unit !== null && index !== null
        ? { action: "remove_fitting", unit, index }
        : null;
    }
    case "set_unit_width": {
      const widthMm = int(row.widthMm, 1);
      return unit !== null && widthMm !== null
        ? { action: "set_unit_width", unit, widthMm }
        : null;
    }
    case "set_unit_height": {
      const heightMm = int(row.heightMm, 1);
      return unit !== null && heightMm !== null
        ? { action: "set_unit_height", unit, heightMm }
        : null;
    }
    case "set_total_width": {
      const widthMm = int(row.widthMm, 1);
      return widthMm !== null ? { action: "set_total_width", widthMm } : null;
    }
    case "set_depth": {
      const depthMm = int(row.depthMm, 1);
      return depthMm !== null ? { action: "set_depth", depthMm } : null;
    }
    case "set_door":
      return unit !== null && typeof row.hasDoor === "boolean"
        ? { action: "set_door", unit, hasDoor: row.hasDoor }
        : null;
    case "set_color": {
      const target = oneOf(row.target, ["all", "unit", "door"] as const);
      const color = oneOf<CabinColorId>(row.color, CABIN_COLOR_IDS);
      if (!target || !color) return null;
      if (target === "unit" && unit === null) return null;
      if (row.unit !== undefined && row.unit !== null && unit === null) return null;
      return unit !== null
        ? { action: "set_color", target, unit, color }
        : { action: "set_color", target, color };
    }
    default:
      return null;
  }
}

export function parseDesignRef(body: unknown): { designId: string; version: number } | null {
  const row = asRecord(body);
  const designId = typeof row.designId === "string" ? row.designId.trim() : "";
  const version = int(row.version, 1, 1_000_000);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(designId) || version === null) return null;
  return { designId, version };
}

/** Cart snapshot of the 3D view: JPEG data URL, at most ~1.5 MB decoded. */
const MAX_IMAGE_BYTES = 1_500_000;
const JPEG_PREFIX = "data:image/jpeg;base64,";

export function parseDesignImage(body: unknown): Uint8Array | null {
  const value = asRecord(body).image;
  if (typeof value !== "string" || !value.startsWith(JPEG_PREFIX)) return null;
  const base64 = value.slice(JPEG_PREFIX.length);
  if (base64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return null;
  }
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  // JPEG magic number; anything else is dropped, never stored.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes.length <= MAX_IMAGE_BYTES ? bytes : null;
}
