/**
 * chrome.storage.local adapter for chat history. Thin I/O over the pure model in
 * references-store.ts: this file knows the key layout and Chrome APIs; it owns
 * no shaping logic.
 *
 *   xcsh.chat.index        → { conversations: string[], active: string|null }
 *   xcsh.chat.conv.<id>    → Conversation
 */

import type { ChatIndex, Conversation } from './references-store';

export const INDEX_KEY = 'xcsh.chat.index';
export function convKey(id: string): string {
  return `xcsh.chat.conv.${id}`;
}

export async function loadIndex(): Promise<ChatIndex> {
  const got = await chrome.storage.local.get(INDEX_KEY);
  const idx = got[INDEX_KEY] as ChatIndex | undefined;
  return idx && Array.isArray(idx.conversations) ? idx : { conversations: [], active: null };
}

export async function saveIndex(index: ChatIndex): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  const key = convKey(id);
  const got = await chrome.storage.local.get(key);
  return (got[key] as Conversation | undefined) ?? null;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  await chrome.storage.local.set({ [convKey(conv.id)]: conv });
}

export async function deleteConversations(ids: string[]): Promise<void> {
  if (ids.length) await chrome.storage.local.remove(ids.map(convKey));
}
