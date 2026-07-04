import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';

// Minimal `chrome` stub installed BEFORE importing App, because usePanel calls
// chrome.runtime.connect / chrome.tabs.* at mount. This substitutes for the
// interactive "load unpacked in Chrome" check (brief Step 7), which needs a
// human + a running xcsh CLI bridge and cannot run headless. It only proves the
// shell mounts without a wiring/crash-on-mount error.
const listener = { addListener: () => {}, removeListener: () => {} };
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    connect: () => ({
      onMessage: { addListener: () => {}, removeListener: () => {} },
      postMessage: () => {},
    }),
  },
  tabs: {
    onActivated: listener,
    onUpdated: listener,
    query: () => Promise.resolve([]),
    get: () => Promise.resolve(undefined),
  },
};

const { App } = await import('../../src/side-panel/App');

afterEach(() => cleanup());

describe('side-panel App shell', () => {
  it('mounts the shell (header mark + composer input) with a minimal chrome stub', () => {
    const { container, getByPlaceholderText } = render(<App />);
    expect(container.querySelector('header .mark')?.textContent).toBe('xcsh');
    expect(getByPlaceholderText(/ask xcsh/i)).toBeTruthy();
  });
});
