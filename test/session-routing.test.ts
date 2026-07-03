import { describe, expect, test } from 'bun:test';
import { portForTab, resolveToolTab, sidForTab } from '../src/session-routing';

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
