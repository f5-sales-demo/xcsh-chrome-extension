import { describe, expect, it } from 'bun:test';
import {
  consumeColdOnRoute,
  consumeOnRegister,
  markProvisionSent,
  newProvisionState,
  PROVISION_TTL_MS,
  reapTab,
} from '../src/ttft-provision';

describe('ttft-provision', () => {
  it('measures provision→register and marks the sid cold when within the TTL', () => {
    const s = newProvisionState();
    markProvisionSent(s, 'tab-7', 1000);
    expect(consumeOnRegister(s, 'tab-7', 1500)).toBe(500);
    // entry consumed once…
    expect(consumeOnRegister(s, 'tab-7', 1600)).toBeNull();
    // …and the sid is now flagged cold for the next route (consume-once).
    expect(consumeColdOnRoute(s, 'tab-7')).toBe(true);
    expect(consumeColdOnRoute(s, 'tab-7')).toBe(false);
  });

  it('returns null for a register with no pending provision (no cold mark)', () => {
    const s = newProvisionState();
    expect(consumeOnRegister(s, 'tab-9', 1000)).toBeNull();
    expect(consumeColdOnRoute(s, 'tab-9')).toBe(false);
  });

  it('accepts a register exactly at the TTL boundary (inclusive)', () => {
    const s = newProvisionState();
    markProvisionSent(s, 'tab-1', 0);
    expect(consumeOnRegister(s, 'tab-1', PROVISION_TTL_MS)).toBe(PROVISION_TTL_MS);
    expect(consumeColdOnRoute(s, 'tab-1')).toBe(true);
  });

  it('drops a stale provision past the TTL: no measurement, no cold mark', () => {
    const s = newProvisionState();
    markProvisionSent(s, 'tab-2', 0);
    expect(consumeOnRegister(s, 'tab-2', PROVISION_TTL_MS + 1)).toBeNull();
    // the stale entry is cleared (a re-register does not resurrect it) and no cold flag set
    expect(consumeOnRegister(s, 'tab-2', PROVISION_TTL_MS + 2)).toBeNull();
    expect(consumeColdOnRoute(s, 'tab-2')).toBe(false);
  });

  it('reapTab clears both a pending provision and a pending cold flag', () => {
    const s = newProvisionState();
    markProvisionSent(s, 'tab-3', 100);
    // establish a cold flag on a different sid, then reap it
    markProvisionSent(s, 'tab-4', 100);
    consumeOnRegister(s, 'tab-4', 200);
    reapTab(s, 'tab-3');
    reapTab(s, 'tab-4');
    // tab-3 provision gone → a later register is a no-op
    expect(consumeOnRegister(s, 'tab-3', 300)).toBeNull();
    // tab-4 cold flag gone
    expect(consumeColdOnRoute(s, 'tab-4')).toBe(false);
  });
});
