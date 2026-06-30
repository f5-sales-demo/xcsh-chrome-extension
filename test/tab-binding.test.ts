import { describe, expect, it } from 'bun:test';
import { decideBinding, isConsoleUrl, isLinkStale } from '../src/tab-binding';

const CONSOLE = 'https://acme.console.ves.volterra.io/web/x';
const CONSOLE2 = 'https://acme.staging.volterra.us/web/y';
const OTHER = 'https://example.com/';

describe('isConsoleUrl', () => {
  it('matches volterra.us and console.ves.volterra.io https', () => {
    expect(isConsoleUrl(CONSOLE)).toBe(true);
    expect(isConsoleUrl(CONSOLE2)).toBe(true);
  });
  it('rejects other hosts, http, and undefined', () => {
    expect(isConsoleUrl(OTHER)).toBe(false);
    expect(isConsoleUrl('http://acme.volterra.us/')).toBe(false);
    expect(isConsoleUrl(undefined)).toBe(false);
  });
});

describe('decideBinding', () => {
  const idle = (controlledTabId: number | undefined) => ({ controlledTabId, inFlight: false });

  it('binds when a different console tab is activated while idle', () => {
    expect(decideBinding(idle(undefined), { kind: 'activated', tabId: 5, url: CONSOLE })).toEqual({
      action: 'bind',
      tabId: 5,
    });
    expect(decideBinding(idle(3), { kind: 'activated', tabId: 5, url: CONSOLE })).toEqual({ action: 'bind', tabId: 5 });
  });
  it('keeps when the already-bound console tab is re-activated', () => {
    expect(decideBinding(idle(5), { kind: 'activated', tabId: 5, url: CONSOLE })).toEqual({ action: 'keep' });
  });
  it('never rebinds while in-flight (automation wins)', () => {
    expect(
      decideBinding({ controlledTabId: 3, inFlight: true }, { kind: 'activated', tabId: 5, url: CONSOLE }),
    ).toEqual({ action: 'keep' });
  });
  it('activating a non-console tab keeps an existing binding, else inactive', () => {
    expect(decideBinding(idle(3), { kind: 'activated', tabId: 9, url: OTHER })).toEqual({ action: 'keep' });
    expect(decideBinding(idle(undefined), { kind: 'activated', tabId: 9, url: OTHER })).toEqual({ action: 'inactive' });
  });
  it('unbinds when the bound tab navigates to a non-console url', () => {
    expect(decideBinding(idle(5), { kind: 'updated', tabId: 5, url: OTHER })).toEqual({ action: 'unbind' });
    expect(decideBinding(idle(5), { kind: 'updated', tabId: 5, url: CONSOLE })).toEqual({ action: 'keep' });
    expect(decideBinding(idle(5), { kind: 'updated', tabId: 7, url: OTHER })).toEqual({ action: 'keep' });
  });
  it('unbinds when the bound tab is removed', () => {
    expect(decideBinding(idle(5), { kind: 'removed', tabId: 5 })).toEqual({ action: 'unbind' });
    expect(decideBinding(idle(5), { kind: 'removed', tabId: 7 })).toEqual({ action: 'keep' });
  });
});

describe('isLinkStale', () => {
  it('is stale only after more than intervalMs of silence', () => {
    expect(isLinkStale(1000, 1000 + 45_000, 45_000)).toBe(false);
    expect(isLinkStale(1000, 1000 + 45_001, 45_000)).toBe(true);
  });
});
