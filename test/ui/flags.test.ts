import { describe, expect, it } from 'bun:test';
import { DEFAULT_FLAGS, isEnabled } from '../../src/ui/flags';

describe('feature flags', () => {
  it('defaults deferred features OFF', () => {
    expect(DEFAULT_FLAGS.overlaysArrow).toBe(false);
    expect(DEFAULT_FLAGS.overlaysUnderline).toBe(false);
    // Every declared flag defaults off — asserted over the record rather than by
    // name, so retiring a shipped feature's flag can't leave a stale assertion.
    expect(Object.values(DEFAULT_FLAGS).every((v) => v === false)).toBe(true);
  });
  it('honors overrides', () => {
    expect(isEnabled('overlaysArrow')).toBe(false);
    expect(isEnabled('overlaysArrow', { overlaysArrow: true })).toBe(true);
  });
});
