/**
 * Room → product set: what the assistant proposes first for a room type
 * ("bütünden parçaya": room, colour, set and layout before any detail).
 *
 * Starting sample (23 Oct); the store team (Akın) corrects it. Only the
 * kinds the cabinet core can plan appear here; a new kind is added to the
 * core first. Widths are left to the core's default for the kind.
 */
import type { DesignKind } from "./engine";

export interface KoshoyRoomSetItem {
  kind: DesignKind;
  count: number;
}

export interface KoshoyRoomSet {
  id: string;
  /** Customer-facing room name (choices and the model's facts). */
  label: string;
  items: readonly KoshoyRoomSetItem[];
}

export const KOSHOY_ROOM_SETS: readonly KoshoyRoomSet[] = [
  {
    id: "yatak_odasi",
    label: "Yatak odası",
    items: [
      { kind: "gardirop", count: 1 },
      { kind: "komodin", count: 2 },
      { kind: "sifonyer", count: 1 },
    ],
  },
  {
    id: "salon",
    label: "Salon",
    items: [
      { kind: "tv_unitesi", count: 1 },
      { kind: "kitaplik", count: 1 },
    ],
  },
  {
    id: "antre",
    label: "Antre",
    items: [{ kind: "vestiyer", count: 1 }],
  },
  {
    id: "cocuk_odasi",
    label: "Çocuk odası",
    items: [
      { kind: "gardirop", count: 1 },
      { kind: "kitaplik", count: 1 },
      { kind: "komodin", count: 1 },
    ],
  },
  {
    id: "calisma_odasi",
    label: "Çalışma odası",
    items: [{ kind: "kitaplik", count: 2 }],
  },
];

export const KOSHOY_ROOM_SET_IDS = KOSHOY_ROOM_SETS.map((set) => set.id);

export function roomSet(id: string): KoshoyRoomSet | null {
  return KOSHOY_ROOM_SETS.find((set) => set.id === id) ?? null;
}

/** The kinds of a set item list, one entry per design to plan, in order. */
export function setKinds(items: readonly KoshoyRoomSetItem[]): DesignKind[] {
  return items.flatMap((item) => Array.from({ length: Math.max(0, item.count) }, () => item.kind));
}

/** For the model: room id, name and what the set holds. */
export function roomSetsForModel() {
  return KOSHOY_ROOM_SETS.map((set) => ({
    room: set.id,
    label: set.label,
    items: set.items.map((item) => ({ kind: item.kind, count: item.count })),
  }));
}
