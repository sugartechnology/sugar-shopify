/**
 * The customer journey (Akın's map, ClickUp z8qu5d7rd9): the room first —
 * what room, its structure, its style, its contents — then the room
 * approval, then every product approved one by one, then the cart with the
 * approved products only.
 *
 * Pure state and rules; the turn (turn.server.ts) and the handlers apply
 * them. The state lives in KoshoySession.state next to the brief.
 */
import { CABINET_RULES } from "./cabinet-core";
import type { CabinColorId, CabinComposition, DesignKind } from "./engine";

/** "single": the one-product buyer, planned in a room with one empty wall. */
export type JourneyKind = "room" | "single";

/** How the customer gave the room's structure (stage 4). */
export type JourneyStructure = "" | "photo" | "measure" | "skip";

export type ApprovalStatus = "approved" | "later";

/** Room-level style decisions (stage 5); each one goes to every product. */
export interface KoshoyStyle {
  /** Budget level id from the data (levels doc); decides crown and front. */
  level: string;
  panel: CabinColorId | "";
  /** Handle colour id; asked only while the shop has handle colours. */
  handle: string;
  /** Crown on the tall bodies; low bodies always have one. */
  crown: "" | "on" | "off";
  /** Front series id of the core (kapak-16, kapak-18). */
  front: string;
}

export interface KoshoyJourney {
  kind: JourneyKind;
  structure: JourneyStructure;
  /** The customer's own measurements; never said back (only product sizes are). */
  measure: { wallCm: number; ceilingCm: number | null } | null;
  style: KoshoyStyle;
  roomApprovedAt: number | null;
  /** When the first realistic picture was asked for by itself (room approval, with a room photo); once. */
  autoRenderAt: number | null;
  /** What the customer approved: products and style at that moment. */
  roomApproval: {
    designs: Array<{ id: string; label: string; version: number }>;
    style: KoshoyStyle;
  } | null;
  /**
   * Per design. An approval counts only for the version it was given on:
   * a design that changes afterwards is pending again. `sentVersion`: that
   * version already went to the cart (it is not offered again).
   */
  approvals: Record<string, { status: ApprovalStatus; version: number; sentVersion?: number }>;
  /** The stage whose card the customer saw last; a change made outside a turn (panel) is caught by it. */
  shownStage: JourneyStage | "";
}

export const EMPTY_STYLE: KoshoyStyle = { level: "", panel: "", handle: "", crown: "", front: "" };

export function emptyJourney(): KoshoyJourney {
  return {
    kind: "room",
    structure: "",
    measure: null,
    style: { ...EMPTY_STYLE },
    roomApprovedAt: null,
    autoRenderAt: null,
    roomApproval: null,
    approvals: {},
    shownStage: "",
  };
}

export type JourneyStage =
  | "room_what"
  | "room_structure"
  | "room_style"
  | "room_approval"
  | "product_approval"
  | "cart";

export type StyleDecision = "level" | "panel" | "front" | "crown" | "handle";

/** What the journey needs to know about a design. */
export interface JourneyDesign {
  id: string;
  kind: DesignKind;
  label: string;
  version: number;
  composition: CabinComposition;
}

/** Budget level as the journey reads it (data.server.ts, levels doc). */
export interface JourneyLevel {
  id: string;
  label: string;
  /** Short name for the room summary ("Bütçe: Fiyata göre"). */
  name: string;
  crown: "auto" | "ask";
  front: "auto" | "ask";
}

/** The front series a level with `front: "auto"` picks: the matte one (Aruuke). */
export const BEST_FRONT_SERIES = "kapak-18";

export function hasTallBody(designs: readonly JourneyDesign[]): boolean {
  return designs.some((design) =>
    design.composition.units.some((unit) => unit.heightMm > CABINET_RULES.crownMaxBodyHeightMm),
  );
}

/**
 * Style decisions still open, in the order they are asked. The level comes
 * first: with "auto" it settles crown and front by itself.
 */
export function missingStyle(
  journey: KoshoyJourney,
  designs: readonly JourneyDesign[],
  options: { levels: readonly JourneyLevel[]; handles: readonly string[] },
): StyleDecision[] {
  const { style } = journey;
  const level = options.levels.find((item) => item.id === style.level);
  const missing: StyleDecision[] = [];
  if (!level && options.levels.length > 1) missing.push("level");
  if (!style.panel) missing.push("panel");
  if (options.handles.length && !style.handle) missing.push("handle");
  if (!style.front && level?.front !== "auto") missing.push("front");
  if (hasTallBody(designs) && !style.crown && level?.crown !== "auto") missing.push("crown");
  return missing;
}

export function approvalOf(
  journey: KoshoyJourney,
  design: Pick<JourneyDesign, "id" | "version">,
): "pending" | ApprovalStatus {
  const approval = journey.approvals[design.id];
  return approval && approval.version === design.version ? approval.status : "pending";
}

/** The next design to decide on, in the order the set was planned. */
export function nextPendingDesign<T extends JourneyDesign>(
  journey: KoshoyJourney,
  designs: readonly T[],
): T | null {
  return designs.find((design) => approvalOf(journey, design) === "pending") ?? null;
}

export function approvedDesigns<T extends JourneyDesign>(journey: KoshoyJourney, designs: readonly T[]): T[] {
  return designs.filter((design) => approvalOf(journey, design) === "approved");
}

/** This version of the design is already in the cart. */
export function isInCart(journey: KoshoyJourney, design: Pick<JourneyDesign, "id" | "version">): boolean {
  return approvalOf(journey, design) === "approved" && journey.approvals[design.id]?.sentVersion === design.version;
}

export function laterDesigns<T extends JourneyDesign>(journey: KoshoyJourney, designs: readonly T[]): T[] {
  return designs.filter((design) => approvalOf(journey, design) === "later");
}

/**
 * Where the customer is. Each stage needs the ones before it; the questions
 * a customer already answered in a message are simply not asked again.
 */
export function journeyStage(
  journey: KoshoyJourney,
  input: {
    room: string;
    designs: readonly JourneyDesign[];
    hasRoomPhoto: boolean;
    missingStyle: readonly StyleDecision[];
  },
): JourneyStage {
  if (!input.designs.length) return "room_what";
  if (journey.kind === "room" && !input.room) return "room_what";
  if (!journey.structure && !input.hasRoomPhoto) return "room_structure";
  if (input.missingStyle.length) return "room_style";
  if (journey.roomApprovedAt === null) return "room_approval";
  if (nextPendingDesign(journey, input.designs)) return "product_approval";
  return "cart";
}

/** Drops approvals of designs that no longer exist (the store keeps the rest). */
export function pruneApprovals(journey: KoshoyJourney, designIds: readonly string[]) {
  const keep = new Set(designIds);
  for (const id of Object.keys(journey.approvals)) {
    if (!keep.has(id)) delete journey.approvals[id];
  }
}

/* ---------------- persisted state ---------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 64): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function parseStyle(raw: unknown): KoshoyStyle {
  const row = asRecord(raw);
  return {
    level: text(row.level),
    panel: text(row.panel) as CabinColorId | "",
    handle: text(row.handle),
    crown: row.crown === "on" || row.crown === "off" ? row.crown : "",
    front: text(row.front),
  };
}

/** Reads the journey from a stored session state; anything malformed starts empty. */
export function parseJourney(raw: unknown): KoshoyJourney {
  const row = asRecord(raw);
  const journey = emptyJourney();
  if (row.kind === "single") journey.kind = "single";
  if (row.structure === "photo" || row.structure === "measure" || row.structure === "skip") {
    journey.structure = row.structure;
  }
  const measure = asRecord(row.measure);
  if (typeof measure.wallCm === "number" && measure.wallCm > 0) {
    journey.measure = {
      wallCm: measure.wallCm,
      ceilingCm: typeof measure.ceilingCm === "number" && measure.ceilingCm > 0 ? measure.ceilingCm : null,
    };
  }
  journey.style = parseStyle(row.style);
  if (typeof row.roomApprovedAt === "number") journey.roomApprovedAt = row.roomApprovedAt;
  if (typeof row.autoRenderAt === "number") journey.autoRenderAt = row.autoRenderAt;
  const approval = asRecord(row.roomApproval);
  if (Array.isArray(approval.designs)) {
    journey.roomApproval = {
      designs: approval.designs.map((item) => {
        const design = asRecord(item);
        return { id: text(design.id), label: text(design.label, 160), version: Number(design.version) || 0 };
      }),
      style: parseStyle(approval.style),
    };
  }
  for (const [id, value] of Object.entries(asRecord(row.approvals))) {
    const item = asRecord(value);
    if ((item.status === "approved" || item.status === "later") && typeof item.version === "number") {
      journey.approvals[id] = {
        status: item.status,
        version: item.version,
        ...(typeof item.sentVersion === "number" ? { sentVersion: item.sentVersion } : {}),
      };
    }
  }
  const stages: readonly string[] = ["room_what", "room_structure", "room_style", "room_approval", "product_approval", "cart"];
  if (typeof row.shownStage === "string" && stages.includes(row.shownStage)) {
    journey.shownStage = row.shownStage as JourneyStage;
  }
  return journey;
}
