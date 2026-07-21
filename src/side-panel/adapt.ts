/**
 * Adapt the Chrome side-panel's own view-model (Conversation / ActivationState /
 * INTERACTION_MODES) into the headless prop shapes of the shared
 * `@f5-sales-demo/xcsh-chat-ui` components (vendored under `src/vendor/chat-ui`).
 *
 * Mirrors office-pane's `panel/adapt.ts`: the shared components stay transport-
 * and domain-agnostic; this module owns the Chrome-specific mapping — including
 * the failure-mode copy, which stays in `state.ts` (`abortInfo`, the committed
 * FAILURE-MODES matrix) so the shared UI never learns Chrome's abort reasons.
 */
import { INTERACTION_MODES } from '../chat-protocol';
import type { Conversation } from '../references-store';
import type { ActivationGate, ChatMessage, InteractionMode } from '../vendor/chat-ui';
import { type ActivationState, GATES, type GateName, type GateStatus } from './activation';
import { abortInfo } from './state';

/**
 * Conversation rows → shared `ChatMessage[]`. Aborted turns fold to error rows
 * using the per-reason copy (or the raw provider text for a 4xx), and carry
 * `retryText` ONLY when the reason is retryable and the prompt was captured — the
 * shared Transcript then offers Retry on the LAST such row (matching the old
 * local Transcript's `id === lastId` gate).
 */
export function convToMessages(conv: Conversation): ChatMessage[] {
  return conv.messages.map((m): ChatMessage => {
    if (m.role === 'tool') {
      return { id: m.id, role: 'tool', text: m.text, tool: m.tool ?? 'tool', ok: m.ok ?? true };
    }
    if (m.aborted) {
      const info = abortInfo(m.abortReason);
      const text = m.abortReason ? (info.preferRawText && m.text ? m.text : info.text) : m.text || 'Turn aborted.';
      const retryText = info.retryable && m.retryPrompt ? m.retryPrompt : undefined;
      return { id: m.id, role: m.role, text, error: true, ...(retryText ? { retryText } : {}) };
    }
    return { id: m.id, role: m.role, text: m.text };
  });
}

/** Per-gate line label by status — the spec overlay copy; stalled lines are
 *  actionable. Kept identical to the old local ActivationOverlay so the UAT
 *  renders byte-for-byte the same gate text. */
function gateLabel(gate: GateName, status: GateStatus): string {
  if (gate === 'bridge') {
    return status === 'passed'
      ? 'bridge connected'
      : status === 'stalled'
        ? 'xcsh not connected — start the CLI'
        : 'connecting to xcsh…';
  }
  if (gate === 'worker') {
    return status === 'passed' ? 'worker ready' : status === 'stalled' ? "xcsh didn't start" : 'starting worker…';
  }
  return status === 'passed' ? 'page read' : status === 'stalled' ? 'page unavailable' : 'reading this page';
}

/** ActivationState → shared `ActivationGate[]` in GATES order, each with its
 *  computed label. The overlay reads `startedAt` only for the ACTIVE gate (to
 *  count elapsed ms up live) and `ms` for a settled gate (passed/stalled), so we
 *  emit exactly the one the status needs — `null` collapses to omitted. */
export function activationToGates(activation: ActivationState): ActivationGate[] {
  return GATES.map((name): ActivationGate => {
    const g = activation.gates[name];
    const timing =
      g.status === 'active'
        ? g.startedAt != null
          ? { startedAt: g.startedAt }
          : {}
        : g.ms != null
          ? { ms: g.ms }
          : {};
    return { name, label: gateLabel(name, g.status), status: g.status, ...timing };
  });
}

/** The overlay exposes Retry only on a hard stall (worker `blocked` / bridge
 *  `disconnected`); `readying` shows the checklist without Retry. */
export function overlayBlocked(activation: ActivationState): boolean {
  return activation.phase === 'blocked' || activation.phase === 'disconnected';
}

/** The wire modes, already `{ id, label, blurb }`, typed as the shared
 *  `InteractionMode[]` for the Composer's mode toggle. */
export const MODES: InteractionMode[] = INTERACTION_MODES.map((m) => ({ id: m.id, label: m.label, blurb: m.blurb }));
