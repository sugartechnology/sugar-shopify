/**
 * QR phone link (CONTRACT §2.x, /phone-link, /phone-link-status,
 * /phone-check, /phone-photo).
 *
 * The desktop studio asks for a link and shows it as a QR code. The phone
 * opens the studio page with the link token in the URL fragment (never sent
 * to a server), asks for consent, and sends one room photo. The photo goes
 * into the desktop session's normal room flow (room.server.ts startRoom);
 * the desktop learns about it by polling /phone-link-status.
 *
 * The link token is like the session token (32 random bytes, base64url) but
 * opens nothing else: it only lets one photo in, for 5 minutes. Only its
 * sha256 is stored. The phone never gets the session token.
 */
import qrcode from "qrcode-generator";
import type { RoomPhotoRequest } from "./input";
import type { KoshoyRateLimiter } from "./rate-limit.server";
import { startRoom, type KoshoyRoomDeps } from "./room.server";
import type { KoshoySessionState } from "./store.server";
import { hashKoshoyToken, isWellFormedKoshoyToken, issueKoshoyToken, randomOpaqueId } from "./token.server";

/** Fatih, 23 Oct: a link is good for 5 minutes. */
export const KOSHOY_PHONE_LINK_TTL_MS = 5 * 60 * 1000;
/** A photo the phone started sending just before expiry still gets this long to arrive. */
export const KOSHOY_PHONE_SEND_GRACE_MS = 2 * 60 * 1000;
/** Links older than this are deleted when a new one is made. */
const PRUNE_AFTER_MS = 60 * 60 * 1000;

/** The URL fragment key the theme reads on the phone. */
export const KOSHOY_PHONE_FRAGMENT = "telefon";

export interface KoshoyPhoneLinkRow {
  id: string;
  sessionId: string;
  shop: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  roomId: string | null;
  createdAt: Date;
}

/** The slice of the Prisma client the phone link uses. */
export interface KoshoyPhoneLinkDb {
  koshoyPhoneLink: {
    create(args: { data: Omit<KoshoyPhoneLinkRow, "createdAt"> }): Promise<KoshoyPhoneLinkRow>;
    findUnique(args: { where: { tokenHash: string } }): Promise<KoshoyPhoneLinkRow | null>;
    findFirst(args: { where: { id: string; sessionId: string } }): Promise<KoshoyPhoneLinkRow | null>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<KoshoyPhoneLinkRow, "usedAt" | "roomId">>;
    }): Promise<KoshoyPhoneLinkRow>;
    /** Claims the link: only an unused, unexpired one is updated. */
    updateMany(args: {
      where: { id: string; usedAt: null; expiresAt: { gt: Date } };
      data: { usedAt: Date };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where:
        | { sessionId: string; roomId: null }
        | { expiresAt: { lt: Date } };
    }): Promise<{ count: number }>;
  };
}

export interface KoshoyPhoneDeps {
  db: KoshoyPhoneLinkDb;
  /** The shop's storefront address, e.g. "https://koshoy.com" (no trailing slash). */
  storefrontOrigin(): Promise<string>;
  limits: {
    /** new links, keyed by session id */
    create: KoshoyRateLimiter;
    /** phone page opens, keyed by koshoyClientKey */
    check: KoshoyRateLimiter;
  };
  now?: () => number;
}

/* ---------------- public views ---------------- */

export interface PhoneLinkView {
  id: string;
  /** The address in the QR code (contains the link token). */
  url: string;
  /** The QR code as an SVG data URL, for an <img>. */
  qr: string;
  expiresInMs: number;
}

/**
 * waiting: nothing yet · sending: the phone is uploading · sent: the photo
 * is a room (roomId, then /room-status as usual) · expired: make a new link.
 */
export type PhoneLinkStatus = "waiting" | "sending" | "sent" | "expired";

export interface PhoneLinkStatusView {
  status: PhoneLinkStatus;
  roomId?: string;
}

/** Storefront path the studio is on: the home page or lowercase segments, e.g. /, /en, /pages/tasarla. */
const PAGE_PATH = /^\/$|^(?:\/[a-z0-9-]{1,40}){1,4}$/;

export function parsePagePath(value: unknown): string | null {
  return typeof value === "string" && PAGE_PATH.test(value) ? value : null;
}

export function qrDataUrl(text: string): string {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const svg = code.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** A new link for the session; the session's other unused links stop working. */
export async function createPhoneLink(
  deps: KoshoyPhoneDeps,
  session: KoshoySessionState,
  pagePath: string,
): Promise<PhoneLinkView> {
  const now = (deps.now ?? Date.now)();
  const links = deps.db.koshoyPhoneLink;
  await links.deleteMany({ where: { expiresAt: { lt: new Date(now - PRUNE_AFTER_MS) } } });
  await links.deleteMany({ where: { sessionId: session.id, roomId: null } });

  const { token, hash } = issueKoshoyToken();
  const row = await links.create({
    data: {
      id: randomOpaqueId(),
      sessionId: session.id,
      shop: session.shop,
      tokenHash: hash,
      expiresAt: new Date(now + KOSHOY_PHONE_LINK_TTL_MS),
      usedAt: null,
      roomId: null,
    },
  });
  const url = `${await deps.storefrontOrigin()}${pagePath}#${KOSHOY_PHONE_FRAGMENT}=${token}`;
  return { id: row.id, url, qr: qrDataUrl(url), expiresInMs: KOSHOY_PHONE_LINK_TTL_MS };
}

export function phoneLinkStatus(row: KoshoyPhoneLinkRow, now: number): PhoneLinkStatusView {
  if (row.roomId) return { status: "sent", roomId: row.roomId };
  if (row.usedAt) {
    return now < row.usedAt.getTime() + KOSHOY_PHONE_SEND_GRACE_MS
      ? { status: "sending" }
      : { status: "expired" };
  }
  return now < row.expiresAt.getTime() ? { status: "waiting" } : { status: "expired" };
}

/** The link the phone presents, while it can still take a photo; null otherwise. */
export async function openPhoneLink(
  deps: KoshoyPhoneDeps,
  shop: string,
  token: unknown,
): Promise<KoshoyPhoneLinkRow | null> {
  if (typeof token !== "string" || !isWellFormedKoshoyToken(token)) return null;
  const row = await deps.db.koshoyPhoneLink.findUnique({ where: { tokenHash: hashKoshoyToken(token) } });
  if (!row || row.shop !== shop || row.usedAt) return null;
  return row.expiresAt.getTime() > (deps.now ?? Date.now)() ? row : null;
}

/**
 * Takes the phone's photo into the link's session. The link is claimed
 * first, so two sends cannot both get in; if starting the room fails the
 * claim is given back and the phone can try again.
 */
export async function sendPhonePhoto(
  phone: KoshoyPhoneDeps,
  room: KoshoyRoomDeps,
  link: KoshoyPhoneLinkRow,
  input: RoomPhotoRequest,
): Promise<boolean> {
  const now = (phone.now ?? Date.now)();
  const links = phone.db.koshoyPhoneLink;
  const claimed = await links.updateMany({
    where: { id: link.id, usedAt: null, expiresAt: { gt: new Date(now) } },
    data: { usedAt: new Date(now) },
  });
  if (claimed.count !== 1) return false;
  try {
    const row = await startRoom(room, { id: link.sessionId, shop: link.shop }, input);
    await links.update({ where: { id: link.id }, data: { roomId: row.id } });
    return true;
  } catch (error) {
    await links.update({ where: { id: link.id }, data: { usedAt: null } }).catch(() => undefined);
    throw error;
  }
}
