import { describe, expect, test } from 'bun:test';
import {
  contextTabFor,
  portForTab,
  resolveChatPort,
  resolveToolTab,
  sidForTab,
  staleTabPorts,
} from '../src/session-routing';

describe('sidForTab', () => {
  test('derives a stable sid from tabId', () => {
    expect(sidForTab(42)).toBe('tab-42');
  });
});
describe('portForTab', () => {
  test('finds the port advertising the sid', () => {
    const reg = new Map([
      [19222, { sessionId: 'tab-1' }],
      [19223, { sessionId: 'tab-2' }],
    ]);
    expect(portForTab(reg, 'tab-2')).toBe(19223);
    expect(portForTab(reg, 'tab-9')).toBeUndefined();
  });
});
describe('resolveToolTab', () => {
  const portToTab = new Map([
    [19222, 1],
    [19223, 2],
  ]);
  test('returns the bound tab for the source socket', () => {
    expect(resolveToolTab(19222, portToTab)).toBe(1);
    expect(resolveToolTab(19223, portToTab)).toBe(2);
  });
  test('returns null for an unbound / unknown source (never a fallback)', () => {
    expect(resolveToolTab(19999, portToTab)).toBeNull();
    expect(resolveToolTab(undefined, portToTab)).toBeNull();
  });
});
describe('resolveChatPort', () => {
  const reg = new Map([
    [19222, { sessionId: 'tab-1' }],
    [19223, { sessionId: 'tab-2' }],
  ]);
  test("routes a chat turn to the worker for the panel's OWN tab", () => {
    expect(resolveChatPort(1, reg)).toBe(19222);
    expect(resolveChatPort(2, reg)).toBe(19223);
  });
  test('undefined for an unbound tab or missing tabId (caller refuses; never a global activePort fallback)', () => {
    expect(resolveChatPort(9, reg)).toBeUndefined();
    expect(resolveChatPort(undefined, reg)).toBeUndefined();
  });
});
describe('late-bind adoption (pre-warm pool)', () => {
  test("routing follows a port re-identified from 'spare' to 'tab-<id>'", () => {
    const reg = new Map<number, { sessionId: string }>([[19222, { sessionId: 'spare' }]]);
    // A warm spare (sessionId 'spare') is bound to no tab.
    expect(portForTab(reg, sidForTab(7))).toBeUndefined();
    // Adoption: the worker late-binds and its tenant_changed updates the registry sessionId.
    reg.set(19222, { sessionId: 'tab-7' });
    // Now chat/tool routing resolves the same port for tab 7.
    expect(portForTab(reg, sidForTab(7))).toBe(19222);
    expect(resolveChatPort(7, reg)).toBe(19222);
  });
});

// RC-1 (issue #166): wrong tenant after same-tab re-login. A tab re-tenants
// (tenant A → B) but the sid ("tab-<id>") is stable, and the old-tenant worker
// lingers in the registry until its socket closes (service-worker onclose). A
// chat turn for the tab's NEW tenant must NOT be routed to a worker still
// advertising the OLD tenant|env. `resolveChatPort` takes the tab's current
// session key and refuses any worker whose advertised key differs.
describe('resolveChatPort tenant guard (RC-1)', () => {
  test('refuses a stale-tenant worker on the tab sid; routes only to the matching-tenant worker', () => {
    // Only worker for tab-1 still advertises the OLD tenant (acme|staging) —
    // its socket has not closed yet after the tab moved to beta|production.
    const reg = new Map<number, { sessionId: string | null; tenant: string | null; env: string | null }>([
      [19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }],
    ]);
    // Guarded routing for the tab's CURRENT key refuses the stale worker.
    expect(resolveChatPort(1, reg, 'beta|production')).toBeUndefined();
    // The fresh worker for the new tenant registers (same sid, new tenant|env).
    reg.set(19223, { sessionId: 'tab-1', tenant: 'beta', env: 'production' });
    // Now the turn routes to the NEW-tenant worker, never the lingering old one.
    expect(resolveChatPort(1, reg, 'beta|production')).toBe(19223);
  });

  test('a race with two ports on the same sid picks the port whose tenant matches', () => {
    // Old worker (19222) and new worker (19223) both transiently advertise tab-1.
    const reg = new Map<number, { sessionId: string | null; tenant: string | null; env: string | null }>([
      [19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }],
      [19223, { sessionId: 'tab-1', tenant: 'beta', env: 'production' }],
    ]);
    expect(resolveChatPort(1, reg, 'beta|production')).toBe(19223);
    expect(resolveChatPort(1, reg, 'acme|staging')).toBe(19222);
  });

  test('a worker advertising tenant but null env never matches a full key', () => {
    const reg = new Map<number, { sessionId: string | null; tenant: string | null; env: string | null }>([
      [19222, { sessionId: 'tab-1', tenant: 'beta', env: null }],
    ]);
    expect(resolveChatPort(1, reg, 'beta|production')).toBeUndefined();
  });

  test('omitting expectedKey preserves the legacy sid-only match (back-compat)', () => {
    const reg = new Map([[19222, { sessionId: 'tab-1' }]]);
    expect(resolveChatPort(1, reg)).toBe(19222);
  });
});

// RC-1 source-side: detect workers still bound to a tab's sid whose advertised
// tenant|env no longer matches the tab's CURRENT key, so the SW can evict them
// from the registry (and release/reprovision) even after an MV3 suspension lost
// the in-memory tabSessionKeys — this reads the registry, which is rebuilt from
// hello_acks, so it does not depend on prevKey.
describe('staleTabPorts (RC-1 re-tenant detection)', () => {
  type R = Map<number, { sessionId: string | null; tenant: string | null; env: string | null }>;
  test('flags a worker on the tab sid whose tenant differs from the current key', () => {
    const reg: R = new Map([[19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }]]);
    expect(staleTabPorts(reg, 1, 'beta|production')).toEqual([19222]);
  });
  test('keeps a worker whose tenant matches the current key', () => {
    const reg: R = new Map([[19222, { sessionId: 'tab-1', tenant: 'beta', env: 'production' }]]);
    expect(staleTabPorts(reg, 1, 'beta|production')).toEqual([]);
  });
  test('flags the worker when the tab navigated off-console (null current key)', () => {
    const reg: R = new Map([[19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }]]);
    expect(staleTabPorts(reg, 1, null)).toEqual([19222]);
  });
  test('returns nothing when the tab has no worker, and ignores other tabs', () => {
    const reg: R = new Map([[19223, { sessionId: 'tab-2', tenant: 'acme', env: 'staging' }]]);
    expect(staleTabPorts(reg, 1, 'beta|production')).toEqual([]);
  });
  test('in an old+new race, flags only the stale (old-tenant) port', () => {
    const reg: R = new Map([
      [19222, { sessionId: 'tab-1', tenant: 'acme', env: 'staging' }],
      [19223, { sessionId: 'tab-1', tenant: 'beta', env: 'production' }],
    ]);
    expect(staleTabPorts(reg, 1, 'beta|production')).toEqual([19222]);
  });
});

// RC-2 (issue #166): the page-context snapshot attached to a chat turn must be
// built for the PANEL'S active tab (the transcript's tab), not the global
// controlled/automation tab — otherwise the context comes from the wrong tab
// when the two differ. The panel sends its bound tab; the controlled tab is only
// a legacy fallback when the panel supplied none.
describe('contextTabFor (RC-2)', () => {
  test("prefers the panel's requested tab over the controlled tab", () => {
    expect(contextTabFor(5, 9)).toBe(5);
  });
  test('falls back to the controlled tab only when the panel sent none', () => {
    expect(contextTabFor(undefined, 9)).toBe(9);
  });
  test('undefined when neither is available', () => {
    expect(contextTabFor(undefined, undefined)).toBeUndefined();
  });
});
