/**
 * Pure per-tab cold-start provision tracking for the TTFT timeline (#170).
 * The service worker sends a `provision` native-message when a tab needs a worker;
 * this tracks, per session id (`tab-<id>`), the epoch ms of that send so that when
 * the worker registers we can emit the true `provision_to_worker` duration and flag
 * the session as freshly provisioned (its next chat turn is a cold start).
 *
 * Chrome-free so it unit-tests in isolation; the SW owns one instance and reaps a
 * session's entries on `chrome.tabs.onRemoved`.
 */

/** Age (ms) past which a pending provision is considered abandoned: its worker never
 *  registered, so measuring against it would inflate a later spare-adopt duration. */
export const PROVISION_TTL_MS = 60_000;

export interface ProvisionState {
  /** sid → epoch ms of the provision nm_send, consumed once when its worker registers. */
  sentAt: Map<string, number>;
  /** sids whose worker just (re)registered → the NEXT turn on that sid is a cold start. */
  fresh: Set<string>;
}

export function newProvisionState(): ProvisionState {
  return { sentAt: new Map(), fresh: new Set() };
}

/** Record that a provision was just sent for `sid` (overwrites any pending one). */
export function markProvisionSent(s: ProvisionState, sid: string, now: number): void {
  s.sentAt.set(sid, now);
}

/**
 * Consume a pending provision when its worker registers. Returns the provision→register
 * duration (ms) and flags `sid` cold, but ONLY when a provision is pending and it is no
 * older than `ttl`. A stale entry (older than `ttl`, e.g. a worker that never came up) is
 * dropped without a measurement or cold flag. Returns null when there is nothing to consume
 * or the pending provision was stale.
 */
export function consumeOnRegister(
  s: ProvisionState,
  sid: string,
  now: number,
  ttl: number = PROVISION_TTL_MS,
): number | null {
  const at = s.sentAt.get(sid);
  if (at === undefined) return null;
  s.sentAt.delete(sid);
  const ms = now - at;
  if (ms > ttl) return null;
  s.fresh.add(sid);
  return ms;
}

/** Consume the cold flag for `sid` (true once per fresh provision), so the first route
 *  after a worker registers is tagged cold and later warm turns are not. */
export function consumeColdOnRoute(s: ProvisionState, sid: string): boolean {
  if (!s.fresh.has(sid)) return false;
  s.fresh.delete(sid);
  return true;
}

/** Drop all pending state for a session (its tab was closed). */
export function reapTab(s: ProvisionState, sid: string): void {
  s.sentAt.delete(sid);
  s.fresh.delete(sid);
}
