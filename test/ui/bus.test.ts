import { describe, expect, it } from 'bun:test';
import { createBus, PortBus } from '../../src/ui/bus';

describe('ui bus', () => {
  it('replays initial connection snapshots to late subscribers without replaying chat', () => {
    const listeners = new Set<(message: unknown) => void>();
    const port = {
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.add(fn),
        removeListener: (fn: (message: unknown) => void) => listeners.delete(fn),
      },
    } as unknown as chrome.runtime.Port;
    const bus = new PortBus(port);
    const emit = (message: unknown) => {
      for (const fn of listeners) fn(message);
    };
    emit({ type: 'status', connected: false });
    emit({ type: 'status', connected: true });
    emit({ type: 'bridges', tenants: [{ tenant: 'example-corp|production' }] });
    emit({ type: 'chat_delta', text: 'already consumed' });
    const seen: unknown[] = [];
    const off = bus.on((message) => seen.push(message));
    expect(seen).toEqual([
      { type: 'status', connected: true },
      { type: 'bridges', tenants: [{ tenant: 'example-corp|production' }] },
    ]);
    emit({ type: 'chat_delta', text: 'new output' });
    expect(seen).toHaveLength(3);
    off();
    emit({ type: 'status', connected: false });
    expect(seen).toHaveLength(3);
  });

  it('delivers events to subscribers by type', () => {
    const bus = createBus<{ type: 'a'; n: number } | { type: 'b' }>();
    const seen: number[] = [];
    bus.on('a', (e) => seen.push((e as { n: number }).n));
    bus.emit({ type: 'a', n: 1 });
    bus.emit({ type: 'b' });
    bus.emit({ type: 'a', n: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribes', () => {
    const bus = createBus<{ type: 'a' }>();
    let count = 0;
    const off = bus.on('a', () => count++);
    bus.emit({ type: 'a' });
    off();
    bus.emit({ type: 'a' });
    expect(count).toBe(1);
  });
});
