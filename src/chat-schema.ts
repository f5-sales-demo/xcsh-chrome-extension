/**
 * Machine-readable conformance schemas for the chat bridge wire protocol, plus
 * golden valid/invalid examples. PURE (TypeBox only). This is the cross-repo
 * contract: the extension and xcsh both validate against the same schemas +
 * examples (published as `chat-conformance.json`), so the two sides cannot drift
 * silently. The hand-written interfaces in `chat-protocol.ts` stay the in-code
 * types; the examples below are typed against them for compile-time lockstep,
 * and validated against the schemas at runtime (see test/chat-conformance.test.ts).
 */

import { type TSchema, Type } from '@sinclair/typebox';
import {
  CHAT_ERROR_REASONS,
  type ChatDeltaMsg,
  type ChatDoneMsg,
  type ChatErrorMsg,
  type ChatKeepaliveMsg,
  type ChatRequestMsg,
  type ChatStopMsg,
  type ChatToolNoticeMsg,
  type HostToolCallMsg,
  type HostToolCancelMsg,
  type HostToolResultMsg,
  type HostToolUpdateMsg,
  type SetHostToolsAckMsg,
  type SetHostToolsErrorMsg,
  type SetHostToolsMsg,
} from './chat-protocol';
import type { PageContextSnapshot } from './context-snapshot';

// Chat turn ids are prefixed `c-`, disjoint from tool-request ids.
const ChatId = Type.String({ pattern: '^c-' });

export const InteractionModeSchema = Type.Union([
  Type.Literal('educational'),
  Type.Literal('presentation'),
  Type.Literal('configuration'),
  Type.Literal('screenshot'),
  Type.Literal('annotation'),
]);

export const ChatReferenceSchema = Type.Object({
  kind: Type.String(), // 'doc' | 'console' (string-open for forward-compat)
  title: Type.String(),
  url: Type.String(),
});

export const SnapshotApiSchema = Type.Object({
  url: Type.String(),
  status: Type.Number(),
  resourceType: Type.Union([Type.String(), Type.Null()]),
  body: Type.Unknown(),
  truncated: Type.Boolean(),
});

export const PageContextSnapshotSchema = Type.Object({
  v: Type.Literal(1),
  capturedAt: Type.Number(),
  tabId: Type.Number(),
  url: Type.String(),
  path: Type.String(),
  title: Type.String(),
  ax: Type.Union([Type.Null(), Type.Object({ role: Type.String() }, { additionalProperties: true })]),
  api: Type.Union([Type.Null(), SnapshotApiSchema]),
  truncated: Type.Boolean(),
});

export const ChatRequestSchema = Type.Object({
  type: Type.Literal('chat_request'),
  id: ChatId,
  text: Type.String(),
  context: Type.Union([Type.Null(), PageContextSnapshotSchema]),
  mode: InteractionModeSchema,
  history_hint: Type.Optional(Type.String()),
});

export const ChatStopSchema = Type.Object({
  type: Type.Literal('chat_stop'),
  id: ChatId,
});

export const ChatDeltaSchema = Type.Object({
  type: Type.Literal('chat_delta'),
  id: ChatId,
  seq: Type.Number(),
  delta: Type.String(),
});

export const ChatDoneSchema = Type.Object({
  type: Type.Literal('chat_done'),
  id: ChatId,
  references: Type.Optional(Type.Array(ChatReferenceSchema)),
});

export const ChatErrorSchema = Type.Object({
  type: Type.Literal('chat_error'),
  id: ChatId,
  error: Type.String(),
  reason: Type.Optional(Type.Union(CHAT_ERROR_REASONS.map((r) => Type.Literal(r)))),
});

export const ChatToolNoticeSchema = Type.Object({
  type: Type.Literal('chat_tool_notice'),
  id: ChatId,
  tool: Type.String(),
  ok: Type.Boolean(),
  detail: Type.Optional(Type.String()),
});

export const ChatKeepaliveSchema = Type.Object({
  type: Type.Literal('chat_keepalive'),
  id: ChatId,
});

// --- Host-tool channel schemas (contract 1.8.0) ------------------------------
// Host-tool ids are host-minted opaque strings (NOT `c-` prefixed chat ids).

export const HostToolDefinitionSchema = Type.Object({
  name: Type.String(),
  label: Type.Optional(Type.String()),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  hidden: Type.Optional(Type.Boolean()),
});

/** An agent tool result: `content` is an array of typed blocks (e.g. text). */
export const HostToolResultDataSchema = Type.Object({
  content: Type.Array(Type.Object({ type: Type.String() }, { additionalProperties: true })),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const SetHostToolsSchema = Type.Object({
  type: Type.Literal('set_host_tools'),
  tools: Type.Array(HostToolDefinitionSchema),
});

export const SetHostToolsAckSchema = Type.Object({
  type: Type.Literal('set_host_tools_ack'),
  toolNames: Type.Array(Type.String()),
});

export const SetHostToolsErrorSchema = Type.Object({
  type: Type.Literal('set_host_tools_error'),
  error: Type.String(),
});

export const HostToolCallSchema = Type.Object({
  type: Type.Literal('host_tool_call'),
  id: Type.String(),
  toolCallId: Type.String(),
  toolName: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});

export const HostToolUpdateSchema = Type.Object({
  type: Type.Literal('host_tool_update'),
  id: Type.String(),
  partialResult: HostToolResultDataSchema,
});

export const HostToolResultSchema = Type.Object({
  type: Type.Literal('host_tool_result'),
  id: Type.String(),
  result: HostToolResultDataSchema,
  isError: Type.Optional(Type.Boolean()),
});

export const HostToolCancelSchema = Type.Object({
  type: Type.Literal('host_tool_cancel'),
  id: Type.String(),
  targetId: Type.String(),
});

/** Wire-message schemas keyed by `type`. */
export const CHAT_SCHEMAS: Record<string, TSchema> = {
  chat_request: ChatRequestSchema,
  chat_stop: ChatStopSchema,
  chat_delta: ChatDeltaSchema,
  chat_done: ChatDoneSchema,
  chat_error: ChatErrorSchema,
  chat_tool_notice: ChatToolNoticeSchema,
  chat_keepalive: ChatKeepaliveSchema,
  set_host_tools: SetHostToolsSchema,
  set_host_tools_ack: SetHostToolsAckSchema,
  set_host_tools_error: SetHostToolsErrorSchema,
  host_tool_call: HostToolCallSchema,
  host_tool_update: HostToolUpdateSchema,
  host_tool_result: HostToolResultSchema,
  host_tool_cancel: HostToolCancelSchema,
};

// --- Golden examples (independent oracles, validated against the schemas) -----

const SNAPSHOT_EXAMPLE: PageContextSnapshot = {
  v: 1,
  capturedAt: 1719000000000,
  tabId: 7,
  url: 'https://acme.console.ves.volterra.io/web/namespaces/default/http_loadbalancers/lb1',
  path: '/web/namespaces/default/http_loadbalancers/lb1',
  title: 'lb1 — Distributed Cloud',
  ax: { role: 'WebArea', name: 'lb1', children: [{ role: 'button', name: 'Edit', ref: 'e12' }] },
  api: {
    url: '/api/config/namespaces/default/http_loadbalancers/lb1',
    status: 200,
    resourceType: 'http_loadbalancers',
    body: { metadata: { name: 'lb1' }, spec: { domains: ['lb1.example.com'] } },
    truncated: false,
  },
  truncated: false,
};

// Each valid example is typed as its wire interface (compile-time lockstep) AND
// validated against its schema at runtime (test/chat-conformance.test.ts).
const chatRequest: ChatRequestMsg = {
  type: 'chat_request',
  id: 'c-1111',
  text: 'What does this load balancer do?',
  context: SNAPSHOT_EXAMPLE,
  mode: 'educational',
  history_hint: 'conv-1',
};
const chatRequestNoContext: ChatRequestMsg = {
  type: 'chat_request',
  id: 'c-2222',
  text: 'help me build a WAF policy',
  context: null,
  mode: 'configuration',
};
const chatStop: ChatStopMsg = { type: 'chat_stop', id: 'c-1111' };
const chatDelta: ChatDeltaMsg = { type: 'chat_delta', id: 'c-1111', seq: 0, delta: 'This LB ' };
const chatDelta1: ChatDeltaMsg = { type: 'chat_delta', id: 'c-1111', seq: 1, delta: 'routes traffic.' };
const chatDone: ChatDoneMsg = {
  type: 'chat_done',
  id: 'c-1111',
  references: [{ kind: 'doc', title: 'HTTP LB', url: 'https://docs.cloud.f5.com/docs/how-to' }],
};
const chatDoneNoRefs: ChatDoneMsg = { type: 'chat_done', id: 'c-1111' };
const chatError: ChatErrorMsg = {
  type: 'chat_error',
  id: 'c-1111',
  error: 'HTTP 403 forbidden',
  reason: 'provider-4xx',
};
const chatToolNotice: ChatToolNoticeMsg = { type: 'chat_tool_notice', id: 'c-1111', tool: 'navigate', ok: true };
const chatKeepalive: ChatKeepaliveMsg = { type: 'chat_keepalive', id: 'c-1111' };

// Host-tool channel (contract 1.8.0). Host-tool ids are host-minted opaque strings.
const setHostTools: SetHostToolsMsg = {
  type: 'set_host_tools',
  tools: [
    {
      name: 'office_read_range',
      label: 'Read range',
      description: 'Read a cell range from the active worksheet.',
      parameters: { type: 'object', properties: { range: { type: 'string' } }, required: ['range'] },
    },
  ],
};
const setHostToolsAck: SetHostToolsAckMsg = { type: 'set_host_tools_ack', toolNames: ['office_read_range'] };
const setHostToolsError: SetHostToolsErrorMsg = {
  type: 'set_host_tools_error',
  error: 'Host tool "office_read_range" must provide a non-empty description',
};
const hostToolCall: HostToolCallMsg = {
  type: 'host_tool_call',
  id: '7295551234567890',
  toolCallId: 'call_abc',
  toolName: 'office_read_range',
  arguments: { range: 'A1:B2' },
};
const hostToolUpdate: HostToolUpdateMsg = {
  type: 'host_tool_update',
  id: '7295551234567890',
  partialResult: { content: [{ type: 'text', text: 'reading range…' }] },
};
const hostToolResult: HostToolResultMsg = {
  type: 'host_tool_result',
  id: '7295551234567890',
  result: { content: [{ type: 'text', text: 'A1=1, B1=2, A2=3, B2=4' }] },
};
const hostToolCancel: HostToolCancelMsg = {
  type: 'host_tool_cancel',
  id: '7295551234567891',
  targetId: '7295551234567890',
};

export const CHAT_EXAMPLES = {
  valid: {
    page_context_snapshot: SNAPSHOT_EXAMPLE,
    chat_request: chatRequest,
    chat_request_no_context: chatRequestNoContext,
    chat_stop: chatStop,
    chat_delta: chatDelta,
    chat_delta_1: chatDelta1,
    chat_done: chatDone,
    chat_done_no_refs: chatDoneNoRefs,
    chat_error: chatError,
    chat_tool_notice: chatToolNotice,
    chat_keepalive: chatKeepalive,
    set_host_tools: setHostTools,
    set_host_tools_ack: setHostToolsAck,
    set_host_tools_error: setHostToolsError,
    host_tool_call: hostToolCall,
    host_tool_update: hostToolUpdate,
    host_tool_result: hostToolResult,
    host_tool_cancel: hostToolCancel,
  },
  // Invalid examples are intentionally malformed; each `schema` names the schema
  // it must be REJECTED by.
  invalid: [
    { schema: 'chat_request', why: 'id missing c- prefix', value: { ...chatRequest, id: 'x-1111' } },
    { schema: 'chat_request', why: 'unknown mode', value: { ...chatRequest, mode: 'wizard' } },
    {
      schema: 'chat_request',
      why: 'missing text',
      value: { type: 'chat_request', id: 'c-1', context: null, mode: 'educational' },
    },
    { schema: 'chat_delta', why: 'missing seq', value: { type: 'chat_delta', id: 'c-1', delta: 'x' } },
    { schema: 'page_context_snapshot', why: 'wrong version', value: { ...SNAPSHOT_EXAMPLE, v: 2 } },
    {
      schema: 'set_host_tools',
      why: 'tool missing description',
      value: { type: 'set_host_tools', tools: [{ name: 'x', parameters: {} }] },
    },
    {
      schema: 'host_tool_call',
      why: 'missing toolName',
      value: { type: 'host_tool_call', id: '1', toolCallId: 'c', arguments: {} },
    },
    {
      schema: 'host_tool_result',
      why: 'result.content is not an array',
      value: { type: 'host_tool_result', id: '1', result: { content: 'nope' } },
    },
  ] as const,
};
