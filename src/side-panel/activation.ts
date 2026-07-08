/**
 * Pure tab-activation readiness "brain". The side panel presents as ready only
 * once three ordered gates pass — bridge (host reachable) → worker (bound for
 * THIS tab) → page (a fresh snapshot for the current page). This module owns the
 * gate state, the derived phase the UI reads, and the per-gate timing records the
 * effect layer forwards to diagnostics. Like sw-router.ts it is pure: time is an
 * input (no Date.now()), and there is no Chrome/DOM here — the effect layer
 * (use-panel.ts) maps real signals to events, owns timers, and executes side
 * effects. Gates are strictly ordered: a gate is `pending` until its predecessor
 * passes.
 */
export type GateName = 'bridge' | 'worker' | 'page';
export type GateStatus = 'pending' | 'active' | 'passed' | 'stalled';
export type ActivationPhase = 'inactive' | 'readying' | 'ready' | 'degraded' | 'blocked' | 'disconnected';

export interface GateState {
  status: GateStatus;
  /** epoch ms the gate became active, or null while pending. */
  startedAt: number | null;
  /** elapsed ms, frozen when the gate passes or stalls; null until then. */
  ms: number | null;
}

export interface ActivationState {
  /** monotonic run counter; a new activation (tab focus/nav/boot) bumps it. */
  runId: number;
  /** true when the worker had to be spawned (not already live at reset). */
  cold: boolean;
  /** is the focused tab an F5 XC console (tenant) tab? false → inactive. */
  tenant: boolean;
  /** epoch ms the run started (reset), or null for a non-tenant run. */
  startedAt: number | null;
  gates: Record<GateName, GateState>;
  phase: ActivationPhase;
}

export type ActivationEvent =
  | { kind: 'reset'; tenant: boolean; cold: boolean; connected: boolean; workerLive: boolean }
  | { kind: 'bridge' }
  | { kind: 'worker' }
  | { kind: 'page' }
  | { kind: 'timeout'; gate: GateName }
  | { kind: 'disconnect' }
  | { kind: 'retry' };

export interface ActivationRecord {
  runId: number;
  gate: GateName;
  ms: number;
  cold: boolean;
  phase: ActivationPhase;
  outcome: 'passed' | 'stalled';
  /** cumulative run time (ms), stamped only on the terminal page-passed record. */
  total?: number;
}

export const GATES: readonly GateName[] = ['bridge', 'worker', 'page'] as const;

const pendingGate = (): GateState => ({ status: 'pending', startedAt: null, ms: null });
const freshGates = (): Record<GateName, GateState> => ({
  bridge: pendingGate(),
  worker: pendingGate(),
  page: pendingGate(),
});
const activate = (now: number): GateState => ({ status: 'active', startedAt: now, ms: null });
const resolve = (g: GateState, now: number, status: 'passed' | 'stalled'): GateState => ({
  ...g,
  status,
  ms: now - (g.startedAt ?? now),
});

export function initActivation(): ActivationState {
  return { runId: 0, cold: false, tenant: false, startedAt: null, gates: freshGates(), phase: 'inactive' };
}

/** Derive the single phase the UI reads. Stalls dominate (hard → disconnected/
 *  blocked, soft page → degraded); all-passed → ready; else readying. */
export function activationPhase(s: ActivationState): ActivationPhase {
  if (!s.tenant) return 'inactive';
  if (s.gates.bridge.status === 'stalled') return 'disconnected';
  if (s.gates.worker.status === 'stalled') return 'blocked';
  if (s.gates.page.status === 'stalled') return 'degraded';
  if (GATES.every((g) => s.gates[g].status === 'passed')) return 'ready';
  return 'readying';
}

const withPhase = (s: ActivationState): ActivationState => ({ ...s, phase: activationPhase(s) });

function passBridge(s: ActivationState, now: number): ActivationState {
  if (s.gates.bridge.status !== 'active') return s;
  return {
    ...s,
    gates: { ...s.gates, bridge: resolve(s.gates.bridge, now, 'passed'), worker: activate(now) },
  };
}
function passWorker(s: ActivationState, now: number): ActivationState {
  if (s.gates.bridge.status !== 'passed' || s.gates.worker.status !== 'active') return s;
  return {
    ...s,
    gates: { ...s.gates, worker: resolve(s.gates.worker, now, 'passed'), page: activate(now) },
  };
}
function passPage(s: ActivationState, now: number): ActivationState {
  if (s.gates.worker.status !== 'passed' || s.gates.page.status !== 'active') return s;
  return { ...s, gates: { ...s.gates, page: resolve(s.gates.page, now, 'passed') } };
}

export function activationReducer(s: ActivationState, e: ActivationEvent, now: number): ActivationState {
  switch (e.kind) {
    case 'reset': {
      const base: ActivationState = {
        runId: s.runId + 1,
        cold: e.cold,
        tenant: e.tenant,
        startedAt: e.tenant ? now : null,
        gates: freshGates(),
        phase: 'inactive',
      };
      if (!e.tenant) return withPhase(base);
      let st: ActivationState = { ...base, gates: { ...base.gates, bridge: activate(now) } };
      if (e.connected) st = passBridge(st, now);
      if (e.connected && e.workerLive) st = passWorker(st, now);
      return withPhase(st);
    }
    case 'bridge':
      return withPhase(passBridge(s, now));
    case 'worker':
      return withPhase(passWorker(s, now));
    case 'page':
      return withPhase(passPage(s, now));
    case 'timeout': {
      const g = s.gates[e.gate];
      if (g.status !== 'active') return s; // only an in-flight gate can stall
      return withPhase({ ...s, gates: { ...s.gates, [e.gate]: resolve(g, now, 'stalled') } });
    }
    case 'disconnect': {
      // A live bridge dropped after we were usable (ready/degraded). Stall the
      // bridge gate so the panel demotes to `disconnected` — locking the composer
      // and raising the overlay+Retry — instead of leaving a stale `ready` that lets
      // a doomed send fly into a dead socket. Only meaningful once bridge passed.
      if (s.gates.bridge.status !== 'passed') return s;
      return withPhase({ ...s, gates: { ...s.gates, bridge: resolve(s.gates.bridge, now, 'stalled') } });
    }
    case 'retry': {
      if (s.gates.worker.status !== 'stalled') return s;
      return withPhase({ ...s, gates: { ...s.gates, worker: activate(now) } });
    }
    default:
      return s;
  }
}

/** Whether a stalled worker gate should be AUTO-retried before surfacing the manual
 *  "xcsh didn't start" Retry. Only for a COLD start (no live worker at reset), which
 *  covers an upgrade/recycle handoff that can exceed the gate budget — a bounded
 *  auto-retry re-drives provisioning so the panel recovers on its own. Bounded by
 *  `maxAttempts` so a genuinely dead host still stops and shows Retry (no loop). A
 *  warm gate never auto-retries (a steady-state ready panel is unaffected). (#upgrade-recycle) */
export function shouldAutoRetryWorkerGate(opts: { cold: boolean; attempts: number; maxAttempts: number }): boolean {
  return opts.cold && opts.attempts < opts.maxAttempts;
}

const isResolved = (st: GateStatus): boolean => st === 'passed' || st === 'stalled';

/** Records for gates that resolved (passed/stalled) between `prev` and `next`. A
 *  runId change means a fresh run: compare against all-pending so the new run's
 *  cascaded passes are emitted even if the prior run had the same gates passed. */
export function newlyResolvedGates(prev: ActivationState, next: ActivationState): ActivationRecord[] {
  const base = next.runId !== prev.runId ? freshGates() : prev.gates;
  const out: ActivationRecord[] = [];
  for (const gate of GATES) {
    const before = base[gate];
    const after = next.gates[gate];
    if (!isResolved(before.status) && isResolved(after.status)) {
      const outcome = after.status === 'passed' ? 'passed' : 'stalled';
      const rec: ActivationRecord = {
        runId: next.runId,
        gate,
        ms: after.ms ?? 0,
        cold: next.cold,
        phase: next.phase,
        outcome,
      };
      if (gate === 'page' && after.status === 'passed') {
        rec.total = GATES.reduce((sum, g) => sum + (next.gates[g].ms ?? 0), 0);
      }
      out.push(rec);
    }
  }
  return out;
}
