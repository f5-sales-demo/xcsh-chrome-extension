/**
 * Conversation + reference model — pure data operations over process-local chat
 * state. References are deduped by URL and stamped with the message where they
 * first appeared. Identity-bearing transcript data is never persisted.
 */

import type { ChatRefWire, InteractionMode, PanelAbortReason } from './chat-protocol';
import { DEFAULT_MODE } from './chat-protocol';

export interface ChatReference {
  id: string;
  kind: string;
  title: string;
  url: string;
  firstSeenMsg: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  at: number;
  context?: unknown;
  refs?: string[];
  tool?: string;
  ok?: boolean;
  aborted?: boolean;
  /** Why this turn aborted (drives the transcript's distinct message + Retry). */
  abortReason?: PanelAbortReason;
  /** The user prompt to replay if this aborted turn is retried. */
  retryPrompt?: string;
}

export interface Conversation {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  mode: InteractionMode;
  messages: StoredMessage[];
  references: ChatReference[];
}

export function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= 60 ? t : `${t.slice(0, 57)}…`;
}

export function newConversation(id: string, at: number, mode: InteractionMode = DEFAULT_MODE): Conversation {
  return {
    id,
    createdAt: at,
    updatedAt: at,
    title: 'New chat',
    mode,
    messages: [],
    references: [],
  };
}

export function appendUserMessage(conv: Conversation, msg: StoredMessage): Conversation {
  const firstUser = !conv.messages.some((m) => m.role === 'user');
  return {
    ...conv,
    title: firstUser ? deriveTitle(msg.text) : conv.title,
    messages: [...conv.messages, msg],
    updatedAt: msg.at,
  };
}

export function startAssistant(conv: Conversation, msgId: string, at: number): Conversation {
  return {
    ...conv,
    messages: [...conv.messages, { id: msgId, role: 'assistant', text: '', at }],
    updatedAt: at,
  };
}

export function appendAssistantDelta(conv: Conversation, msgId: string, delta: string): Conversation {
  return {
    ...conv,
    messages: conv.messages.map((m) => (m.id === msgId ? { ...m, text: m.text + delta } : m)),
  };
}

export function finalizeAssistant(
  conv: Conversation,
  msgId: string,
  wireRefs: ChatRefWire[],
  at: number,
): Conversation {
  const byUrl = new Map(conv.references.map((r) => [r.url, r]));
  const msgRefIds: string[] = [];
  let n = conv.references.length;
  for (const w of wireRefs) {
    let ref = byUrl.get(w.url);
    if (!ref) {
      ref = { id: `${msgId}-r${n++}`, kind: w.kind, title: w.title, url: w.url, firstSeenMsg: msgId };
      byUrl.set(w.url, ref);
    }
    if (!msgRefIds.includes(ref.id)) msgRefIds.push(ref.id);
  }
  return {
    ...conv,
    updatedAt: at,
    references: [...byUrl.values()],
    messages: conv.messages.map((m) => (m.id === msgId ? { ...m, refs: msgRefIds } : m)),
  };
}

export function setMode(conv: Conversation, mode: InteractionMode, at: number): Conversation {
  return {
    ...conv,
    mode,
    updatedAt: at,
  };
}

export function appendToolNotice(
  conv: Conversation,
  e: { id: string; tool: string; ok: boolean; detail?: string; at: number },
): Conversation {
  const text = e.detail ?? `${e.tool}: ${e.ok ? 'ok' : 'failed'}`;
  return {
    ...conv,
    messages: [...conv.messages, { id: e.id, role: 'tool', text, at: e.at, tool: e.tool, ok: e.ok }],
    updatedAt: e.at,
  };
}

export function markAborted(
  conv: Conversation,
  msgId: string,
  at: number,
  reason: PanelAbortReason,
  retryPrompt?: string,
): Conversation {
  return {
    ...conv,
    messages: conv.messages.map((m) =>
      m.id === msgId ? { ...m, aborted: true, abortReason: reason, ...(retryPrompt ? { retryPrompt } : {}) } : m,
    ),
    updatedAt: at,
  };
}

// --- SessionIndex: transient per-(tenant,tab) routing -----------------------
// Each live tab owns a distinct conversation. Including the session key prevents
// a same-tab tenant change from carrying the prior tenant's context.
export interface SessionIndex {
  /** per-(tenant,tab) conv-index key ("tenant|env#tabId", see `tabConvKey`) →
   *  conversation id. Tenant is part of the key so two tabs of one tenant keep
   *  distinct transcripts and a re-login never carries the prior tenant's. */
  byTenant: Record<string, string>;
  /** live tab id → its conv-index key. */
  byTab: Record<string, string>;
}

/** The per-(tenant,tab) conv-index key. Tenant is part of the key so two tabs of
 *  one tenant keep distinct transcripts and a re-login never carries context
 *  (#136). This is the only shape stored in `byTenant`, so no bare
 *  "tenant|env" entry can leak (#166). */
export function tabConvKey(sessionKey: string, tabId: number): string {
  return `${sessionKey}#${tabId}`;
}

export function emptySessionIndex(): SessionIndex {
  return { byTenant: {}, byTab: {} };
}

/** Bind a tab to its process-local conversation. */
export function setTenantConv(index: SessionIndex, sessionKey: string, tabId: number, convId: string): SessionIndex {
  return {
    byTenant: { ...index.byTenant, [sessionKey]: convId },
    byTab: { ...index.byTab, [String(tabId)]: sessionKey },
  };
}

/** The conversation id for a tenant session, if any. */
export function tenantConv(index: SessionIndex, sessionKey: string): string | undefined {
  return index.byTenant[sessionKey];
}

/** The session key a tab currently belongs to, if known. */
export function tabSessionKey(index: SessionIndex, tabId: number): string | undefined {
  return index.byTab[String(tabId)];
}

/** Forget a tab (on close): drop its `byTab` reverse mapping AND its per-tab
 * `byTenant` entry (keyed "tenant|env#tabId" → convId) so no orphan index entry
 * lingers unreachable and unpruned. A `byTenant` entry still shared by another
 * live tab is kept. */
export function removeTabSession(index: SessionIndex, tabId: number): SessionIndex {
  const key = String(tabId);
  const convKey = index.byTab[key];
  if (convKey === undefined) return index;
  const byTab = { ...index.byTab };
  delete byTab[key];
  const byTenant = { ...index.byTenant };
  if (!Object.values(byTab).includes(convKey)) delete byTenant[convKey];
  return { byTenant, byTab };
}
