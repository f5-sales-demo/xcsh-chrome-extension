import { describe, expect, it } from 'bun:test';
import { createBus } from '../../src/ui/bus';

describe('ui bus', () => {
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
