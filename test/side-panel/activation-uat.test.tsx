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
// The shared Composer locks by making its contenteditable editor non-editable
// (`contentEditable={!disabled}`) — the faithful "input locked" signal (its send
// button also gates on non-empty text, so it can't stand in for the lock).
const inputLocked = (c: Element) =>
  (c.querySelector('[role="textbox"]') as HTMLElement | null)?.getAttribute('contenteditable') === 'false';
const placeholder = (c: Element) =>
  (c.querySelector('[role="textbox"]') as HTMLElement | null)?.getAttribute('data-placeholder');

const NON_TENANT_TAB = { id: 9, url: 'https://example.com/some/page' };

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
    expect(inputLocked(h.container)).toBe(true);

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
    expect(inputLocked(h.container)).toBe(false);

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
    expect(inputLocked(h.container)).toBe(false);
    expect(txt(h.container)).toContain('page unavailable');
  });

  it('cold worker stall → auto-retries once (upgrade budget), then blocked; Retry re-drives', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true }); // worker gate active; cold (no live worker at reset)
    await settle();
    const g0 = h.posted.filter((m) => m.type === 'gate_blocked').length;
    // First cold stall covers the upgrade/recycle handoff (30s budget). The bounded
    // auto-retry re-drives provisioning (re-posts gate_blocked) instead of immediately
    // surfacing "xcsh didn't start".
    jest.advanceTimersByTime(30_000);
    await settle();
    expect(h.posted.filter((m) => m.type === 'gate_blocked').length).toBeGreaterThan(g0); // auto-retry re-drove
    expect(txt(h.container)).not.toContain("xcsh didn't start"); // still trying, not a dead-end
    // Auto-retry budget spent → the second stall stays blocked with the actionable Retry.
    jest.advanceTimersByTime(30_000);
    await settle();
    expect(txt(h.container)).toContain("xcsh didn't start");
    expect(inputLocked(h.container)).toBe(true);
    const before = h.posted.filter((m) => m.type === 'gate_blocked').length;
    fireEvent.click(h.container.querySelector('.ov-retry') as HTMLButtonElement);
    await settle();
    expect(h.posted.filter((m) => m.type === 'gate_blocked').length).toBeGreaterThan(before);
  });

  // Re-homed from panel-routing-uat's old "#180 not-connected" case: a host that
  // never reports connected is not a transient "starting" — the bridge gate hard-
  // stalls to `disconnected`. The overlay stays up with the actionable bridge-
  // stalled line so the user knows to start the CLI, and input stays locked.
  it('bridge stall → disconnected: overlay stays with an actionable line, input locked', async () => {
    const h = mount(F5_TAB);
    await settle(); // boot → bridge active; status never arrives
    expect(txt(h.container)).toContain('getting ready…'); // readying while the bridge is in flight
    expect(inputLocked(h.container)).toBe(true);
    jest.advanceTimersByTime(10_000); // bridge hard timeout → disconnected
    await settle();
    expect(txt(h.container)).toContain('xcsh not connected — start the CLI'); // overlay stays, actionable
    expect(inputLocked(h.container)).toBe(true); // composer stays locked
  });

  // Recovery: after the bridge hard-stalls to `disconnected`, a later
  // {status, connected:true} (xcsh finally started) must re-gate the tab so the
  // sequence restarts — not be ignored until a manual tab refocus.
  it('disconnected → status connected re-gates and drives on to ready', async () => {
    const h = mount(F5_TAB);
    await settle();
    jest.advanceTimersByTime(10_000); // bridge hard timeout → disconnected
    await settle();
    expect(txt(h.container)).toContain('xcsh not connected — start the CLI');

    h.push({ type: 'status', connected: true }); // xcsh started → re-gate the whole sequence
    await settle();
    expect(txt(h.container)).not.toContain('xcsh not connected — start the CLI'); // left disconnected
    expect(txt(h.container)).toContain('starting worker…'); // fresh run: bridge passed, worker active

    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] });
    await settle();
    const runId = lastReqId(h.posted);
    expect(typeof runId).toBe('number');
    h.push({ type: 'page_context', snapshot: { title: 'Origin Pools', path: '/pools' }, reqId: runId });
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…');
    expect(inputLocked(h.container)).toBe(false); // recovered all the way to ready
  });

  // Inactive path: a tab whose URL does not resolve to an F5 XC tenant never gates.
  // No overlay, composer usable, default placeholder — the panel is simply idle.
  it('non-tenant tab is inactive: no overlay, input enabled, default placeholder', async () => {
    const h = mount(NON_TENANT_TAB);
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…');
    expect(txt(h.container)).not.toContain('starting worker…');
    expect(inputLocked(h.container)).toBe(false);
    expect(placeholder(h.container)).toBe('ask xcsh about this page…');
  });

  // Worker recovery via a `bridges` frame (not the Retry button): with the worker
  // gate active (status connected, no worker yet), a bridges frame that lists this
  // tab's tenant as live passes the worker gate and drives on toward page/ready.
  it('worker gate passes via a bridges frame and proceeds toward ready', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true }); // bridge passes → worker active
    await settle();
    expect(txt(h.container)).toContain('starting worker…'); // worker gate in flight

    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] }); // this tab's worker is live
    await settle();
    expect(txt(h.container)).not.toContain('starting worker…'); // left the worker gate
    const runId = lastReqId(h.posted);
    expect(typeof runId).toBe('number'); // page gate now active → snapshot requested
    expect(h.posted.some((m) => m.type === 'get_page_context' && m.reqId === runId)).toBe(true);
  });

  // Positive companion to the superseded-run case: the page gate passes ONLY for a
  // page_context whose reqId equals the current run's reqId — a matching frame
  // resolves the gate and reveals the panel.
  it('page gate passes for a page_context whose reqId matches the current run', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true }); // bridge passes → worker active
    await settle();
    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] }); // worker passes → page active
    await settle();
    const runId = lastReqId(h.posted) as number;
    expect(typeof runId).toBe('number');
    expect(txt(h.container)).toContain('getting ready…'); // page still pending
    h.push({ type: 'page_context', snapshot: { title: 'Origin Pools', path: '/pools' }, reqId: runId }); // MATCHES
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…'); // matching reqId → page passes
    expect(inputLocked(h.container)).toBe(false);
  });

  // Recovery: a tab's worker dying mid-session (a `bridges` frame that no longer
  // lists its tenant) while the panel is `ready` must re-gate — drop back to the
  // readying overlay, lock input, and re-drive provisioning (#183). It must NOT
  // silently stay "ready" pointing at a dead worker (the same-tab soft-refresh
  // guard, #175, must not swallow this recovery).
  it('worker vanishing while ready re-gates to recover (not stuck ready on a dead worker)', async () => {
    const h = mount(F5_TAB);
    await settle();
    h.push({ type: 'status', connected: true });
    await settle();
    h.push({ type: 'bridges', tenants: [{ tenant: F5_KEY, env: 'production' }] });
    await settle();
    const runId = lastReqId(h.posted) as number;
    h.push({ type: 'page_context', snapshot: { title: 'Origin Pools', path: '/pools' }, reqId: runId });
    await settle();
    expect(txt(h.container)).not.toContain('getting ready…'); // reached ready
    expect(inputLocked(h.container)).toBe(false);
    const blockedBefore = h.posted.filter((m) => m.type === 'gate_blocked').length;

    h.push({ type: 'bridges', tenants: [] }); // this tab's worker vanished
    await settle();
    expect(txt(h.container)).toContain('getting ready…'); // overlay is back (re-gated)
    expect(inputLocked(h.container)).toBe(true); // input locked again
    expect(h.posted.filter((m) => m.type === 'gate_blocked').length).toBeGreaterThan(blockedBefore); // reprovision re-driven
  });
});
