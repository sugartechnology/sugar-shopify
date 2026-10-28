/**
 * Studio colours are the shop's colours. Each colour's look (name, css) is the
 * store team's data (data API document "colors"); which colours are offered
 * comes from the shop catalog (sku-audit.server.ts `offeredShopColors`): a body
 * colour when every template part is sold in it, a handle colour when a handle
 * (Kulp) is sold in it. A new colour in the shop shows up in the studio once
 * its look is entered, with no code change.
 *
 * The current colours are kept here for the whole process (one shop) and
 * handed to the cabinet core as its palette, so a design saved with an older
 * colour (Ahşap, Kırık beyaz, Mavi) falls back to the first body colour.
 */
import { setCabinColors } from "./cabinet-core";

export interface ColorLook {
  /** As written in the shop's part titles, e.g. "LAKE BEYAZ". */
  shopColor: string;
  /** Customer-facing name, e.g. "Lake beyaz". */
  label: string;
  /** "#rrggbb" for the studio and the 3D view. */
  css: string;
  /** body: cabinet colour; handle: handle colour. */
  use: "body" | "handle";
}

export interface KoshoyColor extends ColorLook {
  /** Stable id in designs and events, e.g. "lake-beyaz". */
  id: string;
}

export interface KoshoyColors {
  /** Every colour with a look, body colours first: the palette and every name the server knows. */
  all: KoshoyColor[];
  /** Offered as cabinet colour; the first is the default. Never empty. */
  body: KoshoyColor[];
  /** Offered as handle colour; empty = no handles yet. */
  handles: KoshoyColor[];
}

export const DEFAULT_COLOR_LOOKS: ColorLook[] = [
  { shopColor: "LAKE BEYAZ", label: "Lake beyaz", css: "#f1eee7", use: "body" },
  { shopColor: "KUMTAŞI", label: "Kumtaşı", css: "#d6cab6", use: "body" },
  { shopColor: "SİYAH", label: "Siyah", css: "#2b2b2b", use: "handle" },
  { shopColor: "BEYAZ", label: "Beyaz", css: "#f5f5f3", use: "handle" },
];

const ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/** "LAKE BEYAZ" → "lake-beyaz", "KUMTAŞI" → "kumtasi". */
export function colorIdOf(shopColor: string): string {
  return shopColor
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (letter) => ASCII[letter])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Shop colours as the catalog reads them: upper case, single spaces. */
export function shopColorKey(value: string): string {
  return value.normalize("NFC").toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
}

/**
 * Colours from the looks and, once the catalog is read, what the shop sells.
 * Without a catalog every body look is offered and no handle is. When the
 * shop sells no body colour completely, every body look stays offered: the
 * missing parts then show [FİYAT] and the catalog alarm, never a wrong colour.
 */
export function toKoshoyColors(
  looks: readonly ColorLook[],
  offered?: { body: ReadonlySet<string>; handles: ReadonlySet<string> },
): KoshoyColors {
  const withId = (look: ColorLook): KoshoyColor => ({ ...look, id: colorIdOf(look.shopColor) });
  const bodyLooks = looks.filter((look) => look.use === "body").map(withId);
  const handleLooks = looks.filter((look) => look.use === "handle").map(withId);
  const sold = (set: ReadonlySet<string> | undefined, color: KoshoyColor) => !set || set.has(shopColorKey(color.shopColor));
  const body = bodyLooks.filter((color) => sold(offered?.body, color));
  return {
    all: [...bodyLooks, ...handleLooks],
    body: body.length ? body : bodyLooks,
    handles: offered ? handleLooks.filter((color) => sold(offered.handles, color)) : [],
  };
}

let current = toKoshoyColors(DEFAULT_COLOR_LOOKS);
setCabinColors(current.all.map(paletteOption));

function paletteOption(color: KoshoyColor) {
  return { id: color.id, label: color.label, css: color.css, hex: Number.parseInt(color.css.slice(1), 16) };
}

export function koshoyColors(): KoshoyColors {
  return current;
}

/** Called after every catalog read; the core palette follows. */
export function useKoshoyColors(next: KoshoyColors): void {
  current = next;
  setCabinColors(next.all.map(paletteOption));
}

export function bodyColorIds(): string[] {
  return current.body.map((color) => color.id);
}

export function handleColorIds(): string[] {
  return current.handles.map((color) => color.id);
}

/** Every colour id the server knows (stored designs, scene events). */
export function knownColorIds(): string[] {
  return current.all.map((color) => color.id);
}

export function colorLabel(id: string | undefined): string {
  const color = current.all.find((item) => item.id === id) ?? current.body[0];
  return color.label;
}

/** Shop colour of a colour id; an unknown id is the default body colour, as in the core. */
export function shopColorOf(id: string | undefined): string {
  const color = current.all.find((item) => item.id === id) ?? current.body[0];
  return color.shopColor;
}

/** The colour a customer named in free text ("kumtaşı olsun"), if any. */
export function colorIdInText(text: string, use: ColorLook["use"] = "body"): string | undefined {
  const value = ` ${text.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const offeredColors = use === "body" ? current.body : current.handles;
  const named = (color: KoshoyColor) =>
    [color.label, color.shopColor].some((name) => value.includes(` ${name.toLocaleLowerCase("tr-TR")} `));
  return offeredColors.find(named)?.id;
}

/** Handle choices for the journey; empty until the shop sells a handle. */
export function handleChoices(): { handles: Array<{ id: string; label: string }> } {
  return { handles: current.handles.map(({ id, label }) => ({ id, label })) };
}

/**
 * /session `colors` for the storefront: every colour's look (drawing, the 3D
 * palette) and the ids offered now as cabinet and handle colours.
 */
export function publicColors(): {
  all: Array<{ id: string; label: string; css: string }>;
  body: string[];
  handles: string[];
} {
  return {
    all: current.all.map(({ id, label, css }) => ({ id, label, css })),
    body: bodyColorIds(),
    handles: handleColorIds(),
  };
}
