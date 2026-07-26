/**
 * The `skills` reply carries no turn id, so the SW routes it by the SOCKET the
 * request went out on. Bridge ports are a REUSABLE POOL (19222–19241), which makes
 * the bookkeeping safety-critical: a waiter that outlives its socket can receive a
 * later, unrelated worker's reply — the cross-tab/cross-tenant delivery #33/#166
 * guard against. That is why this lives in a pure module instead of inline in
 * service-worker.ts (which runs side-effects at import and can't be unit-tested).
 * See #340.
 */
import { describe, expect, it } from 'bun:test';
import { SkillsWaiters } from '../src/skills-waiters';

type Panel = { id: string };
const a: Panel = { id: 'a' };
const b: Panel = { id: 'b' };

describe('SkillsWaiters', () => {
  it('delivers to the panel that asked, exactly once', () => {
    const w = new SkillsWaiters<Panel>();
    w.add(19222, a);
    expect(w.take(19222)).toEqual([a]);
    // The reply has been consumed; a duplicate frame must not fire again.
    expect(w.take(19222)).toEqual([]);
  });

  it('delivers to every panel waiting on the SAME socket (they share a worker)', () => {
    const w = new SkillsWaiters<Panel>();
    w.add(19222, a);
    w.add(19222, b);
    expect(new Set(w.take(19222))).toEqual(new Set([a, b]));
  });

  it('never delivers to a panel waiting on a DIFFERENT socket', () => {
    const w = new SkillsWaiters<Panel>();
    w.add(19222, a);
    w.add(19223, b);
    expect(w.take(19223)).toEqual([b]);
    expect(w.take(19222)).toEqual([a]);
  });

  it('forgets a disconnected panel across every socket it was waiting on', () => {
    const w = new SkillsWaiters<Panel>();
    w.add(19222, a);
    w.add(19223, a);
    w.add(19223, b);
    w.forgetPanel(a);
    expect(w.take(19222)).toEqual([]);
    expect(w.take(19223)).toEqual([b]);
  });

  it('forgets a dead socket, so a REUSED port cannot deliver to the old waiter', () => {
    const w = new SkillsWaiters<Panel>();
    w.add(19222, a);
    // The socket dies. The port returns to the pool and a different worker — possibly
    // a different tenant — is provisioned onto it, then answers its own list_skills.
    w.forgetPort(19222);
    expect(w.take(19222)).toEqual([]);
  });

  it('leaves no empty sets behind (the map does not grow unboundedly)', () => {
    const w = new SkillsWaiters<Panel>();
    w.add(19222, a);
    w.take(19222);
    expect(w.trackedPorts()).toBe(0);
    w.add(19223, b);
    w.forgetPanel(b);
    expect(w.trackedPorts()).toBe(0);
    w.add(19224, a);
    w.forgetPort(19224);
    expect(w.trackedPorts()).toBe(0);
  });
});
