/**
 * Pure diagnostics helpers for Phase 0 investigation — Chrome-free and DOM-free
 * so they unit-test in isolation. The service worker records events into a
 * capped ring buffer (SW (re)start, suspend/canceled, keepalive ticks, WS
 * open/close, would-bind activations) and exposes them via the `diag_suspension`
 * tool; `capture_login_flow` uses `extractRedirects` to turn captured CDP
 * network events into an annotated redirect chain for login-topology analysis.
 */

/** A single timestamped diagnostics record. */
export interface DiagEvent {
  /** Epoch ms. */
  t: number;
  /** Event kind, e.g. "sw_start", "suspend", "keepalive", "ws_open", "would_bind". */
  event: string;
  /** Arbitrary structured detail (wsState, tabId, url, tenant, …). */
  [k: string]: unknown;
}

/** Push onto a ring buffer, dropping the oldest when over `cap` (in place). */
export function pushCapped<T>(buf: T[], item: T, cap: number): void {
  buf.push(item);
  while (buf.length > cap) buf.shift();
}

/**
 * Largest gap between consecutive timestamps — the MV3 suspension window when
 * applied to keepalive-tick times (a tick every ~20s should keep the max gap
 * near 20s; a large gap means the SW slept). Returns 0 for < 2 timestamps.
 */
export function maxGap(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let max = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > max) max = gap;
  }
  return max;
}

export interface SuspensionSummary {
  /** Count of SW (re)starts recorded. */
  restarts: number;
  /** Count of onSuspend events. */
  suspends: number;
  /** Largest gap between keepalive ticks (ms) — the observed suspension window. */
  maxTickGapMs: number;
  /** would-bind activations that fired while the WS was not open (proxy for missed binds). */
  missedBinds: number;
}

export interface TurnSummary {
  /** chat_request turns that resolved to a worker port. */
  routed: number;
  /** chat_request turns refused because the tab had no live worker. */
  errored: number;
  /** routed turns that received at least one inbound reply. */
  replied: number;
  /** routed turn ids with NO reply in the buffer — the "accepted but stalled" or
   *  "delivered but dropped" signal that gate_block never captured (#170). */
  unanswered: string[];
  /** slowest observed first-reply latency (ms). */
  maxReplyMs: number;
}

/** Pair `chat_route` events (turn → port, or error) with `chat_reply` events
 *  (first-inbound latency) by turn id, so a routed-but-unanswered turn surfaces
 *  in diag_suspension. Pure: the SW stamps the events + latency; this only reads. */
export function summarizeTurns(events: DiagEvent[]): TurnSummary {
  const routedIds = new Set<string>();
  const repliedIds = new Set<string>();
  let errored = 0;
  let maxReplyMs = 0;
  for (const e of events) {
    if (e.event === 'chat_route') {
      if (typeof e.port === 'number') routedIds.add(String(e.id));
      else if (e.error === true) errored++;
    } else if (e.event === 'chat_reply') {
      repliedIds.add(String(e.id));
      if (typeof e.ms === 'number' && e.ms > maxReplyMs) maxReplyMs = e.ms;
    }
  }
  const unanswered = [...routedIds].filter((id) => !repliedIds.has(id));
  const replied = routedIds.size - unanswered.length;
  return { routed: routedIds.size, errored, replied, unanswered, maxReplyMs };
}

/** Summarize a diagnostics buffer into the numbers we care about for Phase 0a. */
export function summarizeSuspension(events: DiagEvent[]): SuspensionSummary {
  const tickTimes = events.filter((e) => e.event === 'keepalive').map((e) => e.t);
  const missedBinds = events.filter((e) => e.event === 'would_bind' && e.wsState !== 'open').length;
  return {
    restarts: events.filter((e) => e.event === 'sw_start').length,
    suspends: events.filter((e) => e.event === 'suspend').length,
    maxTickGapMs: maxGap(tickTimes),
    missedBinds,
  };
}

/** A live bridge as seen by the SW registry, flattened for a diagnostics snapshot. */
export interface BridgeSnap {
  port: number;
  tenant: string | null;
  env: string | null;
  sessionId: string | null;
  contextBound: boolean;
  /** Whether the WebSocket to this bridge is currently OPEN. */
  open: boolean;
}

/** Evidence captured when the panel gate blocks a valid, connected tenant tab
 *  (RC-3, #166). `diagnosis` is COMPUTED from the snapshot, not guessed. */
export interface GateBlockEvidence {
  tabId: number | null;
  /** `sidForTab(tabId)` — the per-tab worker id the tab expects. */
  sid: string | null;
  /** The tab's current "tenant|env" the panel computed. */
  key: string | null;
  /** Is `key` advertised by any OPEN bridge (what the gate checks)? */
  keyLive: boolean;
  /** Ports of OPEN bridges advertising this tab's sid (its own worker, if any). */
  ownSidPorts: number[];
  /** The `"tenant|env"` each own-sid bridge advertises (partials show the gap). */
  ownSidKeys: string[];
  /** Port with this tab's sid AND matching key — where a turn would route, or null. */
  matchingPort: number | null;
  activePort: number | null;
  targetTabId: number | null;
  diagnosis: string;
  bridges: BridgeSnap[];
}

/** Compute gate-block evidence + a data-driven diagnosis from a registry snapshot.
 *  Pure so it unit-tests without Chrome; the SW feeds it the live registry. */
export function gateBlockEvidence(input: {
  tabId: number | null;
  sid: string | null;
  key: string | null;
  activePort: number | null;
  targetTabId: number | null;
  bridges: BridgeSnap[];
}): GateBlockEvidence {
  const open = input.bridges.filter((x) => x.open);
  const keyOf = (x: BridgeSnap): string | null => (x.tenant && x.env ? `${x.tenant}|${x.env}` : null);
  const keyLive = !!input.key && open.some((x) => keyOf(x) === input.key);
  const ownSid = open.filter((x) => x.sessionId !== null && x.sessionId === input.sid);
  const ownSidKeys = ownSid.map((x) => `${x.tenant ?? ''}|${x.env ?? ''}`);
  const matching = ownSid.find((x) => keyOf(x) === input.key);
  let diagnosis: string;
  if (keyLive) {
    diagnosis = 'not-a-block: tab key is live among open bridges';
  } else if (ownSid.length === 0) {
    diagnosis =
      'no-own-worker: no open bridge advertises this tab sid (a connected socket belongs to another tab/tenant)';
  } else if (ownSid.some((x) => (x.tenant && !x.env) || (!x.tenant && x.env))) {
    diagnosis = 'asymmetric-frame: this tab worker advertised tenant XOR env (excluded from liveTenants)';
  } else {
    diagnosis = 'stale-key: this tab worker advertises a different tenant|env than the tab (RC-1 surfacing as a block)';
  }
  return {
    tabId: input.tabId,
    sid: input.sid,
    key: input.key,
    keyLive,
    ownSidPorts: ownSid.map((x) => x.port),
    ownSidKeys,
    matchingPort: matching?.port ?? null,
    activePort: input.activePort,
    targetTabId: input.targetTabId,
    diagnosis,
    bridges: input.bridges,
  };
}

/** One hop in a captured redirect chain, annotated with the resolved session key. */
export interface RedirectHop {
  from: string;
  to: string;
  status: number;
  /** `sessionKeyFromUrl(to)` — the tenant/env the hop lands on, or null. */
  toKey: { tenant: string; env: 'production' | 'staging' } | null;
}

/**
 * Extract the redirect chain from captured CDP network events. Chrome signals a
 * redirect via `Network.requestWillBeSent` carrying a `redirectResponse` (the
 * 3xx that caused the new request); `from` = that response's URL, `to` = the new
 * request URL. Each hop's landing URL is annotated via the injected
 * `sessionKey` resolver (dependency-injected to keep this module pure).
 */
export function extractRedirects(
  events: Array<Record<string, unknown>>,
  sessionKey: (url: string | undefined) => { tenant: string; env: 'production' | 'staging' } | null,
): RedirectHop[] {
  const hops: RedirectHop[] = [];
  for (const e of events) {
    if (e.method !== 'Network.requestWillBeSent') continue;
    const rr = e.redirectResponse as { url?: string; status?: number } | undefined;
    if (!rr) continue;
    const from = rr.url;
    const req = e.request as { url?: string } | undefined;
    const to = req?.url ?? (e.documentURL as string | undefined);
    if (!from || !to) continue;
    hops.push({ from, to, status: rr.status ?? 0, toKey: sessionKey(to) });
  }
  return hops;
}
