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
import type { ActivationGate, ChatMessage, ChatReference, InteractionMode } from '../vendor/chat-ui';
import { type ActivationState, GATES, type GateName, type GateStatus } from './activation';
import { abortInfo } from './state';

/**
 * The sources ONE message cited, resolved from the conversation's deduped pool.
 *
 * The store keeps citations normalised — `conv.references` is the URL-deduped pool
 * and each message records only the ids it cited — so chips land under the answer
 * that actually cited them rather than being smeared across the transcript.
 *
 * Two deliberate leniencies, because a citation is worth more than its label:
 *  - an id with no pool entry (e.g. pruned history) is skipped, not fatal;
 *  - `chat_done.references[].kind` is an OPEN string on the wire (forward-compat),
 *    while the shared chip only tags `doc`/`console`. An unrecognised kind falls
 *    back to `doc` so the link still renders — the tag is a hint, the URL is the
 *    payload. Dropping the chip would silently lose a source.
 */
function citedSources(conv: Conversation, refIds: string[] | undefined): ChatReference[] | undefined {
  if (!refIds || refIds.length === 0) return undefined;
  const byId = new Map(conv.references.map((r) => [r.id, r]));
  const out = refIds.flatMap((id): ChatReference[] => {
    const ref = byId.get(id);
    if (!ref) return [];
    return [{ kind: ref.kind === 'console' ? 'console' : 'doc', title: ref.title, url: ref.url }];
  });
  return out.length > 0 ? out : undefined;
}

/**
 * Conversation rows → shared `ChatMessage[]`. Aborted turns fold to error rows
 * using fixed per-reason copy, and carry
 * `retryText` ONLY when the reason is retryable and the prompt was captured — the
 * shared Transcript then offers Retry on the LAST such row (matching the old
 * local Transcript's `id === lastId` gate). A settled answer also carries the
 * sources it cited, which the shared AssistantMessage renders as a chip row.
 */
export function convToMessages(conv: Conversation): ChatMessage[] {
  return conv.messages.map((m): ChatMessage => {
    if (m.role === 'tool') {
      return { id: m.id, role: 'tool', text: m.text, tool: m.tool ?? 'tool', ok: m.ok ?? true };
    }
    if (m.aborted) {
      if (!m.abortReason) return { id: m.id, role: m.role, text: 'Invalid abort state.', error: true };
      const info = abortInfo(m.abortReason);
      const text = info.text;
      const retryText = info.retryable && m.retryPrompt ? m.retryPrompt : undefined;
      return { id: m.id, role: m.role, text, error: true, ...(retryText ? { retryText } : {}) };
    }
    const references = citedSources(conv, m.refs);
    return { id: m.id, role: m.role, text: m.text, ...(references ? { references } : {}) };
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
