import { describe, expect, it } from 'bun:test';
import { DEFAULT_FLAGS, isEnabled } from '../../src/ui/flags';

describe('feature flags', () => {
  it('defaults deferred features OFF', () => {
    expect(DEFAULT_FLAGS.references).toBe(false);
    expect(DEFAULT_FLAGS.overlaysArrow).toBe(false);
  });
  it('honors overrides', () => {
    expect(isEnabled('references')).toBe(false);
    expect(isEnabled('references', { references: true })).toBe(true);
  });
});
