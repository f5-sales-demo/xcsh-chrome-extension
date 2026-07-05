import { describe, expect, it } from 'bun:test';
import {
  type BridgeSnap,
  extractRedirects,
  gateBlockEvidence,
  maxGap,
  pushCapped,
  summarizeSuspension,
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
