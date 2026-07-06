import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { App } from '../../src/side-panel/App';

// Minimal `chrome` stub for the mount smoke test. usePanel calls
// chrome.runtime.connect / chrome.tabs.* at RENDER (not at import), so the stub
// is installed per-test in beforeEach and the previous global restored in
// afterEach. This isolation is load-bearing: a sibling test file (options) also
// assigns globalThis.chrome, and Bun evaluates every test module before running
// any test — so a shared module-top-level assignment lets file order clobber the
// stub and crash this render (observed as a CI-only failure). Scoping per-test
// makes the suite order-independent.
const listener = { addListener: () => {}, removeListener: () => {} };
const chromeStub = {
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

let prevChrome: unknown;
beforeEach(() => {
  prevChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = chromeStub;
});
afterEach(() => {
  cleanup();
  (globalThis as { chrome?: unknown }).chrome = prevChrome;
});

describe('side-panel App shell', () => {
  it('mounts the shell (context chip + composer input) with a minimal chrome stub', () => {
    const { container } = render(<App />);
    // Scope every assertion to this render's own container, NOT the default
    // body-bound getBy* queries: happy-dom shares one document across the suite,
    // so a leaked composer from another test would make a body-scoped
    // getByPlaceholderText match multiple and throw.
    expect(container.querySelector('.chip')).toBeTruthy();
    const input = container.querySelector<HTMLTextAreaElement>('textarea#input');
    expect(input?.placeholder).toMatch(/ask xcsh/i);
  });
});
