/**
 * QR phone link endpoints (phone-link.server.ts):
 *
 * Desktop, with the session (Authorization, cookie, {session}):
 *   POST /phone-link {page}           → {link: PhoneLinkView}
 *   POST /phone-link-status {linkId}  → {phone: PhoneLinkStatusView}
 * Phone, with the link token only ({link}; no session):
 *   POST /phone-check {link}          → {phone: {status: "open", expiresInMs}}
 *   POST /phone-photo {link, image, fovDegrees?, consent: true} → {ok: true}
 *
 * A used, expired or unknown link is "link_expired" (410). Both phone
 * endpoints answer the same for all three, so a guess learns nothing.
 */
import { koshoyJson, loadSession, readJson, type KoshoyRequestContext } from "./handlers.server";
import { parseOpaqueId, parseRoomPhoto } from "./input";
import { createPhoneLink, openPhoneLink, parsePagePath, phoneLinkStatus, sendPhonePhoto } from "./phone-link.server";
import { koshoyClientKey } from "./rate-limit.server";
import { koshoyStudioError } from "./room-handlers.server";

/* ---------------- POST /phone-link ---------------- */

export async function handleKoshoyPhoneLink(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room || !ctx.phone) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const page = parsePagePath(body.page);
    if (!page) return koshoyStudioError("invalid_input");
    if (!ctx.phone.limits.create.hit(session.id)) return koshoyStudioError("rate_limited");

    const link = await createPhoneLink(ctx.phone, session, page);
    return koshoyJson({ link });
  } catch (error) {
    console.error("[koshoy] phone link failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /phone-link-status ---------------- */

export async function handleKoshoyPhoneLinkStatus(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room || !ctx.phone) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const session = await loadSession(request, ctx, body);
    if (!session) return koshoyStudioError("session_expired");
    const linkId = parseOpaqueId(body.linkId);
    if (!linkId) return koshoyStudioError("invalid_input");
    if (!ctx.limits.roomRead.hit(session.id)) return koshoyStudioError("rate_limited");

    const row = await ctx.phone.db.koshoyPhoneLink.findFirst({
      where: { id: linkId, sessionId: session.id },
    });
    if (!row) return koshoyStudioError("not_found");
    return koshoyJson({ phone: phoneLinkStatus(row, (ctx.phone.now ?? Date.now)()) });
  } catch (error) {
    console.error("[koshoy] phone link status failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /phone-check ---------------- */

export async function handleKoshoyPhoneCheck(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room || !ctx.phone) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    if (!ctx.phone.limits.check.hit(koshoyClientKey(ctx.shop, request))) {
      return koshoyStudioError("rate_limited");
    }
    const link = await openPhoneLink(ctx.phone, ctx.shop, body.link);
    if (!link) return koshoyStudioError("link_expired");
    const expiresInMs = link.expiresAt.getTime() - (ctx.phone.now ?? Date.now)();
    return koshoyJson({ phone: { status: "open", expiresInMs } });
  } catch (error) {
    console.error("[koshoy] phone check failed", error);
    return koshoyStudioError("unavailable");
  }
}

/* ---------------- POST /phone-photo ---------------- */

export async function handleKoshoyPhonePhoto(
  request: Request,
  ctx: KoshoyRequestContext,
): Promise<Response> {
  try {
    if (!ctx.enabled || !ctx.room || !ctx.phone) return koshoyStudioError("unavailable");
    const body = await readJson(request);
    const link = await openPhoneLink(ctx.phone, ctx.shop, body.link);
    if (!link) return koshoyStudioError("link_expired");
    const input = parseRoomPhoto(body);
    // The phone page always asks for consent first (KVKK); no photo without it.
    if (!input || !input.consent) return koshoyStudioError("invalid_input");
    if (!ctx.limits.room.hit(koshoyClientKey(ctx.shop, request))) {
      return koshoyStudioError("rate_limited");
    }

    const sent = await sendPhonePhoto(ctx.phone, ctx.room, link, input);
    return sent ? koshoyJson({ ok: true }) : koshoyStudioError("link_expired");
  } catch (error) {
    console.error("[koshoy] phone photo failed", error);
    return koshoyStudioError("unavailable");
  }
}
