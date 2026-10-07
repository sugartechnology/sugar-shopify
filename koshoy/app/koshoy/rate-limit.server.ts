/**
 * In-process limits per Koshoy session, per visitor and per shop. Good
 * enough for one app instance; a shared store is needed once the app runs
 * on several replicas.
 */

export interface KoshoyRateLimiter {
  /** Records one hit; false when the key is over its window budget. */
  hit(key: string, now?: number): boolean;
  /** Whether one more hit would pass; records nothing. */
  allows(key: string, now?: number): boolean;
}

export interface KoshoyBusyLock {
  acquire(key: string): boolean;
  release(key: string): void;
}

const MAX_KEYS = 10_000;

export const KOSHOY_LIMITS = {
  /** per session */
  turn: { limit: 20, windowMs: 60_000 },
  edit: { limit: 120, windowMs: 60_000 },
  cart: { limit: 20, windowMs: 60_000 },
  /** new sessions per visitor (shop + client address) */
  session: { limit: 30, windowMs: 60_000 },
  /** turns per visitor across all of their sessions */
  client: { limit: 40, windowMs: 60_000 },
  /** whole-shop budget for turns (model cost) */
  shop: { limit: 600, windowMs: 60_000 },
  /** whole-shop budget for new sessions (DB growth); session spam cannot use up turns */
  shopSession: { limit: 600, windowMs: 60_000 },
} as const;

/**
 * X-Forwarded-For entries appended by proxies we trust, counted from the
 * right: the App Proxy forwards "<client>, <proxy>", and anything left of
 * the client entry was sent by the browser itself. Set
 * KOSHOY_TRUSTED_PROXY_HOPS when another ingress (load balancer, TLS
 * terminator) appends its own entry in front of the app.
 */
function trustedProxyHops(): number {
  const raw = process.env.KOSHOY_TRUSTED_PROXY_HOPS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= 0 && value <= 10 ? value : 1;
}

/**
 * Best-effort visitor key: the client address the App Proxy forwards, read
 * from the right so a header the browser sent cannot pick a fresh key.
 * Shopify does not sign it, so the per-shop budget is the hard backstop.
 */
export function koshoyClientKey(
  shop: string,
  request: Request,
  hops: number = trustedProxyHops(),
): string {
  const entries = (request.headers.get("X-Forwarded-For") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const forwarded = entries[Math.max(0, entries.length - 1 - hops)];
  const address = forwarded || request.headers.get("X-Real-IP")?.trim() || "unknown";
  return `${shop}|${address.slice(0, 64)}`;
}

/**
 * Records a hit on every limiter only when all of them still have room, so
 * a refused request spends no budget and adds no key (spoofed visitor keys
 * stop growing the maps once the shop budget is gone).
 */
export function hitAll(
  entries: ReadonlyArray<readonly [KoshoyRateLimiter, string]>,
  now: number = Date.now(),
): boolean {
  if (!entries.every(([limiter, key]) => limiter.allows(key, now))) return false;
  for (const [limiter, key] of entries) limiter.hit(key, now);
  return true;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}): KoshoyRateLimiter {
  const hits = new Map<string, number[]>();

  const prune = (now: number) => {
    const cutoff = now - options.windowMs;
    for (const [key, list] of hits) {
      if (!list.length || list[list.length - 1] <= cutoff) hits.delete(key);
    }
  };

  return {
    allows(key, now = Date.now()) {
      const cutoff = now - options.windowMs;
      return (hits.get(key) ?? []).filter((at) => at > cutoff).length < options.limit;
    },
    hit(key, now = Date.now()) {
      if (hits.size > MAX_KEYS) prune(now);
      const cutoff = now - options.windowMs;
      const list = (hits.get(key) ?? []).filter((at) => at > cutoff);
      if (list.length >= options.limit) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
  };
}

/** One running turn per session; a second concurrent turn is refused. */
export function createBusyLock(): KoshoyBusyLock {
  const busy = new Set<string>();
  return {
    acquire(key) {
      if (busy.has(key)) return false;
      busy.add(key);
      return true;
    },
    release(key) {
      busy.delete(key);
    },
  };
}
