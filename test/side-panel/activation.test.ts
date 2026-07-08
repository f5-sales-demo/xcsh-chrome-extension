import { describe, expect, it } from 'bun:test';
import {
  type ActivationPhase,
  type ActivationState,
  activationPhase,
  activationReducer,
  GATES,
  initActivation,
  newlyResolvedGates,
} from '../../src/side-panel/activation';

const reset = (over: Partial<{ tenant: boolean; cold: boolean; connected: boolean; workerLive: boolean }> = {}) =>
  ({ kind: 'reset', tenant: true, cold: true, connected: false, workerLive: false, ...over }) as const;

describe('initActivation', () => {
  it('starts inactive with three pending gates', () => {
    const s = initActivation();
    expect(s.phase).toBe('inactive');
    expect(s.runId).toBe(0);
    expect(GATES.map((g) => s.gates[g].status)).toEqual(['pending', 'pending', 'pending']);
  });
});

describe('reset', () => {
  it('a non-tenant reset is inactive and bumps runId', () => {
    const s = activationReducer(initActivation(), reset({ tenant: false }), 100);
    expect(s.phase).toBe('inactive');
    expect(s.runId).toBe(1);
    expect(s.gates.bridge.status).toBe('pending');
  });

  it('a tenant reset with no signals activates only the bridge gate (readying)', () => {
    const s = activationReducer(initActivation(), reset(), 100);
    expect(s.phase).toBe('readying');
    expect(s.gates.bridge.status).toBe('active');
    expect(s.gates.bridge.startedAt).toBe(100);
    expect(s.gates.worker.status).toBe('pending');
  });

  it('a tenant reset while connected cascades bridge→passed, worker→active', () => {
    const s = activationReducer(initActivation(), reset({ connected: true }), 100);
    expect(s.gates.bridge.status).toBe('passed');
    expect(s.gates.bridge.ms).toBe(0); // startedAt===now on reset
    expect(s.gates.worker.status).toBe('active');
    expect(s.phase).toBe('readying');
  });

  it('a warm reset (connected + workerLive) cascades to page active', () => {
    const s = activationReducer(initActivation(), reset({ connected: true, workerLive: true, cold: false }), 100);
    expect(s.gates.bridge.status).toBe('passed');
    expect(s.gates.worker.status).toBe('passed');
    expect(s.gates.page.status).toBe('active');
    expect(s.cold).toBe(false);
    expect(s.phase).toBe('readying');
  });
});

describe('gate advance events', () => {
  const started = () => activationReducer(initActivation(), reset(), 100); // bridge active

  it('bridge passes with elapsed ms and activates worker', () => {
    const s = activationReducer(started(), { kind: 'bridge' }, 112);
    expect(s.gates.bridge.status).toBe('passed');
    expect(s.gates.bridge.ms).toBe(12);
    expect(s.gates.worker.status).toBe('active');
  });

  it('worker then page reach ready with correct per-gate ms', () => {
    let s = activationReducer(started(), { kind: 'bridge' }, 112);
    s = activationReducer(s, { kind: 'worker' }, 604); // 604-112
    expect(s.gates.worker.ms).toBe(492);
    expect(s.gates.page.status).toBe('active');
    s = activationReducer(s, { kind: 'page' }, 742); // 742-604
    expect(s.gates.page.ms).toBe(138);
    expect(s.phase).toBe('ready');
  });

  it('ignores out-of-order events (page before worker is a no-op)', () => {
    const s = activationReducer(started(), { kind: 'page' }, 200);
    expect(s.gates.page.status).toBe('pending');
    expect(s.phase).toBe('readying');
  });

  it('a duplicate bridge event does not re-stamp ms', () => {
    const one = activationReducer(started(), { kind: 'bridge' }, 112);
    const two = activationReducer(one, { kind: 'bridge' }, 999);
    expect(two.gates.bridge.ms).toBe(12);
    expect(two.gates.worker.status).toBe('active');
  });
});

describe('timeouts (hard vs soft phases)', () => {
  it('bridge timeout → disconnected', () => {
    const s = activationReducer(
      activationReducer(initActivation(), reset(), 100),
      { kind: 'timeout', gate: 'bridge' },
      10_100,
    );
    expect(s.gates.bridge.status).toBe('stalled');
    expect(s.phase).toBe('disconnected');
  });

  it('worker timeout → blocked', () => {
    let s = activationReducer(initActivation(), reset({ connected: true }), 100); // worker active
    s = activationReducer(s, { kind: 'timeout', gate: 'worker' }, 15_100);
    expect(s.phase).toBe('blocked');
  });

  it('page timeout → degraded (soft: bridge+worker passed)', () => {
    let s = activationReducer(initActivation(), reset({ connected: true, workerLive: true }), 100); // page active
    s = activationReducer(s, { kind: 'timeout', gate: 'page' }, 5_100);
    expect(s.gates.page.status).toBe('stalled');
    expect(s.phase).toBe('degraded');
  });

  it('a timeout for a gate that already passed is a no-op', () => {
    let s = activationReducer(initActivation(), reset({ connected: true }), 100); // bridge passed
    s = activationReducer(s, { kind: 'timeout', gate: 'bridge' }, 10_100);
    expect(s.gates.bridge.status).toBe('passed');
    expect(s.phase).toBe('readying');
  });

  it('a timeout for a still-pending gate is a no-op (worker times out while bridge is in flight)', () => {
    const s0 = activationReducer(initActivation(), reset(), 100); // bridge active, worker pending
    expect(s0.gates.worker.status).toBe('pending');
    const s1 = activationReducer(s0, { kind: 'timeout', gate: 'worker' }, 15_100);
    expect(s1.gates.worker.status).toBe('pending'); // pending gate cannot stall
    expect(s1).toEqual(s0); // no-op: whole state unchanged
  });
});

describe('retry', () => {
  it('re-activates a stalled worker gate and returns to readying', () => {
    let s = activationReducer(initActivation(), reset({ connected: true }), 100);
    s = activationReducer(s, { kind: 'timeout', gate: 'worker' }, 15_100);
    expect(s.phase).toBe('blocked');
    s = activationReducer(s, { kind: 'retry' }, 16_000);
    expect(s.gates.worker.status).toBe('active');
    expect(s.gates.worker.startedAt).toBe(16_000);
    expect(s.gates.bridge.status).toBe('passed'); // bridge stays passed
    expect(s.phase).toBe('readying');
  });

  it('retry is a no-op when the worker gate is not stalled', () => {
    const s0 = activationReducer(initActivation(), reset({ connected: true }), 100);
    const s1 = activationReducer(s0, { kind: 'retry' }, 200);
    expect(s1).toEqual(s0);
  });

  it('retry does not resurrect anything when the BRIDGE is stalled (disconnected)', () => {
    let s0 = activationReducer(initActivation(), reset(), 100); // bridge active
    s0 = activationReducer(s0, { kind: 'timeout', gate: 'bridge' }, 10_100); // bridge stalled → disconnected
    expect(s0.phase).toBe('disconnected');
    const s1 = activationReducer(s0, { kind: 'retry' }, 11_000);
    expect(s1).toEqual(s0); // worker not stalled → retry is a pure no-op
    expect(s1.gates.worker.status).toBe('pending'); // worker was never activated, stays pending
    expect(s1.phase).toBe('disconnected');
  });
});

describe('newlyResolvedGates', () => {
  it('emits a record for each gate that resolved between two states', () => {
    const a = activationReducer(initActivation(), reset(), 100); // bridge active
    const b = activationReducer(a, { kind: 'bridge' }, 112);
    const recs = newlyResolvedGates(a, b);
    expect(recs).toEqual([{ runId: 1, gate: 'bridge', ms: 12, cold: true, phase: 'readying', outcome: 'passed' }]);
  });

  it('stamps total on the page-passed record', () => {
    let s = activationReducer(initActivation(), reset(), 100);
    s = activationReducer(s, { kind: 'bridge' }, 112);
    s = activationReducer(s, { kind: 'worker' }, 604);
    const before = s;
    const after = activationReducer(s, { kind: 'page' }, 742);
    const recs = newlyResolvedGates(before, after);
    expect(recs[0]).toEqual({
      runId: 1,
      gate: 'page',
      ms: 138,
      cold: true,
      phase: 'ready',
      outcome: 'passed',
      total: 642,
    });
  });

  it('treats a runId change as a fresh run (emits new-run passes even if the old run had them)', () => {
    // warm run 1 fully ready, then a warm reset to run 2 that cascades bridge+worker again
    let s = activationReducer(initActivation(), reset({ connected: true, workerLive: true }), 100);
    s = activationReducer(s, { kind: 'page' }, 150); // run 1 ready
    const prev = s;
    const next = activationReducer(s, reset({ connected: true, workerLive: true }), 200); // run 2
    const gates = newlyResolvedGates(prev, next).map((r) => r.gate);
    expect(gates).toEqual(['bridge', 'worker']); // both re-emitted for run 2 (page still active)
    expect(newlyResolvedGates(prev, next).every((r) => r.runId === 2)).toBe(true);
  });

  it('emits a stalled outcome record on timeout', () => {
    const a = activationReducer(initActivation(), reset({ connected: true }), 100);
    const b = activationReducer(a, { kind: 'timeout', gate: 'worker' }, 15_100);
    expect(newlyResolvedGates(a, b)).toEqual([
      { runId: 1, gate: 'worker', ms: 15_000, cold: true, phase: 'blocked', outcome: 'stalled' },
    ]);
  });

  it('emits nothing when no gate resolved', () => {
    const a = activationReducer(initActivation(), reset(), 100);
    expect(newlyResolvedGates(a, a)).toEqual([]);
  });

  it('returns TWO records (bridge, worker) when a warm reset resolves both at once', () => {
    const prev = initActivation(); // all pending, runId 0
    const next = activationReducer(prev, reset({ connected: true, workerLive: true, cold: false }), 100);
    // warm reset cascades bridge→passed, worker→passed, page→active (still in flight)
    const recs = newlyResolvedGates(prev, next);
    expect(recs.map((r) => r.gate)).toEqual(['bridge', 'worker']); // in gate order, page excluded
    expect(recs.every((r) => r.runId === 1 && r.outcome === 'passed' && r.cold === false)).toBe(true);
  });
});

describe('activationPhase (exhaustive table)', () => {
  const inactive = initActivation(); // tenant false
  const readying = activationReducer(initActivation(), reset(), 100); // bridge active
  const ready = activationReducer(
    activationReducer(initActivation(), reset({ connected: true, workerLive: true }), 100),
    { kind: 'page' },
    150,
  );
  const degraded = activationReducer(
    activationReducer(initActivation(), reset({ connected: true, workerLive: true }), 100),
    { kind: 'timeout', gate: 'page' },
    5_100,
  );
  const blocked = activationReducer(
    activationReducer(initActivation(), reset({ connected: true }), 100),
    { kind: 'timeout', gate: 'worker' },
    15_100,
  );
  const disconnected = activationReducer(
    activationReducer(initActivation(), reset(), 100),
    {
      kind: 'timeout',
      gate: 'bridge',
    },
    10_100,
  );

  const cases: ReadonlyArray<readonly [ActivationPhase, ActivationState]> = [
    ['inactive', inactive],
    ['readying', readying],
    ['ready', ready],
    ['degraded', degraded],
    ['blocked', blocked],
    ['disconnected', disconnected],
  ];
  for (const [expected, state] of cases) {
    it(`derives ${expected}`, () => {
      expect(activationPhase(state)).toBe(expected);
    });
  }
});

describe('reset mid-run', () => {
  it('fully re-initializes the gates and bumps runId (no stale gate state carried across runs)', () => {
    // Run 1: connected → bridge passed, worker active; then worker hard-stalls → blocked.
    let s = activationReducer(initActivation(), reset({ connected: true }), 100);
    s = activationReducer(s, { kind: 'timeout', gate: 'worker' }, 15_100);
    expect(s.runId).toBe(1);
    expect(s.phase).toBe('blocked');
    expect(s.gates.bridge.status).toBe('passed');
    expect(s.gates.worker.status).toBe('stalled');

    // Run 2: a fresh reset (tenant, no signals) mid-run.
    const s2 = activationReducer(s, reset(), 20_000);
    expect(s2.runId).toBe(2); // bumped
    expect(s2.gates.bridge.status).toBe('active'); // re-armed from scratch
    expect(s2.gates.bridge.startedAt).toBe(20_000);
    expect(s2.gates.worker.status).toBe('pending'); // no stale stall carried over
    expect(s2.gates.worker.ms).toBeNull();
    expect(s2.gates.page.status).toBe('pending');
    expect(s2.phase).toBe('readying');
  });
});

describe('disconnect (demote a usable panel when the bridge drops)', () => {
  // Drive a run to ready: connected + workerLive passes bridge+worker, page passes.
  const ready = () => {
    let s = activationReducer(initActivation(), reset({ connected: true, workerLive: true }), 0);
    s = activationReducer(s, { kind: 'page' }, 10);
    return s;
  };
  it('stalls the bridge gate from ready → disconnected (locks input, raises the overlay)', () => {
    const s = ready();
    expect(s.phase).toBe('ready');
    const d = activationReducer(s, { kind: 'disconnect' }, 100);
    expect(d.phase).toBe('disconnected');
    expect(d.gates.bridge.status).toBe('stalled');
  });
  it('also demotes from the soft degraded phase', () => {
    let s = activationReducer(initActivation(), reset({ connected: true, workerLive: true }), 0);
    s = activationReducer(s, { kind: 'timeout', gate: 'page' }, 10); // page soft-stall → degraded
    expect(s.phase).toBe('degraded');
    expect(activationReducer(s, { kind: 'disconnect' }, 100).phase).toBe('disconnected');
  });
  it('is a no-op before the bridge has passed (nothing to demote)', () => {
    const s = activationReducer(initActivation(), reset({ connected: false }), 0); // bridge still active
    expect(s.gates.bridge.status).toBe('active');
    expect(activationReducer(s, { kind: 'disconnect' }, 100)).toEqual(s);
  });
});
