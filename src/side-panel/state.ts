import { type ChatStreamMsg, type ChatTurnState, initChatTurn, reduceChatTurn } from '../chat-protocol';
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
  active: { id: string; msgId: string; state: ChatTurnState } | null;
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
  | { type: 'begin_turn'; id: string; msgId: string }
  | { type: 'end_turn' }
  | { type: 'abort_turn'; at: number }
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
      return { ...s, active: { id: a.id, msgId: a.msgId, state: initChatTurn(a.id) } };
    case 'end_turn':
      return { ...s, active: null };
    case 'abort_turn':
      if (!s.active) return s;
      return { ...s, conv: markAborted(s.conv, s.active.msgId, a.at), active: null };
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
      const errText = turn.error ?? (a.msg as { error?: string }).error ?? 'Unknown error';
      const msgId = s.active.msgId;
      return {
        ...s,
        conv: {
          ...s.conv,
          updatedAt: at,
          messages: s.conv.messages.map((m) => (m.id === msgId ? { ...m, text: errText, aborted: true } : m)),
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
 *  hard gate is pending or has stalled. */
export function overlayVisible(s: Pick<PanelState, 'activation'>): boolean {
  const p = s.activation.phase;
  return p === 'readying' || p === 'blocked';
}

/** Composer is locked until the panel is usable — readying (gates in flight),
 *  blocked (worker stalled), or disconnected (bridge stalled). `ready` and the
 *  soft `degraded` phase both allow input; `inactive` (non-tenant tab) is unchanged. */
export function inputLocked(s: Pick<PanelState, 'activation'>): boolean {
  const p = s.activation.phase;
  return p === 'readying' || p === 'blocked' || p === 'disconnected';
}
