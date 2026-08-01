/**
 * Process-local side-panel conversation state.
 *
 * Prompts, responses, console references, and tenant routing keys can identify a
 * customer. Keep them only for the active extension-page lifetime; never write
 * them to chrome.storage or another durable store.
 */

import {
  type Conversation,
  emptySessionIndex,
  removeTabSession,
  type SessionIndex,
  tabSessionKey,
  tenantConv,
} from './references-store';

const conversations = new Map<string, Conversation>();
let sessionIndex = emptySessionIndex();

export async function loadConversation(id: string): Promise<Conversation | null> {
  return conversations.get(id) ?? null;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  conversations.set(conv.id, conv);
}

export async function loadSessionIndex(): Promise<SessionIndex> {
  return sessionIndex;
}

export async function saveSessionIndex(index: SessionIndex): Promise<void> {
  sessionIndex = index;
}

/** Drop both routing and transcript state when a tab closes or changes tenant. */
export async function discardTabSession(tabId: number): Promise<void> {
  const key = tabSessionKey(sessionIndex, tabId);
  const conversationId = key ? tenantConv(sessionIndex, key) : undefined;
  sessionIndex = removeTabSession(sessionIndex, tabId);
  if (conversationId && !Object.values(sessionIndex.byTenant).includes(conversationId)) {
    conversations.delete(conversationId);
  }
}
