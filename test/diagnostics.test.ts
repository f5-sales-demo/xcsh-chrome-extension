import { describe, expect, it } from 'bun:test';
import {
  type BridgeSnap,
  extractRedirects,
  gateBlockEvidence,
  isNoiseKind,
  maxGap,
  pushCapped,
  summarizeActivations,
  summarizeSuspension,
  summarizeTtft,
  summarizeTurns,
} from '../src/diagnostics';
import { sessionKeyFromUrl } from '../src/tab-binding';

describe('pushCapped', () => {
  it('drops the oldest entries when over cap', () => {
    const buf: number[] = [];
    for (let i = 0; i < 5; i++) pushCapped(buf, i, 3);
    expect(buf).toEqual([2, 3, 4]);
  });
});

describe('maxGap', () => {
  it('returns 0 for fewer than two timestamps', () => {
    expect(maxGap([])).toBe(0);
    expect(maxGap([1000])).toBe(0);
  });
  it('finds the largest gap (the suspension window) regardless of order', () => {
    // ticks at 0, 20s, 20.02s(??), then a 4-minute sleep, then 260s
    expect(maxGap([0, 20_000, 20_020, 260_000])).toBe(239_980);
    expect(maxGap([260_000, 0, 20_000])).toBe(240_000);
  });
});

describe('summarizeSuspension', () => {
  it('counts restarts, suspends, tick gap, and missed binds (would-bind while WS not open)', () => {
    const summary = summarizeSuspension([
      { t: 0, event: 'sw_start' },
      { t: 1000, event: 'keepalive' },
      { t: 21_000, event: 'keepalive' },
      { t: 25_000, event: 'suspend' },
      { t: 300_000, event: 'sw_start' },
      { t: 301_000, event: 'keepalive' },
      { t: 302_000, event: 'would_bind', wsState: 'closed' }, // missed
      { t: 303_000, event: 'would_bind', wsState: 'open' }, // ok
    ]);
    expect(summary.restarts).toBe(2);
    expect(summary.suspends).toBe(1);
    expect(summary.maxTickGapMs).toBe(280_000); // 21_000 -> 301_000
    expect(summary.missedBinds).toBe(1);
  });
});

describe('extractRedirects', () => {
  it('turns CDP redirectResponse events into an annotated tenant/env chain', () => {
    const events = [
      // console → Keycloak login (302), lands on a tenant realm
      {
        method: 'Network.requestWillBeSent',
        request: { url: 'https://login.ves.volterra.io/auth/realms/acme-x1/protocol/openid-connect/auth' },
        redirectResponse: { url: 'https://acme.console.ves.volterra.io/web/home', status: 302 },
      },
      // a non-redirect event is ignored
      { method: 'Network.responseReceived', response: { url: 'https://acme.console.ves.volterra.io/', status: 200 } },
      // login → back to console (302)
      {
        method: 'Network.requestWillBeSent',
        request: { url: 'https://acme.console.ves.volterra.io/web/home' },
        redirectResponse: {
          url: 'https://login.ves.volterra.io/auth/realms/acme-x1/protocol/openid-connect/auth',
          status: 302,
        },
      },
    ];
    const hops = extractRedirects(events, sessionKeyFromUrl);
    expect(hops).toHaveLength(2);
    expect(hops[0]).toEqual({
      from: 'https://acme.console.ves.volterra.io/web/home',
      to: 'https://login.ves.volterra.io/auth/realms/acme-x1/protocol/openid-connect/auth',
      status: 302,
      toKey: { tenant: 'acme', env: 'production' },
    });
    expect(hops[1].toKey).toEqual({ tenant: 'acme', env: 'production' });
  });
});

// RC-3 (#166): when the panel gate blocks a valid, connected tenant tab, capture
// a snapshot of the live registry and COMPUTE which candidate cause it matches
// from the data — so the diagnosis is evidence, not a guess.
describe('gateBlockEvidence (RC-3)', () => {
  const b = (over: Partial<BridgeSnap>): BridgeSnap => ({
    port: 19222,
    tenant: 'f5-amer-ent',
    env: 'production',
    sessionId: 'tab-7',
    contextBound: true,
    open: true,
    ...over,
  });

  it('reports not-a-block when the tab key is live among open bridges', () => {
    const e = gateBlockEvidence({
      tabId: 7,
      sid: 'tab-7',
      key: 'f5-amer-ent|production',
      activePort: 19222,
      targetTabId: 7,
      bridges: [b({})],
    });
    expect(e.keyLive).toBe(true);
    expect(e.matchingPort).toBe(19222);
    expect(e.diagnosis).toContain('not-a-block');
  });

  it('flags stale-key when this tab worker advertises a different tenant|env', () => {
    const e = gateBlockEvidence({
      tabId: 7,
      sid: 'tab-7',
      key: 'f5-amer-ent|production',
      activePort: 19222,
      targetTabId: 7,
      bridges: [b({ tenant: 'acme', env: 'staging' })], // own sid, wrong tenant
    });
    expect(e.keyLive).toBe(false);
    expect(e.matchingPort).toBeNull();
    expect(e.ownSidPorts).toEqual([19222]);
    expect(e.diagnosis).toContain('stale-key');
  });

  it('flags asymmetric-frame when this tab worker advertised tenant XOR env', () => {
    const e = gateBlockEvidence({
      tabId: 7,
      sid: 'tab-7',
      key: 'f5-amer-ent|production',
      activePort: 19222,
      targetTabId: 7,
      bridges: [b({ env: null })], // tenant set, env missing
    });
    expect(e.keyLive).toBe(false);
    expect(e.diagnosis).toContain('asymmetric-frame');
  });

  it('flags no-own-worker when no open bridge advertises this tab sid', () => {
    const e = gateBlockEvidence({
      tabId: 7,
      sid: 'tab-7',
      key: 'f5-amer-ent|production',
      activePort: 19223,
      targetTabId: 9,
      bridges: [b({ port: 19223, sessionId: 'tab-9', tenant: 'other', env: 'production' })],
    });
    expect(e.keyLive).toBe(false);
    expect(e.ownSidPorts).toEqual([]);
    expect(e.diagnosis).toContain('no-own-worker');
  });

  it('ignores a closed socket advertising the key (must be OPEN to count live)', () => {
    const e = gateBlockEvidence({
      tabId: 7,
      sid: 'tab-7',
      key: 'f5-amer-ent|production',
      activePort: null,
      targetTabId: 7,
      bridges: [b({ open: false })],
    });
    expect(e.keyLive).toBe(false);
  });
});

// Turn-lifecycle diagnostic (#170 follow-up): make intermittent stalls observable.
// The SW records `chat_route` (a turn resolved to a port, or errored with no
// worker) and `chat_reply` (first-inbound latency). summarizeTurns pairs them by
// id so a routed turn with NO reply surfaces as `unanswered` — the "accepted but
// hangs, no error" case that gate_block never captured.
describe('summarizeTurns (turn-lifecycle diagnostic)', () => {
  const ev = (event: string, extra: Record<string, unknown>) => ({ t: 0, event, ...extra });

  it('is all-zero for an empty buffer', () => {
    expect(summarizeTurns([])).toEqual({ routed: 0, errored: 0, replied: 0, unanswered: [], maxReplyMs: 0 });
  });

  it('pairs a routed turn with its reply and records the latency', () => {
    const s = summarizeTurns([
      ev('chat_route', { id: 'c1', tabId: 7, port: 19222 }),
      ev('chat_reply', { id: 'c1', ms: 850 }),
    ]);
    expect(s.routed).toBe(1);
    expect(s.replied).toBe(1);
    expect(s.unanswered).toEqual([]);
    expect(s.maxReplyMs).toBe(850);
  });

  it('flags a routed turn with NO reply as unanswered (the stall signal)', () => {
    const s = summarizeTurns([ev('chat_route', { id: 'c1', tabId: 7, port: 19222 })]);
    expect(s.routed).toBe(1);
    expect(s.replied).toBe(0);
    expect(s.unanswered).toEqual(['c1']);
  });

  it('counts a no-worker route as errored, not routed', () => {
    const s = summarizeTurns([ev('chat_route', { id: 'c1', tabId: 7, error: true })]);
    expect(s.errored).toBe(1);
    expect(s.routed).toBe(0);
    expect(s.unanswered).toEqual([]);
  });

  it('reports the slowest first-reply latency across turns', () => {
    const s = summarizeTurns([
      ev('chat_route', { id: 'c1', port: 19222 }),
      ev('chat_reply', { id: 'c1', ms: 300 }),
      ev('chat_route', { id: 'c2', port: 19223 }),
      ev('chat_reply', { id: 'c2', ms: 1200 }),
    ]);
    expect(s.replied).toBe(2);
    expect(s.maxReplyMs).toBe(1200);
  });
});

describe('summarizeActivations', () => {
  const run = (runId: number, cold: boolean, rows: Array<[string, number, string, number?]>) =>
    rows.map(([gate, ms, outcome, total]) => ({
      t: 0,
      event: 'activation',
      runId,
      gate,
      ms,
      cold,
      outcome,
      phase: total !== undefined ? 'ready' : 'readying',
      ...(total !== undefined ? { total } : {}),
    }));

  it('groups activation events by run, most recent first, with per-gate ms + total', () => {
    const events = [
      ...run(1, true, [
        ['bridge', 12, 'passed'],
        ['worker', 492, 'passed'],
        ['page', 138, 'passed', 642],
      ]),
      ...run(2, false, [
        ['bridge', 3, 'passed'],
        ['worker', 8, 'passed'],
        ['page', 40, 'passed', 51],
      ]),
    ];
    const runs = summarizeActivations(events);
    expect(runs.map((r) => r.runId)).toEqual([2, 1]); // most recent first
    expect(runs[1]).toEqual({
      runId: 1,
      cold: true,
      total: 642,
      phase: 'ready',
      gates: [
        { gate: 'bridge', ms: 12, outcome: 'passed' },
        { gate: 'worker', ms: 492, outcome: 'passed' },
        { gate: 'page', ms: 138, outcome: 'passed' },
      ],
    });
  });

  it('reports a stalled run with null total and its terminal phase', () => {
    const events = [
      { t: 0, event: 'activation', runId: 5, gate: 'bridge', ms: 4, cold: true, outcome: 'passed', phase: 'readying' },
      {
        t: 0,
        event: 'activation',
        runId: 5,
        gate: 'worker',
        ms: 15_000,
        cold: true,
        outcome: 'stalled',
        phase: 'blocked',
      },
    ];
    const [r] = summarizeActivations(events);
    expect(r.total).toBeNull();
    expect(r.phase).toBe('blocked');
    expect(r.gates.at(-1)).toEqual({ gate: 'worker', ms: 15_000, outcome: 'stalled' });
  });

  it('ignores non-activation events and honours the limit', () => {
    const events = [
      { t: 0, event: 'keepalive' },
      ...run(1, true, [['bridge', 1, 'passed']]),
      ...run(2, true, [['bridge', 1, 'passed']]),
      ...run(3, true, [['bridge', 1, 'passed']]),
    ];
    expect(summarizeActivations(events, 2).map((r) => r.runId)).toEqual([3, 2]);
  });
});

describe('summarizeTtft', () => {
  const span = (stage: string, ms: number, over: Record<string, unknown> = {}) =>
    ({ t: 0, event: 'span', proc: 'ext', stage, ms, ...over }) as const;

  it('returns null with no spans, or when no span carries a turn id', () => {
    expect(summarizeTtft([{ t: 0, event: 'keepalive' }])).toBeNull();
    expect(summarizeTtft([span('gates', 40, { sid: 'tab-7' })])).toBeNull();
  });

  it('joins a turn to its session cold-start via the send_to_route link, ordered canonically', () => {
    const t = summarizeTtft([
      span('sw_to_ws', 30, { sid: 'tab-7' }),
      span('provision_to_worker', 500, { sid: 'tab-7', cold: true }),
      span('gates', 40, { sid: 'tab-7' }),
      span('send_to_route', 3, { id: 'c-1', sid: 'tab-7', cold: true }),
      span('route_first_token', 380, { id: 'c-1' }),
    ])!;
    expect([t.turnId, t.sid, t.cold]).toEqual(['c-1', 'tab-7', true]);
    expect(t.stages.map((s) => s.stage)).toEqual([
      'sw_to_ws',
      'provision_to_worker',
      'gates',
      'send_to_route',
      'route_first_token',
    ]);
    expect(t.total).toBe(953);
    expect(t.dominant).toBe('provision_to_worker');
  });

  it('interleaves xcsh spans and drops the route_first_token envelope when its children are present', () => {
    const t = summarizeTtft([
      span('send_to_route', 2, { id: 'c-9', sid: 'tab-3', cold: false }),
      span('chat_handler', 12, { id: 'c-9', proc: 'xcsh' }),
      span('provider_ttft', 300, { id: 'c-9', proc: 'xcsh' }),
      span('route_first_token', 320, { id: 'c-9' }),
    ])!;
    expect(t.stages.map((s) => `${s.proc}:${s.stage}`)).toEqual([
      'ext:send_to_route',
      'xcsh:chat_handler',
      'xcsh:provider_ttft',
    ]);
    expect(t.total).toBe(314);
    expect(t.dominant).toBe('provider_ttft');
    expect(t.cold).toBe(false);
  });

  it('keeps the envelope when its decomposition is only partial (one child missing)', () => {
    const t = summarizeTtft([
      span('send_to_route', 2, { id: 'c-4', sid: 'tab-8', cold: false }),
      span('chat_handler', 12, { id: 'c-4', proc: 'xcsh' }),
      span('route_first_token', 320, { id: 'c-4' }),
    ])!;
    // provider_ttft is absent, so route_first_token still captures its latency and is kept.
    expect(t.stages.map((s) => s.stage)).toEqual(['send_to_route', 'chat_handler', 'route_first_token']);
    expect(t.total).toBe(334);
    expect(t.dominant).toBe('route_first_token');
  });

  it('keeps route_first_token as a leaf in Phase 1 when its xcsh children are absent', () => {
    const t = summarizeTtft([
      span('send_to_route', 2, { id: 'c-5', sid: 'tab-2' }),
      span('route_first_token', 410, { id: 'c-5' }),
    ])!;
    expect(t.stages.map((s) => s.stage)).toEqual(['send_to_route', 'route_first_token']);
    expect(t.total).toBe(412);
    expect(t.dominant).toBe('route_first_token');
  });

  it('does not attach a session cold-start to a later WARM turn sharing the same sid', () => {
    const t = summarizeTtft([
      // cold turn c-1 established session tab-7 (its send_to_route is cold)
      span('provision_to_worker', 500, { sid: 'tab-7', cold: true }),
      span('gates', 40, { sid: 'tab-7' }),
      span('send_to_route', 3, { id: 'c-1', sid: 'tab-7', cold: true }),
      span('route_first_token', 380, { id: 'c-1' }),
      // later warm turn c-2 reuses the same session tab-7
      span('send_to_route', 2, { id: 'c-2', sid: 'tab-7', cold: false }),
      span('route_first_token', 120, { id: 'c-2' }),
    ])!;
    expect(t.turnId).toBe('c-2');
    expect(t.cold).toBe(false);
    // warm turn must NOT inherit tab-7's cold-start spans (provision_to_worker/gates)
    expect(t.stages.map((s) => s.stage)).toEqual(['send_to_route', 'route_first_token']);
    expect(t.total).toBe(122);
  });

  it('picks the most recent turn when several are present', () => {
    expect(
      summarizeTtft([
        span('send_to_route', 1, { id: 'c-1', sid: 'tab-1' }),
        span('route_first_token', 100, { id: 'c-1' }),
        span('send_to_route', 1, { id: 'c-2', sid: 'tab-2' }),
        span('route_first_token', 200, { id: 'c-2' }),
      ])!.turnId,
    ).toBe('c-2');
  });

  it('never yields an empty timeline: an envelope with both children present drops to the children (non-null)', () => {
    // The nearest reachable state to the (removed) `stages.length === 0` guard:
    // only route_first_token + its full decomposition, no other spans. Dropping the
    // envelope still leaves the two children, so the result is never null.
    const t = summarizeTtft([
      span('chat_handler', 12, { id: 'c-7', proc: 'xcsh' }),
      span('provider_ttft', 300, { id: 'c-7', proc: 'xcsh' }),
      span('route_first_token', 320, { id: 'c-7' }),
    ])!;
    expect(t.stages.map((s) => s.stage)).toEqual(['chat_handler', 'provider_ttft']);
    expect(t.total).toBe(312);
  });

  it('treats a span with no ms as 0 (the ?: 0 fallback)', () => {
    const t = summarizeTtft([
      { t: 0, event: 'span', proc: 'ext', stage: 'send_to_route', id: 'c-8', sid: 'tab-1' },
      { t: 0, event: 'span', proc: 'ext', stage: 'route_first_token', id: 'c-8' },
    ])!;
    expect(t.stages.map((s) => s.ms)).toEqual([0, 0]);
    expect(t.total).toBe(0);
  });

  it('drops the provision_to_worker envelope when its xcsh children are present', () => {
    const t = summarizeTtft([
      span('manager_provision', 5, { sid: 'tab-7', cold: true, proc: 'xcsh' }),
      span('worker_boot', 800, { sid: 'tab-7', cold: true, proc: 'xcsh' }),
      span('provision_to_worker', 830, { sid: 'tab-7' }),
      span('gates', 40, { sid: 'tab-7' }),
      span('send_to_route', 3, { id: 'c-1', sid: 'tab-7', cold: true }),
      span('route_first_token', 380, { id: 'c-1' }),
    ])!;
    expect(t.stages.map((s) => s.stage)).toEqual([
      'manager_provision', 'worker_boot', 'gates', 'send_to_route', 'route_first_token',
    ]);
    expect(t.total).toBe(5 + 800 + 40 + 3 + 380);
  });

  it('keeps provision_to_worker when only one xcsh child is present (partial)', () => {
    const t = summarizeTtft([
      span('worker_boot', 800, { sid: 'tab-7', cold: true, proc: 'xcsh' }),
      span('provision_to_worker', 830, { sid: 'tab-7' }),
      span('send_to_route', 3, { id: 'c-1', sid: 'tab-7', cold: true }),
      span('route_first_token', 380, { id: 'c-1' }),
    ])!;
    expect(t.stages.map((s) => s.stage)).toEqual([
      'worker_boot', 'provision_to_worker', 'send_to_route', 'route_first_token',
    ]);
  });
});

describe('isNoiseKind', () => {
  it('classifies only keepalive as high-frequency noise; suspend markers are signal', () => {
    expect(isNoiseKind('keepalive')).toBe(true);
    // suspend / suspend_canceled are low-frequency signals (summarizeSuspension counts
    // them, they bound the suspension window) — a keepalive flood must not evict them.
    expect(isNoiseKind('suspend')).toBe(false);
    expect(isNoiseKind('suspend_canceled')).toBe(false);
    expect(isNoiseKind('span')).toBe(false);
    expect(isNoiseKind('activation')).toBe(false);
    expect(isNoiseKind('chat_reply')).toBe(false);
  });
});
