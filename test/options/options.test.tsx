import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { Options } from '../../src/options/App';

// Minimal `chrome` stub for the mount smoke test. The Options component fires
// chrome.runtime.sendMessage (status_request + bridges_request) and
// chrome.storage.local.get at RENDER (not at import), so the stub is installed
// per-test in beforeEach and the previous global restored in afterEach. This
// isolation is load-bearing: a sibling test file (side-panel/app) also assigns
// globalThis.chrome, and Bun evaluates every test module before running any
// test — a shared module-top-level assignment lets file order clobber the stub
// (observed as a CI-only failure). Scoping per-test makes the suite
// order-independent. Async reads resolve empty: sendMessage invokes its callback
// with undefined (no lastError) and storage.local.get resolves {}.
const chromeStub = {
  runtime: {
    lastError: undefined,
    sendMessage: (_msg: unknown, cb?: (resp: unknown) => void) => cb?.(undefined),
    onMessage: { addListener: () => {}, removeListener: () => {} },
  },
  storage: { local: { get: () => Promise.resolve({}) } },
};

let prevChrome: unknown;
beforeEach(() => {
  prevChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = chromeStub;
});
afterEach(() => {
  cleanup();
  (globalThis as { chrome?: unknown }).chrome = prevChrome;
});

describe('options page shell', () => {
  it('renders status, diagnostics, and bridges sections with a minimal chrome stub', async () => {
    const { container, getByText } = render(<Options />);

    // Static shell renders synchronously.
    expect(container.querySelector('h1')?.textContent).toContain('xcsh');
    expect(getByText('Console domains')).toBeTruthy();
    expect(getByText('Suspension diagnostics')).toBeTruthy();
    expect(getByText('Discovered bridges')).toBeTruthy();

    // Async reads wire through: empty diag buffer summarizes to all-zeros,
    // empty bridges reply renders "(none)", and status resolves to disconnected.
    await waitFor(() => {
      expect(getByText(/restarts 0 · suspends 0/)).toBeTruthy();
    });
    expect(getByText('(none)')).toBeTruthy();
    expect(getByText(/Not connected/)).toBeTruthy();
  });
});
