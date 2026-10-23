/**
 * Koshoy LLM tools. Names and schemas stay on the server; the storefront
 * only ever sees the PublicEvents these tools produce.
 */
import {
  CABIN_COLOR_IDS,
  CABIN_DEPTHS_MM,
  CABIN_FIT_KINDS,
  CABIN_HEIGHTS_MM,
  CABIN_WIDTHS_MM,
  DESIGN_KINDS,
  EDIT_ACTIONS,
  PLAN_LEVELS,
} from "./engine";
import { KOSHOY_ROOM_SET_IDS } from "./room-sets";

export const KOSHOY_TOOL_NAMES = [
  "set_brief",
  "ask_user",
  "plan_cabinet",
  "plan_room",
  "edit_design",
  "quote",
  "switch_design",
  "show_doors",
  "show_in_room",
  "render_room",
  "place_in_room",
  "remove_from_room",
] as const;
export type KoshoyToolName = (typeof KOSHOY_TOOL_NAMES)[number];

export function isKoshoyToolName(name: string): name is KoshoyToolName {
  return (KOSHOY_TOOL_NAMES as readonly string[]).includes(name);
}

/** Offered only while the room photo feature is configured (Sugar S3 + gateway). */
export const KOSHOY_ROOM_TOOL_NAMES: readonly string[] = [
  "show_in_room",
  "render_room",
  "place_in_room",
  "remove_from_room",
];

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
      description: `Cabinet width ${CABIN_WIDTHS_MM.join("/")}, or the total width (any length)`,
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
    name: "plan_room",
    description:
      "Create the whole set for a room at once: one NEW design per product, all in the same colour, standing together (in the room photo, or in front of the studio wall without one). Without items the room's set from the system facts is used; pass items when the customer named other products or counts. Sizes and interior are the templates' defaults; details come later, product by product.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        room: { type: "string", enum: [...KOSHOY_ROOM_SET_IDS] },
        items: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...DESIGN_KINDS] },
              count: { type: "integer", minimum: 1, maximum: 4 },
            },
            required: ["kind"],
            additionalProperties: false,
          },
        },
        level: { type: "string", enum: [...PLAN_LEVELS] },
        color: { type: "string", enum: [...CABIN_COLOR_IDS] },
      },
      required: ["room"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_design",
    description:
      "Apply one change to an existing design (defaults to the active one). The server validates it; on rejection the result has a short hint: explain it simply and offer an alternative. allDesigns: true applies a colour change (set_color) to every design of the conversation.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        designId: { type: "string" },
        allDesigns: { type: "boolean", description: "Only with set_color: apply it to every design" },
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
  {
    name: "show_doors",
    description:
      "Open or close the doors of the active design in the 3D view so the customer can see inside. View only: the design, parts and price do not change.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        open: { type: "boolean" },
      },
      required: ["open"],
      additionalProperties: false,
    },
  },
  {
    name: "show_in_room",
    description:
      "Show a design (defaults to the active one) inside the customer's room photo in the 3D view; a design not yet in the room is added first. If the result says there is no room photo, ask the customer to upload one.",
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
    name: "render_room",
    description:
      "Start a realistic picture of the customer's room with every design standing in it; it appears in the chat when ready. If the result says there is no room photo, ask the customer to upload one.",
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
    name: "place_in_room",
    description:
      "Put a design (defaults to the active one) in the room, or move it there; without a room photo it stands in front of the studio wall. The server finds the nearest free spot and never overlaps cabinets. Returns its stretch of the visible wall in cm from the wall's left end (approximate) and the room's layout; error unchanged means it did not move, so never say it was placed.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        designId: { type: "string" },
        at: {
          type: "string",
          enum: ["free", "left_of", "right_of", "photo_x", "wall_cm", "floor"],
          description:
            "free: a free spot, empty stretches of wall first; left_of / right_of: next to refDesignId; photo_x: at photoX in the photo (needs a room photo; on a room without a wall also photoY, the floor point seen there); wall_cm: wallCm from the visible wall's left end; floor: free on the floor (rooms without a wall), with rotateDeg",
        },
        refDesignId: { type: "string", description: "For left_of / right_of" },
        photoX: { type: "number", description: "0 = left edge of the photo, 1 = right edge" },
        photoY: {
          type: "number",
          description: "0 = top edge of the photo, 1 = bottom edge; with photo_x on a room without a wall: put it on the floor point seen at (photoX, photoY)",
        },
        wallCm: { type: "number", description: "cm from the visible wall's left end" },
        align: {
          type: "string",
          enum: ["center", "left_edge", "right_edge"],
          description: "Which part of the cabinet goes to photoX / wallCm (default center)",
        },
        rotateDeg: {
          type: "number",
          description: "Only for cabinets on the floor (no wall): turn around the vertical axis, -180..180, 0 = facing the camera",
        },
      },
      required: ["at"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_from_room",
    description: "Take a design out of the room (the design itself stays in the conversation).",
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

/** The tool list sent to the model; without the room feature it is today's list. */
export function koshoyTools(withRoom: boolean) {
  return withRoom
    ? KOSHOY_TOOLS
    : KOSHOY_TOOLS.filter((tool) => !KOSHOY_ROOM_TOOL_NAMES.includes(tool.name));
}
