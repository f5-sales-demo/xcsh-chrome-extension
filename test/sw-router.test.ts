/**
 * UAT for the service-worker MESSAGE-ROUTING glue (#169 follow-up). service-worker.ts
 * runs side-effects at import (keepalive, scan, chrome listeners) so it can't be
 * imported in a test; its routing DECISIONS are therefore extracted into pure
 * planners here (`src/sw-router.ts`) which the SW executes. These tests lock the
 * branch logic the SW used to inline untested — the seam RC-1/RC-2/RC-3 live on.
 */
import { describe, expect, test } from 'bun:test';
import {
  classifyProbe,
  NO_WORKER_FOR_TAB,
  planChatRequest,
  planHelloAck,
  planReprovision,
  planReTenant,
  planToolRequest,
} from '../src/sw-router';

// #182: a persistent no-own-worker gate-block should re-provision (rate-limited)
// so a tab whose worker died mid-session recovers, instead of sitting blocked
// forever (the panel's block was previously diagnostic-only).
describe('planReprovision (#182)', () => {
  const base = {
    hasWorker: false,
    manualPinned: false,
    connected: true,
    lastAt: undefined,
    now: 10_000,
    minIntervalMs: 5_000,
  };
  test('re-provisions when blocked, connected, not pinned, and outside the rate-limit window', () => {
    expect(planReprovision(base)).toEqual({ kind: 'reprovision' });
    expect(planReprovision({ ...base, lastAt: 4_000 })).toEqual({ kind: 'reprovision' }); // 6s ago > 5s
  });
  test('skips when a worker already exists for the tab', () => {
    expect(planReprovision({ ...base, hasWorker: true })).toEqual({ kind: 'skip' });
  });
  test('skips in manual-pinned mode and when disconnected', () => {
    expect(planReprovision({ ...base, manualPinned: true })).toEqual({ kind: 'skip' });
    expect(planReprovision({ ...base, connected: false })).toEqual({ kind: 'skip' });
  });
  test('skips within the rate-limit window', () => {
    expect(planReprovision({ ...base, lastAt: 6_000 })).toEqual({ kind: 'skip' }); // 4s ago < 5s
  });
});

type Reg = Map<number, { sessionId: string | null; tenant: string | null; env: string | null }>;
const allOpen = () => true;

describe('planChatRequest (RC-1 SW-side enforcement)', () => {
  const reg: Reg = new Map([[19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }]]);

  test('routes to the tab’s worker when open and the key matches', () => {
    expect(planChatRequest({ id: 'c1', tabId: 1, sessionKey: 'acme|staging' }, reg, allOpen)).toEqual({
      kind: 'route',
      id: 'c1',
      port: 19222,
    });
  });

  test('errors with a no-worker reason when the worker advertises a DIFFERENT tenant (stale)', () => {
    expect(planChatRequest({ id: 'c1', tabId: 1, sessionKey: 'beta|production' }, reg, allOpen)).toEqual({
      kind: 'error',
      id: 'c1',
      error: NO_WORKER_FOR_TAB,
      reason: 'no-worker',
    });
  });

  test('errors when the tab has no worker at all', () => {
    expect(planChatRequest({ id: 'c1', tabId: 9, sessionKey: 'acme|staging' }, reg, allOpen).kind).toBe('error');
  });

  test('errors when the resolved worker’s socket is not open', () => {
    const isOpen = (p: number) => p !== 19222;
    expect(planChatRequest({ id: 'c1', tabId: 1, sessionKey: 'acme|staging' }, reg, isOpen).kind).toBe('error');
  });

  test('routes on sid alone when no sessionKey is supplied (back-compat)', () => {
    expect(planChatRequest({ id: 'c1', tabId: 1 }, reg, allOpen)).toEqual({ kind: 'route', id: 'c1', port: 19222 });
  });

  test('errors when the panel sent no tabId', () => {
    expect(planChatRequest({ id: 'c1' }, reg, allOpen).kind).toBe('error');
  });
});

// The route-ack watchdog fires while a turn is unanswered. It sends a ping and
// checks whether the bridge port showed inbound activity (the worker pongs — and
// pings the SW every 15s — even mid-LLM). This decouples "worker dead" from
// "worker alive but the model is slow", so a slow turn is NEVER falsely killed.
describe('classifyProbe (route-ack liveness)', () => {
  test('answered → the turn already got a reply; nothing to do', () => {
    expect(classifyProbe(true, false)).toBe('answered');
    expect(classifyProbe(true, true)).toBe('answered');
  });
  test('unanswered + activity advanced → worker is alive (slow model), keep waiting', () => {
    expect(classifyProbe(false, true)).toBe('alive');
  });
  test('unanswered + no activity after the probe → worker is dead/half-open, recover', () => {
    expect(classifyProbe(false, false)).toBe('dead');
  });
});

describe('planToolRequest', () => {
  const portToTab = new Map([[19222, 7]]);
  test('runs against the socket’s bound tab', () => {
    expect(planToolRequest(19222, portToTab)).toEqual({ kind: 'run', tabId: 7 });
  });
  test('refuses an unbound source (never a fallback tab)', () => {
    expect(planToolRequest(19999, portToTab)).toEqual({ kind: 'refuse' });
    expect(planToolRequest(undefined, portToTab)).toEqual({ kind: 'refuse' });
  });
});

describe('planHelloAck', () => {
  test('ignores a frame with no string sessionId (not a real hello_ack)', () => {
    expect(planHelloAck({ tenant: 'acme', env: 'staging' }, '1.0.0')).toEqual({ kind: 'ignore' });
  });
  test('rejects a major contract-version mismatch', () => {
    expect(planHelloAck({ sessionId: 'tab-1', contractVersion: '2.3.0' }, '1.0.0')).toEqual({ kind: 'reject' });
  });
  test('accepts a compatible frame, carrying the identity fields', () => {
    expect(
      planHelloAck(
        { sessionId: 'tab-1', tenant: 'acme', env: 'staging', contextBound: true, contractVersion: '1.9.0' },
        '1.0.0',
      ),
    ).toEqual({ kind: 'accept', sessionId: 'tab-1', tenant: 'acme', env: 'staging', contextBound: true });
  });
  test('accepts when contractVersion is absent; contextBound is true ONLY when strictly true', () => {
    expect(planHelloAck({ sessionId: 'spare' }, '1.0.0')).toEqual({
      kind: 'accept',
      sessionId: 'spare',
      tenant: null,
      env: null,
      contextBound: false,
    });
    expect(planHelloAck({ sessionId: 'tab-1', contextBound: 'yes' }, '1.0.0').kind).toBe('accept');
    expect(
      (planHelloAck({ sessionId: 'tab-1', contextBound: 'yes' }, '1.0.0') as { contextBound: boolean }).contextBound,
    ).toBe(false);
  });
});

describe('planReTenant (RC-1 source-side eviction)', () => {
  const reg: Reg = new Map([[19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }]]);
  test('no-op when the worker on the tab sid already matches the current key', () => {
    expect(planReTenant(reg, 1, 'acme|staging')).toEqual({ kind: 'noop' });
  });
  test('re-tenant: evict the stale port, release + provision the new tenant', () => {
    expect(planReTenant(reg, 1, 'beta|production')).toEqual({
      kind: 'retenant',
      releaseSid: 'tab-1',
      evictPorts: [19222],
      provisionTenant: 'beta|production',
    });
  });
  test('navigated off-console (null key): evict + release, but do NOT provision', () => {
    expect(planReTenant(reg, 1, null)).toEqual({
      kind: 'retenant',
      releaseSid: 'tab-1',
      evictPorts: [19222],
      provisionTenant: null,
    });
  });
  test('empty-string key is treated like null: evict + release, no provision', () => {
    expect(planReTenant(reg, 1, '')).toEqual({
      kind: 'retenant',
      releaseSid: 'tab-1',
      evictPorts: [19222],
      provisionTenant: null,
    });
  });
});
