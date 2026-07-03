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
});
