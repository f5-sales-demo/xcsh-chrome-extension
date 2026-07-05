import { describe, expect, test } from 'bun:test';
import { portForTab, resolveChatPort, resolveToolTab, sidForTab } from '../src/session-routing';

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
