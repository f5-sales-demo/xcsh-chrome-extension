/**
 * End-to-end UAT for tab-activation readiness gating. Drives the real usePanel
 * hook (via <App/>) through a controllable `chrome` stub — the panel-routing-uat
 * pattern — and asserts the overlay, input lock, per-gate timing frames, page-
 * context reqId correlation, soft/hard stall phases, and Retry. Uses jest fake
 * timers so the 5s/15s gate timeouts are deterministic; settle() flushes the
 * Promise microtask queue (fake timers do not fake microtasks).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { App } from '../../src/side-panel/App';

const F5_TAB = { id: 7, url: 'https://f5-amer-ent.console.ves.volterra.io/web/home' };
const F5_KEY = 'f5-amer-ent|production';

function mount(activeTab: { id: number; url: string }) {
  const posted: Record<string, unknown>[] = [];
  let onMsg: (m: unknown) => void = () => {};
  const store: Record<string, unknown> = {};
  const noop = { addListener: () => {}, removeListener: () => {} };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'test-extension-id',
      connect: () => ({
        name: 'xcsh-chat',
        onMessage: {
          addListener: (fn: (m: unknown) => void) => {
            onMsg = fn;
          },
          removeListener: () => {},
        },
        postMessage: (m: Record<string, unknown>) => posted.push(m),
        disconnect: () => {},
      }),
    },
    tabs: {
      onActivated: noop,
      onUpdated: noop,
      query: () => Promise.resolve([activeTab]),
      get: (id: number) => (id === activeTab.id ? Promise.resolve(activeTab) : Promise.reject(new Error('no tab'))),
    },
    storage: {
      local: {
        get: (k: string) => Promise.resolve(typeof k === 'string' ? { [k]: store[k] } : {}),
        set: (o: Record<string, unknown>) => {
          Object.assign(store, o);
          return Promise.resolve();
        },
        remove: (ks: string | string[]) => {
          for (const k of ([] as string[]).concat(ks)) delete store[k];
          return Promise.resolve();
        },
      },
    },
  };
  const { container } = render(<App />);
  return { posted, push: (m: unknown) => onMsg(m), container };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const lastReqId = (posted: Record<string, unknown>[]) =>
  [...posted].reverse().find((m) => m.type === 'get_page_context' && typeof m.reqId === 'number')?.reqId as
    | number
    | undefined;
const txt = (c: Element) => c.textContent ?? '';
const sendDisabled = (c: Element) =>
  (c.querySelector('#send') as HTMLButtonElement | null)?.hasAttribute('disabled') ?? false;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

describe('activation readiness UAT', () => {
  it('overlays + locks input until bridge→worker→page all pass, then reveals the panel', async () => {
    const h = mount(F5_TAB);
    await settle(); // boot reset → bridge active (status not yet received)
    expect(txt(h.container)).toContain('getting ready…');
    expect(sendDisabled(h.container)).toBe(true);

    h.push({ type: 'status', connected: true }); // bridge passes → worker active
    await settle();
    expect(txt(h.container)).toContain('starting worker…');
    expect(h.posted.some((m) => m.type === 'gate_blocked' && m.key === F5_KEY)).toBe(true);

    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] }); // worker passes → page active
    await settle();
    const runId = lastReqId(h.posted);
    expect(typeof runId).toBe('number');
    expect(h.posted.some((m) => m.type === 'get_page_context' && m.reqId === runId)).toBe(true);
    expect(txt(h.container)).toContain('getting ready…'); // page still pending

    h.push({ type: 'page_context', snapshot: { title: 'Origin Pools', path: '/pools' }, reqId: runId });
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…');
    expect(sendDisabled(h.container)).toBe(false);

    const gates = h.posted.filter((m) => m.type === 'activation_timing').map((m) => m.gate);
    expect(gates).toEqual(['bridge', 'worker', 'page']);
  });

  it('ignores a page_context for a superseded run', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true });
    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] });
    await settle();
    const runId = lastReqId(h.posted) as number;
    h.push({ type: 'page_context', snapshot: { title: 'STALE' }, reqId: runId - 1 });
    await settle();
    expect(txt(h.container)).toContain('getting ready…');
    expect(txt(h.container)).not.toContain('STALE');
  });

  it('page stall → degraded (soft): panel usable, chip flags the page', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true });
    await settle();
    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] });
    await settle(); // page active
    jest.advanceTimersByTime(5_000);
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…');
    expect(sendDisabled(h.container)).toBe(false);
    expect(txt(h.container)).toContain('page unavailable');
  });

  it('worker stall → blocked (hard): overlay stays, input locked, Retry re-drives provisioning', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true }); // worker active
    await settle();
    jest.advanceTimersByTime(15_000);
    await settle();
    expect(txt(h.container)).toContain("xcsh didn't start");
    expect(sendDisabled(h.container)).toBe(true);
    const before = h.posted.filter((m) => m.type === 'gate_blocked').length;
    fireEvent.click(h.container.querySelector('.ov-retry') as HTMLButtonElement);
    await settle();
    expect(h.posted.filter((m) => m.type === 'gate_blocked').length).toBeGreaterThan(before);
  });

  // Re-homed from panel-routing-uat's old "#180 not-connected" case: a host that
  // never reports connected is not a transient "starting" — the bridge gate hard-
  // stalls to `disconnected`. Distinct from readying/blocked: the gate-checklist
  // overlay is dismissed for a host-down, but input stays locked.
  it('bridge stall → disconnected: overlay dismissed but input stays locked', async () => {
    const h = mount(F5_TAB);
    await settle(); // boot → bridge active; status never arrives
    expect(txt(h.container)).toContain('getting ready…'); // readying while the bridge is in flight
    expect(sendDisabled(h.container)).toBe(true);
    jest.advanceTimersByTime(10_000); // bridge hard timeout → disconnected
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…'); // overlay gone (host-down, not a checklist)
    expect(sendDisabled(h.container)).toBe(true); // but the composer is still locked
  });
});
