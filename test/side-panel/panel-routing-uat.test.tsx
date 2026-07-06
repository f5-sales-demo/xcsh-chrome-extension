/**
 * Automated UAT for the panel↔SW routing WIRING (#166). The pure decisions
 * (resolveChatPort tenant guard, staleTabPorts, contextTabFor, gateBlockEvidence)
 * are unit-tested elsewhere; this file exercises the LIVE `usePanel` hook end to
 * end through a controllable `chrome` stub and asserts the messages it actually
 * emits to the service worker — the integration seam that a pure test can't reach
 * and where the earlier regression slipped through.
 *
 * We render a tiny harness that calls the real `usePanel()` and captures its API,
 * then drive it: push SW→panel frames onto the port, fire tab activations, and
 * assert the panel's outbound frames carry the right tab + tenant identity.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { usePanel } from '../../src/side-panel/use-panel';

type Posted = Record<string, unknown>;

interface Harness {
  posted: Posted[];
  pushToPanel: (m: unknown) => void;
  fireActivated: (tabId: number) => void;
  fireUpdated: (tabId: number, url: string) => void;
  api: () => ReturnType<typeof usePanel>;
}

const F5_PROD_TAB = { id: 7, url: 'https://f5-amer-ent.console.ves.volterra.io/web/home' };
const GLOBEX_TAB = { id: 8, url: 'https://globex.console.ves.volterra.io/web/home' };
const F5_KEY = 'f5-amer-ent|production';

// Build a controllable chrome stub + a harness component that exposes usePanel's API.
function mount(activeTab: { id: number; url: string }, tabsById: Record<number, { id: number; url: string }>): Harness {
  const posted: Posted[] = [];
  let onMsg: (m: unknown) => void = () => {};
  const activated: Array<(info: { tabId: number }) => void> = [];
  const updated: Array<(tabId: number, info: { url?: string }) => void> = [];
  const store: Record<string, unknown> = {};
  const listener = <T,>(bucket: T[]) => ({ addListener: (fn: T) => bucket.push(fn), removeListener: () => {} });

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
        postMessage: (m: Posted) => posted.push(m),
        disconnect: () => {},
      }),
    },
    tabs: {
      onActivated: listener(activated),
      onUpdated: listener(updated),
      query: () => Promise.resolve(activeTab ? [activeTab] : []),
      get: (id: number) => (tabsById[id] ? Promise.resolve(tabsById[id]) : Promise.reject(new Error('no tab'))),
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

  let captured!: ReturnType<typeof usePanel>;
  function HarnessComponent() {
    captured = usePanel();
    return null;
  }
  render(<HarnessComponent />);
  return {
    posted,
    pushToPanel: (m) => onMsg(m),
    fireActivated: (tabId) => {
      for (const fn of activated) fn({ tabId });
    },
    fireUpdated: (tabId, url) => {
      for (const fn of updated) fn(tabId, { url });
    },
    api: () => captured,
  };
}

const lastOfType = (posted: Posted[], type: string): Posted | undefined =>
  [...posted].reverse().find((m) => m.type === type);

let prevChrome: unknown;
beforeEach(() => {
  prevChrome = (globalThis as { chrome?: unknown }).chrome;
});
afterEach(() => {
  cleanup();
  (globalThis as { chrome?: unknown }).chrome = prevChrome;
});

describe('panel routing UAT (#166)', () => {
  it('RC-1/RC-2: a send carries the panel tab id AND its current session key', async () => {
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB });
    // SW reports the tenant live + connected, so the gate unblocks this tab.
    h.pushToPanel({ type: 'status', connected: true });
    h.pushToPanel({ type: 'bridges', tenants: [{ tenant: F5_KEY, contextBound: true }] });
    await waitFor(() => expect(h.api().state.inputBlocked).toBe(false));

    h.api().sendMessage('who are you?');

    await waitFor(() => expect(lastOfType(h.posted, 'chat_request')).toBeDefined());
    const req = lastOfType(h.posted, 'chat_request');
    expect(req?.tabId).toBe(7);
    expect(req?.sessionKey).toBe(F5_KEY);
  });

  it('RC-3: a valid tenant tab with no live worker emits gate_blocked{tabId,key} and blocks input', async () => {
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB });
    // Connected, but NO bridge advertises this tenant → gate must block + signal.
    h.pushToPanel({ type: 'status', connected: true });
    h.pushToPanel({ type: 'bridges', tenants: [] });

    await waitFor(() => expect(lastOfType(h.posted, 'gate_blocked')).toBeDefined());
    const blocked = lastOfType(h.posted, 'gate_blocked');
    expect(blocked?.tabId).toBe(7);
    expect(blocked?.key).toBe(F5_KEY);
    await waitFor(() => expect(h.api().state.inputBlocked).toBe(true));
  });

  it('RC-2: switching to another tenant tab re-fetches page context for the FOCUSED tab', async () => {
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB, 8: GLOBEX_TAB });
    h.pushToPanel({ type: 'status', connected: true });
    h.pushToPanel({
      type: 'bridges',
      tenants: [
        { tenant: F5_KEY, contextBound: true },
        { tenant: 'globex|production', contextBound: true },
      ],
    });
    await waitFor(() => expect(h.api().state.inputBlocked).toBe(false));
    const before = h.posted.length;

    h.fireActivated(8); // user focuses the globex tab

    await waitFor(() => {
      const ctx = h.posted.slice(before).find((m) => m.type === 'get_page_context');
      expect(ctx?.tabId).toBe(8);
    });
  });

  it('an agent navigating its OWN tab mid-turn does NOT suspend the turn (reply keeps rendering)', async () => {
    // Regression for the "response not shown" bug: a navigation/tool turn changes
    // the tab's URL, which fires onUpdated → gateToActiveTab. That must not suspend
    // the in-flight turn (same tab), or its post-navigation stream is dropped by the
    // active.id guard and the panel shows only a spinner with no text.
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB });
    h.pushToPanel({ type: 'status', connected: true });
    h.pushToPanel({ type: 'bridges', tenants: [{ tenant: F5_KEY, contextBound: true }] });
    await waitFor(() => expect(h.api().state.inputBlocked).toBe(false));

    h.api().sendMessage('navigate to health checks');
    await waitFor(() => expect(h.api().state.active).toBeTruthy());
    const turnId = lastOfType(h.posted, 'chat_request')?.id as string;

    // First delta streams in fine.
    h.pushToPanel({ type: 'chat_delta', id: turnId, seq: 0, delta: 'Navigating' });
    await waitFor(() => expect(h.api().state.active?.state.text).toBe('Navigating'));

    // The agent navigates THIS tab — its URL changes, firing onUpdated for tab 7.
    h.fireUpdated(7, 'https://f5-amer-ent.console.ves.volterra.io/web/other');

    // The turn must still be active (not suspended) so the rest of the reply renders.
    await waitFor(() => expect(h.api().state.active?.id).toBe(turnId));
    h.pushToPanel({ type: 'chat_delta', id: turnId, seq: 1, delta: ' to Health Checks.' });
    await waitFor(() => expect(h.api().state.active?.state.text).toBe('Navigating to Health Checks.'));
  });

  it('#180: a connected tenant tab with no worker shows "starting xcsh…", cleared once it binds', async () => {
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB });
    h.pushToPanel({ type: 'status', connected: true });
    h.pushToPanel({ type: 'bridges', tenants: [] }); // connected, but no worker for this tenant yet

    await waitFor(() => expect(h.api().state.provisioning).toBe(true));
    expect(h.api().placeholder).toBe('starting xcsh for this tab…');
    expect(h.api().state.inputBlocked).toBe(true);

    // Worker binds → the tenant goes live → provisioning clears and input unblocks.
    h.pushToPanel({ type: 'bridges', tenants: [{ tenant: F5_KEY, contextBound: true }] });
    await waitFor(() => expect(h.api().state.provisioning).toBe(false));
    expect(h.api().state.inputBlocked).toBe(false);
    expect(h.api().placeholder).toBe('ask xcsh about this page…');
  });

  it('#180: a blocked tab that is NOT connected does not show "starting" (real connection issue)', async () => {
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB });
    h.pushToPanel({ type: 'status', connected: false });
    h.pushToPanel({ type: 'bridges', tenants: [] });

    await waitFor(() => expect(h.api().state.inputBlocked).toBe(true));
    expect(h.api().state.provisioning).toBe(false);
    expect(h.api().placeholder).toBe('ask xcsh about this page…');
  });

  it('switching to a DIFFERENT tab mid-turn DOES suspend (no cross-tab bleed)', async () => {
    // The other direction of the same guard: a genuine tab switch must still
    // suspend the in-flight turn so tab 8 can start its own and tab 7's stream is
    // dropped (preserved in storage, not bled into tab 8).
    const h = mount(F5_PROD_TAB, { 7: F5_PROD_TAB, 8: GLOBEX_TAB });
    h.pushToPanel({ type: 'status', connected: true });
    h.pushToPanel({
      type: 'bridges',
      tenants: [
        { tenant: F5_KEY, contextBound: true },
        { tenant: 'globex|production', contextBound: true },
      ],
    });
    await waitFor(() => expect(h.api().state.inputBlocked).toBe(false));

    h.api().sendMessage('do a thing');
    await waitFor(() => expect(h.api().state.active).toBeTruthy());

    h.fireActivated(8); // user switches to the globex tab

    await waitFor(() => expect(h.api().state.active).toBeNull());
  });
});
