import { describe, expect, it } from 'bun:test';
import { runDispatch, type ToolHandler } from '../src/dispatch';

describe('runDispatch', () => {
  it('throws for a tool with no handler', async () => {
    await expect(runDispatch('nope', {}, {}, 1)).rejects.toThrow('unknown tool: nope');
  });

  it('validates params before calling the handler (and does not call it on bad input)', async () => {
    let called = false;
    const handlers: Record<string, ToolHandler> = {
      click: () => {
        called = true;
        return 'ok';
      },
    };
    await expect(runDispatch('click', {}, handlers, 1)).rejects.toThrow('click'); // ref required
    expect(called).toBe(false);
  });

  it('calls the handler with the params when valid and returns its result', async () => {
    const handlers: Record<string, ToolHandler> = {
      click: (p) => `clicked ${(p as { ref: string }).ref}`,
    };
    expect(await runDispatch('click', { ref: 'e7' }, handlers, 1)).toBe('clicked e7');
  });

  it('treats missing params as {} for an empty-schema tool', async () => {
    const handlers: Record<string, ToolHandler> = { ping: () => ({ ok: true }) };
    expect(await runDispatch('ping', undefined, handlers, 1)).toEqual({ ok: true });
  });

  it('passes the target tabId to the handler', async () => {
    let seen: number | undefined;
    // `ping` is a real, empty-schema tool, so it passes contract validation;
    // spy its handler to assert the dispatched tabId reaches the 2nd arg.
    const handlers: Record<string, ToolHandler> = {
      ping: (_p, tabId) => {
        seen = tabId;
        return { ok: true };
      },
    };
    await runDispatch('ping', {}, handlers, 77);
    expect(seen).toBe(77);
  });

  // Regression (T5 review, #135): with the tab unset (cold start / post-suspension),
  // a tab-INDEPENDENT tool must still run — the caller no longer eager-gates on the tab.
  it('runs a tab-independent handler when dispatched with an unset (undefined) tabId', async () => {
    let ran = false;
    const handlers: Record<string, ToolHandler> = {
      ping: (_p, tabId) => {
        ran = true;
        return { ok: true, tabId };
      },
    };
    // No 4th arg → tabId is undefined, exactly as at cold-start before navigate.
    expect(await runDispatch('ping', {}, handlers)).toEqual({ ok: true, tabId: undefined });
    expect(ran).toBe(true);
  });

  // Regression (T5 review, #135): a tab-USING handler that validates its tab param
  // must still throw when dispatched with no tab — unchanged pre-Task-5 behavior.
  it('lets a tab-using handler throw when dispatched with an unset (undefined) tabId', async () => {
    // Mirror the SW's per-handler guard: validate on the PARAM, not a module global.
    const requireTab = (tabId?: number): number => {
      if (tabId === undefined) throw new Error('no target tab — call navigate first');
      return tabId;
    };
    const handlers: Record<string, ToolHandler> = {
      ping: (_p, tabId) => ({ ok: true, tabId: requireTab(tabId) }),
    };
    await expect(runDispatch('ping', {}, handlers)).rejects.toThrow('no target tab — call navigate first');
  });
});
