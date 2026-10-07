/**
 * Koshoy LLM tools. Names and schemas stay on the server; the storefront
 * only ever sees the PublicEvents these tools produce.
 */
import {
  CABIN_COLOR_IDS,
  CABIN_DEPTHS_MM,
  CABIN_FIT_KINDS,
  CABIN_HEIGHTS_MM,
  CABIN_TOTAL_WIDTH_MAX_MM,
  CABIN_WIDTHS_MM,
  DESIGN_KINDS,
  EDIT_ACTIONS,
  PLAN_LEVELS,
} from "./engine";

export const KOSHOY_TOOL_NAMES = [
  "set_brief",
  "ask_user",
  "plan_cabinet",
  "edit_design",
  "quote",
  "switch_design",
] as const;
export type KoshoyToolName = (typeof KOSHOY_TOOL_NAMES)[number];

export function isKoshoyToolName(name: string): name is KoshoyToolName {
  return (KOSHOY_TOOL_NAMES as readonly string[]).includes(name);
}

const EDIT_OP_SCHEMA = {
  type: "object",
  description:
    "One panel intent. unit = 0-based cabinet index from the left. Sizes are millimetres and snap to the nearest catalog value.",
  properties: {
    action: { type: "string", enum: [...EDIT_ACTIONS] },
    unit: { type: "integer", description: "0-based cabinet index, left to right" },
    kind: { type: "string", enum: [...CABIN_FIT_KINDS] },
    index: { type: "integer", description: "0-based fitting index inside the cabinet, bottom to top" },
    widthMm: {
      type: "integer",
      description: `Cabinet width ${CABIN_WIDTHS_MM.join("/")}, or total width up to ${CABIN_TOTAL_WIDTH_MAX_MM}`,
    },
    heightMm: { type: "integer", description: `Cabinet height ${CABIN_HEIGHTS_MM.join("/")}` },
    depthMm: { type: "integer", description: CABIN_DEPTHS_MM.join(", ") },
    hasDoor: { type: "boolean" },
    target: { type: "string", enum: ["all", "unit", "door"] },
    color: { type: "string", enum: [...CABIN_COLOR_IDS] },
  },
  required: ["action"],
  additionalProperties: false,
};

export const KOSHOY_TOOLS = [
  {
    name: "set_brief",
    description:
      "Store what the customer told you: room type, style, budget level, colour, free notes. Never store room measurements.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room type, e.g. yatak odası, salon, antre" },
        style: { type: "string" },
        level: { type: "string", enum: [...PLAN_LEVELS] },
        color: { type: "string", enum: [...CABIN_COLOR_IDS] },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description:
      "Show 2–4 clickable choices and wait for the customer. Use instead of open yes/no questions.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
            },
            required: ["id", "label"],
          },
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
  },
  {
    name: "plan_cabinet",
    description:
      "Create a NEW design for one product. The server picks sizes and interior from templates and snaps to the catalog; never invent sizes. Returns the design summary, snapping notes and the price text.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...DESIGN_KINDS] },
        targetWidthCm: { type: "number", description: "Wanted total width in cm, if the customer gave one" },
        level: { type: "string", enum: [...PLAN_LEVELS] },
        color: { type: "string", enum: [...CABIN_COLOR_IDS] },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_design",
    description:
      "Apply one change to an existing design (defaults to the active one). The server validates it; on rejection the result has a short hint: explain it simply and offer an alternative.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        designId: { type: "string" },
        op: EDIT_OP_SCHEMA,
      },
      required: ["op"],
      additionalProperties: false,
    },
  },
  {
    name: "quote",
    description:
      "Price a design (defaults to the active one) from the shop. Repeat the returned price text exactly; if it is [FİYAT], say the price is not available yet.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        designId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "switch_design",
    description: "Make another design of this conversation the active one.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        designId: { type: "string" },
      },
      required: ["designId"],
      additionalProperties: false,
    },
  },
];
