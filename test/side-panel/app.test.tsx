import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/preact';
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
/** Frames the panel posted to the SW, and a hook to push SW→panel frames back. */
const bus: { posted: Record<string, unknown>[]; push: (m: unknown) => void } = {
  posted: [],
  push: () => {},
};
const chromeStub = {
  runtime: {
    connect: () => ({
      onMessage: {
        addListener: (cb: (m: unknown) => void) => {
          bus.push = cb;
        },
        removeListener: () => {},
      },
      postMessage: (m: Record<string, unknown>) => bus.posted.push(m),
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
  bus.posted = [];
  bus.push = () => {};
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
    // The shared Composer's editor is a contenteditable div (role=textbox), with
    // the prompt on `data-placeholder` (not a textarea `placeholder`).
    const input = container.querySelector<HTMLElement>('[role="textbox"][aria-label="Message input"]');
    expect(input?.getAttribute('data-placeholder')).toMatch(/ask xcsh/i);
  });
});

describe('side-panel skills menu', () => {
  it('shows no + button until the engine reports skills', () => {
    const { container } = render(<App />);
    expect(container.querySelector('[aria-label="Add context"]')).toBeNull();
  });

  it('renders reported skills in the + submenu and prefills /name without sending', async () => {
    const { container } = render(<App />);

    // The SW delivers the engine's id-less `skills` reply to this panel.
    await act(async () => {
      bus.push({
        type: 'skills',
        skills: [
          { name: 'competitive', description: 'F5 XC battlecards' },
          { name: 'roi-calculator', description: 'ROI / TCO' },
        ],
      });
    });

    const plus = container.querySelector<HTMLElement>('[aria-label="Add context"]');
    expect(plus).toBeTruthy();
    await act(async () => {
      plus?.click();
    });
    const skillsItem = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
      /^Skills/.test(el.textContent ?? ''),
    );
    expect(skillsItem).toBeTruthy();
    await act(async () => {
      skillsItem?.click();
    });
    const pick = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
      /competitive/.test(el.textContent ?? ''),
    );
    expect(pick).toBeTruthy();
    await act(async () => {
      pick?.click();
    });

    // Prefilled for the user to add input — never auto-sent.
    const editor = container.querySelector<HTMLElement>('[role="textbox"][aria-label="Message input"]');
    expect(editor?.textContent).toBe('/competitive ');
    expect(bus.posted.filter((m) => m.type === 'chat_request')).toHaveLength(0);
  });
});

describe('side-panel slash-command menu', () => {
  it('offers the curated commands and SENDS the picked one (no prefill)', async () => {
    const { container } = render(<App />);

    const slash = container.querySelector<HTMLElement>('[aria-label="Slash commands"]');
    expect(slash).toBeTruthy();
    await act(async () => {
      slash?.click();
    });
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (el) => el.textContent ?? '',
    );
    expect(items.some((t) => /\/status/.test(t))).toBe(true);
    expect(items.some((t) => /\/context/.test(t))).toBe(true);
    expect(items.some((t) => /\/resources/.test(t))).toBe(true);

    const pick = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
      /\/status/.test(el.textContent ?? ''),
    );
    await act(async () => {
      pick?.click();
    });

    // Submitted as a turn, matching the VS Code webview — a slash command is complete
    // as written, unlike a skill (`/name ` + args) which the Office pane prefills.
    const prompts = bus.posted.filter((m) => m.type === 'chat_request');
    expect(prompts).toHaveLength(1);
    expect((prompts[0] as { text?: string }).text).toBe('/status');
    // Nothing left sitting in the editor.
    const editor = container.querySelector<HTMLElement>('[role="textbox"][aria-label="Message input"]');
    expect(editor?.textContent).toBe('');
  });
});
