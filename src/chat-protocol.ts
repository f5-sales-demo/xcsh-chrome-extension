/**
 * Chat-turn protocol — the reverse (user → xcsh) channel that complements the
 * existing tool_request/tool_result flow. PURE and chrome-free: the SW and the
 * side panel both import it, and the streaming reducer is deterministically
 * unit-tested (mirroring the pure-core split in overlays.ts / dispatch.ts).
 *
 * Chat ids are prefixed `c-` so they never collide with tool-request ids — the
 * SW routes by that disjoint id space.
 */

export type InteractionMode = 'educational' | 'presentation' | 'configuration' | 'screenshot' | 'annotation';
export const DEFAULT_MODE: InteractionMode = 'educational';
export const INTERACTION_MODES: readonly { id: InteractionMode; label: string; blurb: string }[] = [
  {
    id: 'educational',
    label: 'Educational',
    blurb: 'Explain concepts and answer questions about settings and their purpose.',
  },
  { id: 'presentation', label: 'Presentation', blurb: 'Guided, human-paced walkthrough/demo of the console.' },
  { id: 'configuration', label: 'Config building', blurb: 'Help build and fill F5 XC resource configuration.' },
  { id: 'screenshot', label: 'Screenshot', blurb: 'Capture annotated screenshots for documentation.' },
  { id: 'annotation', label: 'Annotation', blurb: 'Annotate the page for documentation and teaching.' },
];

export interface ChatRefWire {
  kind: string; // 'doc' | 'console' | …
  title: string;
  url: string;
}

export interface ChatRequestMsg {
  type: 'chat_request';
  id: string;
  text: string;
  context: unknown; // a PageContextSnapshot, passed through opaquely
  mode: InteractionMode;
  history_hint?: string;
  tabId?: number; // the panel's bound tab, so the SW routes to THAT tab's worker (#33)
  sessionKey?: string; // the tab's current "tenant|env"; SW refuses a worker on this
  // tab's sid that advertises a different key (stale after a same-tab re-login, #166)
}

export interface ChatDeltaMsg {
  type: 'chat_delta';
  id: string;
  seq: number;
  delta: string;
}
export interface ChatDoneMsg {
  type: 'chat_done';
  id: string;
  references?: ChatRefWire[];
}
/** Machine-readable cause of a terminal chat_error, so the panel can render a
 * distinct, actionable message (and decide whether to auto-recover) instead of a
 * generic failure. Additive/optional on the wire (contract 1.6.0); an omitted
 * reason means an unclassified error (show the raw error text). Shared vocabulary
 * with xcsh (keep both lists identical). */
export const CHAT_ERROR_REASONS = [
  'bridge-disconnected', // the worker's bridge closed mid-turn
  'bridge-unresponsive', // the socket looked open but the worker never answered
  'no-worker', // no worker is running for this tab
  'session-busy', // a turn is already in flight for this session
  'session-disposed', // the worker session was torn down
  'token-expired', // F5 XC API token expired
  'token-expiring', // F5 XC API token is about to expire
  'provider-4xx', // upstream provider rejected the request (client error)
  'provider-5xx', // upstream provider failed (server error) — retryable
] as const;

export type ChatErrorReason = (typeof CHAT_ERROR_REASONS)[number];

/** Panel-local abort causes that never travel the wire — the panel sets them
 * directly on a turn (user pressed Stop, the chat tab closed, or no first token
 * arrived in time). Together with the wire ChatErrorReasons they form the full
 * vocabulary the transcript maps to a distinct, actionable message (see abortInfo). */
export const PANEL_ONLY_ABORT_REASONS = ['user-stop', 'tab-closed', 'first-token-timeout'] as const;

export type PanelAbortReason = ChatErrorReason | (typeof PANEL_ONLY_ABORT_REASONS)[number];

export interface ChatErrorMsg {
  type: 'chat_error';
  id: string;
  error: string;
  reason?: ChatErrorReason;
}
export type ChatStreamMsg = ChatDeltaMsg | ChatDoneMsg | ChatErrorMsg;

export interface ChatStopMsg {
  type: 'chat_stop';
  id: string;
}
export interface ChatToolNoticeMsg {
  type: 'chat_tool_notice';
  id: string;
  tool: string;
  ok: boolean;
  detail?: string;
}

/** Liveness signal: the worker is actively working the turn (e.g. streaming model
 * thinking) before any visible token. Purely a keepalive — the panel treats it as
 * proof-of-life to clear the first-token timeout so a long legitimate think isn't
 * mistaken for a dead worker; it carries no renderable content. */
export interface ChatKeepaliveMsg {
  type: 'chat_keepalive';
  id: string;
}

// --- Host-tool channel (contract 1.8.0) --------------------------------------
// Lets the agent invoke tools that must run inside the host UI (an Office task
// pane: read/write ranges, insert slides, draft mail) over the WS bridge — the
// same host-tool pattern the stdio JSONL RPC already carries. Field-for-field
// with xcsh's stdio `RpcHostTool*` vocabulary (one vocabulary across transports).
// Direction: set_host_tools / host_tool_result / host_tool_update are panel→xcsh;
// host_tool_call / host_tool_cancel are xcsh→panel.

export interface HostToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  hidden?: boolean;
}

/** An agent tool result: `content` is an array of blocks (e.g. `{type:'text',text}`). */
export interface HostToolResultData {
  content: unknown[];
  details?: Record<string, unknown>;
}

export interface SetHostToolsMsg {
  type: 'set_host_tools';
  tools: HostToolDefinition[];
}
/** xcsh→panel ack of a `set_host_tools` registration (names actually registered),
 * so the client can await it before sending its first prompt. */
export interface SetHostToolsAckMsg {
  type: 'set_host_tools_ack';
  toolNames: string[];
}
/** xcsh→panel nack of a `set_host_tools` registration that failed to normalize
 * (bad definition, name conflict) — emitted instead of the ack so a client
 * awaiting registration gets a clear error rather than hanging. */
export interface SetHostToolsErrorMsg {
  type: 'set_host_tools_error';
  error: string;
}
export interface HostToolCallMsg {
  type: 'host_tool_call';
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}
export interface HostToolUpdateMsg {
  type: 'host_tool_update';
  id: string;
  partialResult: HostToolResultData;
}
export interface HostToolResultMsg {
  type: 'host_tool_result';
  id: string;
  result: HostToolResultData;
  isError?: boolean;
}
export interface HostToolCancelMsg {
  type: 'host_tool_cancel';
  id: string;
  targetId: string;
}

// NOTE: the host-tool frames (set_host_tools_ack / host_tool_call /
// host_tool_cancel) also travel xcsh→panel, but wiring them into the panel's
// `ChatInbound` dispatch (which is chat-turn `id`-keyed) is runtime routing —
// tracked as the companion issue. This file only defines their contract shapes.
export type ChatInbound = ChatStreamMsg | ChatToolNoticeMsg | ChatKeepaliveMsg;

export interface ChatTurnState {
  id: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  references: ChatRefWire[];
  error?: string;
  lastSeq: number;
}

/** Shape a chat_request for the bridge. The caller owns id generation. */
export function buildChatRequest(
  id: string,
  text: string,
  context: unknown,
  mode: InteractionMode,
  historyHint?: string,
  tabId?: number,
  sessionKey?: string | null,
): ChatRequestMsg {
  const msg: ChatRequestMsg = { type: 'chat_request', id, text, context, mode };
  if (historyHint !== undefined) msg.history_hint = historyHint;
  if (tabId !== undefined) msg.tabId = tabId;
  if (sessionKey) msg.sessionKey = sessionKey;
  return msg;
}

/** Shape a chat_stop message to request cancellation. */
export function buildChatStop(id: string): ChatStopMsg {
  return { type: 'chat_stop', id };
}

export function initChatTurn(id: string): ChatTurnState {
  return { id, text: '', status: 'streaming', references: [], lastSeq: -1 };
}

/** Fold one inbound stream event into the turn state. Idempotent after terminal. */
export function reduceChatTurn(state: ChatTurnState, msg: ChatStreamMsg): ChatTurnState {
  if (msg.id !== state.id) return state; // not this turn — ignore
  if (state.status !== 'streaming') return state; // terminal: ignore stragglers
  if (msg.type === 'chat_delta') {
    if (msg.seq <= state.lastSeq) return state; // duplicate / out-of-order
    return { ...state, text: state.text + msg.delta, lastSeq: msg.seq };
  }
  if (msg.type === 'chat_done') {
    return { ...state, status: 'done', references: msg.references ?? [] };
  }
  return { ...state, status: 'error', error: msg.error };
}

export function isChatInbound(msg: unknown): msg is ChatInbound {
  if (!msg || typeof msg !== 'object') return false;
  const t = (msg as { type?: unknown }).type;
  return (
    t === 'chat_delta' || t === 'chat_done' || t === 'chat_error' || t === 'chat_tool_notice' || t === 'chat_keepalive'
  );
}
