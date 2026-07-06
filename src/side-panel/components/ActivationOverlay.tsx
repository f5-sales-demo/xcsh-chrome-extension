import { useEffect, useState } from 'preact/hooks';
import { type ActivationState, GATES, type GateName } from '../activation';

const ICON: Record<string, string> = { pending: '○', active: '●', passed: '✓', stalled: '⚠' };

/** Per-gate line label by status. The primary strings match the spec overlay
 *  copy; stalled lines are actionable. */
function gateLabel(gate: GateName, status: string): string {
  if (gate === 'bridge')
    return status === 'passed'
      ? 'bridge connected'
      : status === 'stalled'
        ? 'xcsh not connected — start the CLI'
        : 'connecting to xcsh…';
  if (gate === 'worker')
    return status === 'passed' ? 'worker ready' : status === 'stalled' ? "xcsh didn't start" : 'starting worker…';
  return status === 'passed' ? 'page read' : status === 'stalled' ? 'page unavailable' : 'reading this page';
}

/** Full-panel "getting ready" overlay: a live gate checklist with per-gate ms.
 *  Pure display driven by ActivationState; the active gate's elapsed time counts
 *  up via a 100ms re-render tick. A hard worker stall (phase 'blocked') exposes
 *  Retry. */
export function ActivationOverlay({ activation, onRetry }: { activation: ActivationState; onRetry: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div class="activation-overlay" role="status" aria-live="polite">
      <div class="spin ov-spinner" aria-hidden="true">
        ✻
      </div>
      <div class="ov-title">getting ready…</div>
      <ul class="ov-gates">
        {GATES.map((gate) => {
          const g = activation.gates[gate];
          const ms =
            g.status === 'passed' || g.status === 'stalled'
              ? `${g.ms ?? 0} ms`
              : g.status === 'active' && g.startedAt != null
                ? `${Math.max(0, Date.now() - g.startedAt)} ms`
                : '—';
          return (
            <li key={gate} class={`ov-gate ov-${g.status}`}>
              <span class="ov-ico" aria-hidden="true">
                {ICON[g.status]}
              </span>
              <span class="ov-label">{gateLabel(gate, g.status)}</span>
              <span class="ov-ms">{ms}</span>
            </li>
          );
        })}
      </ul>
      {activation.phase === 'blocked' ? (
        <button type="button" class="ov-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
