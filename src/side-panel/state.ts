import {
  type ChatErrorMsg,
  type ChatStreamMsg,
  type ChatTurnState,
  initChatTurn,
  type PanelAbortReason,
  reduceChatTurn,
} from '../chat-protocol';
import { appendAssistantDelta, type Conversation, finalizeAssistant, markAborted } from '../references-store';
import { type ActivationState, initActivation } from './activation';

export interface PanelState {
  conv: Conversation;
  connected: boolean;
  attachContext: boolean;
  contextMeta: { title?: string; path?: string } | null;
  sessionLabel: string;
  /** Tab-activation readiness gate state (bridge/worker/page) + derived phase. */
  activation: ActivationState;
  active: { id: string; msgId: string; state: ChatTurnState; prompt: string } | null;
}

export function initPanelState(conv: Conversation): PanelState {
  return {
    conv,
    connected: false,
    attachContext: true,
    contextMeta: null,
    sessionLabel: '',
    activation: initActivation(),
    active: null,
  };
}

export type PanelAction =
  | { type: 'set_conv'; conv: Conversation }
  | { type: 'connected'; on: boolean }
  | { type: 'set_activation'; activation: ActivationState }
  | { type: 'set_session_label'; label: string }
  | { type: 'toggle_context' }
  | { type: 'page_context'; meta: { title?: string; path?: string } | null; snapshot: unknown }
  | { type: 'begin_turn'; id: string; msgId: string; prompt?: string }
  | { type: 'end_turn' }
  | { type: 'abort_turn'; at: number; reason?: PanelAbortReason }
  | { type: 'suspend_turn' }
  | { type: 'stream'; msg: ChatStreamMsg; at?: number };

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case 'set_conv':
      return { ...s, conv: a.conv };
    case 'connected':
      return { ...s, connected: a.on };
    case 'set_activation':
      return { ...s, activation: a.activation };
    case 'set_session_label':
      return { ...s, sessionLabel: a.label };
    case 'toggle_context':
      return { ...s, attachContext: !s.attachContext };
    case 'page_context':
      return { ...s, contextMeta: a.meta };
    case 'begin_turn':
      return { ...s, active: { id: a.id, msgId: a.msgId, state: initChatTurn(a.id), prompt: a.prompt ?? '' } };
    case 'end_turn':
      return { ...s, active: null };
    case 'abort_turn':
      if (!s.active) return s;
      return {
        ...s,
        conv: markAborted(s.conv, s.active.msgId, a.at, a.reason, s.active.prompt),
        active: null,
      };
    case 'suspend_turn':
      // Tab switched away mid-turn. Stop tracking (so a new tab can begin its own
      // turn) WITHOUT marking the message aborted — the conversation in storage
      // keeps whatever content has streamed so far, so returning to that tab shows
      // the partial result (not blank). The SW's turn continues; its chat events are
      // dropped by the `active.id !== ev.id` guard since active is now null.
      return { ...s, active: null };
    case 'stream': {
      if (!s.active || s.active.id !== a.msg.id) return s;
      const turn = reduceChatTurn(s.active.state, a.msg);
      const at = a.at ?? 0;
      if (a.msg.type === 'chat_delta') {
        return {
          ...s,
          active: { ...s.active, state: turn },
          conv: appendAssistantDelta(s.conv, s.active.msgId, a.msg.delta),
        };
      }
      if (a.msg.type === 'chat_done') {
        return {
          ...s,
          conv: finalizeAssistant(s.conv, s.active.msgId, turn.references, at),
          active: null,
        };
      }
      // chat_error — replace the streaming bubble with a visible error block
      // (old side-panel.ts:594–605), mirroring markAborted's aborted-flag shape.
      // Carry the machine-readable reason + the prompt so the transcript renders a
      // distinct, actionable message and Retry can replay the exact turn.
      const errText = turn.error ?? (a.msg as { error?: string }).error ?? 'Unknown error';
      const msgId = s.active.msgId;
      const reason = (a.msg as ChatErrorMsg).reason;
      const prompt = s.active.prompt;
      return {
        ...s,
        conv: {
          ...s.conv,
          updatedAt: at,
          messages: s.conv.messages.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  text: errText,
                  aborted: true,
                  ...(reason ? { abortReason: reason } : {}),
                  ...(prompt ? { retryPrompt: prompt } : {}),
                }
              : m,
          ),
        },
        active: null,
      };
    }
    default:
      return s;
  }
}

/** Composer placeholder: "starting xcsh…" while the readiness overlay is up
 *  (readying/blocked), else the default. */
export function composerPlaceholder(s: Pick<PanelState, 'activation'>): string {
  const p = s.activation.phase;
  return p === 'readying' || p === 'blocked' ? 'starting xcsh for this tab…' : 'ask xcsh about this page…';
}

/** Context-chip text, derived from the activation phase: inactive → guidance,
 *  degraded → honest 'page unavailable', else the attached page title/state. */
export function contextChipText(s: PanelState): string {
  const p = s.activation.phase;
  if (p === 'inactive') return 'open an F5 XC console page';
  if (p === 'degraded') return 'page unavailable';
  if (s.attachContext && s.contextMeta) return s.contextMeta.title ?? s.contextMeta.path ?? 'current page';
  return s.attachContext ? 'no page attached' : 'context off';
}

/** The "getting ready" overlay covers the panel (transcript hidden) while a
 *  hard gate is pending or has stalled — readying (gates in flight), blocked
 *  (worker stalled), and disconnected (bridge stalled). For blocked/disconnected
 *  the overlay carries the actionable stall line + a Retry button. */
export function overlayVisible(s: Pick<PanelState, 'activation'>): boolean {
  const p = s.activation.phase;
  return p === 'readying' || p === 'blocked' || p === 'disconnected';
}

/** Composer is locked until the panel is usable — readying (gates in flight),
 *  blocked (worker stalled), or disconnected (bridge stalled). `ready` and the
 *  soft `degraded` phase both allow input; `inactive` (non-tenant tab) is unchanged. */
export function inputLocked(s: Pick<PanelState, 'activation'>): boolean {
  const p = s.activation.phase;
  return p === 'readying' || p === 'blocked' || p === 'disconnected';
}

/** What a failed turn shows the user, and how it can be recovered. `retryable`
 *  gates the per-message Retry button; `autoRecover` means the panel transparently
 *  re-provisions the worker and resends the prompt ONCE before falling back to
 *  that button. This table IS the committed failure-mode matrix (FAILURE-MODES.md);
 *  failure-modes.test.ts enforces that every reason maps to a distinct, non-terse,
 *  actionable message. For an unclassified error the raw error text is shown instead. */
export interface AbortInfo {
  text: string;
  retryable: boolean;
  autoRecover: boolean;
  /** Prefer the raw provider error text over `text` when present (a 4xx names the
   *  actual problem, e.g. an invalid model — more useful than a generic line). */
  preferRawText?: boolean;
}

const ABORT_INFO: Record<PanelAbortReason, AbortInfo> = {
  'user-stop': { text: 'Stopped.', retryable: false, autoRecover: false },
  'tab-closed': { text: 'Chat tab was closed.', retryable: false, autoRecover: false },
  'first-token-timeout': { text: "xcsh didn't respond in time — reconnecting…", retryable: true, autoRecover: true },
  'bridge-disconnected': { text: 'Lost connection to xcsh — reconnecting…', retryable: true, autoRecover: true },
  'bridge-unresponsive': { text: 'xcsh stopped responding — reconnecting…', retryable: true, autoRecover: true },
  'no-worker': { text: 'No xcsh running for this tab — reconnecting…', retryable: true, autoRecover: true },
  'session-busy': {
    text: 'xcsh is busy with another request — try again in a moment.',
    retryable: true,
    autoRecover: false,
  },
  'session-disposed': { text: 'xcsh session ended — restarting…', retryable: true, autoRecover: true },
  'token-expired': {
    text: 'F5 XC token expired — run /context create, then retry.',
    retryable: false,
    autoRecover: false,
  },
  'token-expiring': { text: 'F5 XC token is expiring — run /context create.', retryable: false, autoRecover: false },
  'provider-4xx': {
    text: 'xcsh could not handle that request.',
    retryable: false,
    autoRecover: false,
    preferRawText: true,
  },
  'provider-5xx': { text: 'xcsh provider error — try again.', retryable: true, autoRecover: false },
};

const FALLBACK_ABORT: AbortInfo = { text: 'Turn aborted.', retryable: false, autoRecover: false };

/** Map an abort reason to its user-facing message + recovery affordances. */
export function abortInfo(reason?: PanelAbortReason): AbortInfo {
  return reason ? ABORT_INFO[reason] : FALLBACK_ABORT;
}
