/**
 * UAT for the service-worker MESSAGE-ROUTING glue (#169 follow-up). service-worker.ts
 * runs side-effects at import (keepalive, scan, chrome listeners) so it can't be
 * imported in a test; its routing DECISIONS are therefore extracted into pure
 * planners here (`src/sw-router.ts`) which the SW executes. These tests lock the
 * branch logic the SW used to inline untested — the seam RC-1/RC-2/RC-3 live on.
 */
import { describe, expect, test } from 'bun:test';
import { NO_WORKER_FOR_TAB, planChatRequest, planHelloAck, planReTenant, planToolRequest } from '../src/sw-router';

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

  test('errors when the worker advertises a DIFFERENT tenant than the tab (stale)', () => {
    expect(planChatRequest({ id: 'c1', tabId: 1, sessionKey: 'beta|production' }, reg, allOpen)).toEqual({
      kind: 'error',
      id: 'c1',
      error: NO_WORKER_FOR_TAB,
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
