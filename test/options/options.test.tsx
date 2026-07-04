import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/preact';

// Minimal `chrome` stub installed BEFORE importing options.tsx, because the
// Options component fires chrome.runtime.sendMessage (status_request +
// bridges_request) and chrome.storage.local.get on mount. This substitutes for
// the interactive "load unpacked in Chrome" check (brief Step 5), which needs a
// human + a running xcsh CLI bridge and cannot run headless. It only proves the
// status/diagnostics/bridges shell mounts without a wiring/crash-on-mount error.
// (The component lives in src/options/App; the src/options.tsx entry is kept
// export-free so its bundle loads as a classic script — not tested here.)
// Async reads resolve empty: sendMessage invokes its callback with undefined
// (no lastError) and storage.local.get resolves {}.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    lastError: undefined,
    sendMessage: (_msg: unknown, cb?: (resp: unknown) => void) => cb?.(undefined),
    onMessage: { addListener: () => {}, removeListener: () => {} },
  },
  storage: { local: { get: () => Promise.resolve({}) } },
};

const { Options } = await import('../../src/options/App');

afterEach(() => cleanup());

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
