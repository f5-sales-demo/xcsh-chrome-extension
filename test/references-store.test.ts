import { describe, expect, it } from 'bun:test';
import { DEFAULT_MODE } from '../src/chat-protocol';
import {
  addToIndex,
  appendAssistantDelta,
  appendToolNotice,
  appendUserMessage,
  type ChatIndex,
  CONV_CAP,
  deriveTitle,
  emptySessionIndex,
  emptyTabIndex,
  finalizeAssistant,
  markAborted,
  newConversation,
  pruneConversations,
  removeTab,
  removeTabSession,
  sessionIndexFromTabIndex,
  setMode,
  setTabConv,
  setTenantConv,
  startAssistant,
  tabConv,
  tabConvKey,
  tabSessionKey,
  tenantConv,
} from '../src/references-store';

describe('conversation lifecycle', () => {
  it('titles from the first user message and streams an assistant reply', () => {
    let c = newConversation('conv-1', 1);
    c = appendUserMessage(c, { id: 'm1', role: 'user', text: 'How do I configure a WAF?', at: 2 });
    expect(c.title).toBe(deriveTitle('How do I configure a WAF?'));
    c = startAssistant(c, 'm2', 3);
    c = appendAssistantDelta(c, 'm2', 'Open ');
    c = appendAssistantDelta(c, 'm2', 'the LB.');
    expect(c.messages[1].text).toBe('Open the LB.');
  });

  it('collects + dedupes references by url on finalize', () => {
    let c = newConversation('conv-1', 1);
    c = startAssistant(c, 'm1', 2);
    c = finalizeAssistant(
      c,
      'm1',
      [
        { kind: 'doc', title: 'WAF', url: 'https://d/waf' },
        { kind: 'doc', title: 'WAF dup', url: 'https://d/waf' },
        { kind: 'console', title: 'Open', url: 'https://c/lb' },
      ],
      3,
    );
    expect(c.references).toHaveLength(2);
    expect(c.messages[0].refs).toHaveLength(2);
    expect(c.references.every((r) => r.firstSeenMsg === 'm1')).toBe(true);
  });
});

describe('pruneConversations', () => {
  it('drops oldest beyond the cap', () => {
    let idx: ChatIndex = { conversations: [], active: null };
    for (let i = 0; i < CONV_CAP + 3; i++) idx = addToIndex(idx, `conv-${i}`);
    const { index, removed } = pruneConversations(idx);
    expect(index.conversations).toHaveLength(CONV_CAP);
    expect(removed).toEqual(['conv-0', 'conv-1', 'conv-2']);
  });
});

describe('interaction modes and tool entries (addendum)', () => {
  it('creates conversation with DEFAULT_MODE', () => {
    const c = newConversation('conv-1', 1);
    expect(c.mode).toBe(DEFAULT_MODE);
  });

  it('setMode updates mode and updatedAt', () => {
    let c = newConversation('conv-1', 1);
    c = setMode(c, 'presentation', 42);
    expect(c.mode).toBe('presentation');
    expect(c.updatedAt).toBe(42);
  });

  it('can create conversation with explicit mode', () => {
    const c = newConversation('conv-1', 1, 'configuration');
    expect(c.mode).toBe('configuration');
  });

  it('appendToolNotice appends a tool entry with minimal text', () => {
    let c = newConversation('conv-1', 1);
    c = appendToolNotice(c, { id: 't1', tool: 'waf-config', ok: true, at: 2 });
    expect(c.messages).toHaveLength(1);
    const msg = c.messages[0];
    expect(msg.role).toBe('tool');
    expect(msg.tool).toBe('waf-config');
    expect(msg.ok).toBe(true);
    expect(msg.text).toBe('waf-config: ok');
  });

  it('appendToolNotice with detail uses detail', () => {
    let c = newConversation('conv-1', 1);
    c = appendToolNotice(c, { id: 't1', tool: 'waf-config', ok: false, detail: 'Invalid JSON', at: 2 });
    expect(c.messages[0].text).toBe('Invalid JSON');
  });

  it('markAborted sets aborted flag on assistant message', () => {
    let c = newConversation('conv-1', 1);
    c = startAssistant(c, 'm1', 2);
    c = appendAssistantDelta(c, 'm1', 'Starting response...');
    const beforeTime = c.updatedAt;
    c = markAborted(c, 'm1', 5);
    expect(c.messages[0].aborted).toBe(true);
    expect(c.updatedAt).toBe(5);
    expect(c.updatedAt).toBeGreaterThan(beforeTime);
  });

  it('markAborted does not affect other messages', () => {
    let c = newConversation('conv-1', 1);
    c = appendUserMessage(c, { id: 'u1', role: 'user', text: 'Hello', at: 2 });
    c = startAssistant(c, 'a1', 3);
    c = appendAssistantDelta(c, 'a1', 'Hi');
    c = startAssistant(c, 'a2', 4);
    c = appendAssistantDelta(c, 'a2', 'Another');
    c = markAborted(c, 'a1', 5);
    expect(c.messages[0].role).toBe('user');
    expect(c.messages[0].aborted).toBeUndefined();
    expect(c.messages[1].aborted).toBe(true);
    expect(c.messages[2].aborted).toBeUndefined();
  });
});

describe('SessionIndex (per-tenant session map)', () => {
  it('maps many tabs of one tenant to a single conversation', () => {
    let idx = emptySessionIndex();
    idx = setTenantConv(idx, 'acme|staging', 10, 'conv-acme');
    idx = setTenantConv(idx, 'acme|staging', 11, 'conv-acme'); // second tab, same tenant
    expect(tenantConv(idx, 'acme|staging')).toBe('conv-acme');
    expect(tabSessionKey(idx, 10)).toBe('acme|staging');
    expect(tabSessionKey(idx, 11)).toBe('acme|staging');
  });
  it('keeps conversations distinct across tenants and environments', () => {
    let idx = emptySessionIndex();
    idx = setTenantConv(idx, 'acme|staging', 10, 'conv-a-stg');
    idx = setTenantConv(idx, 'acme|production', 20, 'conv-a-prod');
    idx = setTenantConv(idx, 'globex|staging', 30, 'conv-g-stg');
    expect(tenantConv(idx, 'acme|staging')).toBe('conv-a-stg');
    expect(tenantConv(idx, 'acme|production')).toBe('conv-a-prod');
    expect(tenantConv(idx, 'globex|staging')).toBe('conv-g-stg');
  });
  it('removing a tab keeps the tenant conversation (many-tabs -> one-session)', () => {
    let idx = setTenantConv(
      setTenantConv(emptySessionIndex(), 'acme|staging', 10, 'conv-a'),
      'acme|staging',
      11,
      'conv-a',
    );
    idx = removeTabSession(idx, 10);
    expect(tabSessionKey(idx, 10)).toBeUndefined();
    expect(tabSessionKey(idx, 11)).toBe('acme|staging');
    expect(tenantConv(idx, 'acme|staging')).toBe('conv-a'); // conv persists for tab 11 / future tabs
  });
  it('prunes the per-tab byTenant entry on close, leaving other tabs untouched', () => {
    // Per-tab keying (#136): each tab has a DISTINCT conv key "tenant|env#tabId".
    let idx = setTenantConv(emptySessionIndex(), 'acme|staging#10', 10, 'conv-a10');
    idx = setTenantConv(idx, 'acme|staging#11', 11, 'conv-a11');
    idx = removeTabSession(idx, 10);
    // the closed tab's reverse mapping AND its orphan-prone byTenant entry are gone
    expect(tabSessionKey(idx, 10)).toBeUndefined();
    expect(tenantConv(idx, 'acme|staging#10')).toBeUndefined();
    // the other tab's mapping and conversation are untouched
    expect(tabSessionKey(idx, 11)).toBe('acme|staging#11');
    expect(tenantConv(idx, 'acme|staging#11')).toBe('conv-a11');
  });
  it('migrates an old TabIndex to per-tab compound keys (reachable by the live path)', () => {
    // #166 G: the live path reads byTenant ONLY by the compound "tenant|env#tabId"
    // key (tabConvKey). Migration must produce that shape too, else a migrated conv
    // is never matched (silently dropped) and a stale bare key orphans in byTenant.
    const idx = sessionIndexFromTabIndex([
      { tabId: 5, sessionKey: 'acme|staging', convId: 'conv-old-5' },
      { tabId: 7, sessionKey: 'globex|production', convId: 'conv-old-7' },
    ]);
    // Reachable under the SAME compound key the live path computes.
    expect(tenantConv(idx, tabConvKey('acme|staging', 5))).toBe('conv-old-5');
    expect(tenantConv(idx, tabConvKey('globex|production', 7))).toBe('conv-old-7');
    // No bare key leaks into byTenant.
    expect(tenantConv(idx, 'acme|staging')).toBeUndefined();
    expect(tabSessionKey(idx, 5)).toBe(tabConvKey('acme|staging', 5));
  });
  it('removeTabSession tolerates the compound key and keeps a conv shared by another live tab', () => {
    // Two tabs of one tenant, distinct compound keys but the SAME shared convId.
    let idx = setTenantConv(emptySessionIndex(), tabConvKey('acme|staging', 5), 5, 'conv-shared');
    idx = setTenantConv(idx, tabConvKey('acme|staging', 5), 5, 'conv-shared'); // idempotent re-bind
    idx = setTenantConv(idx, 'acme|staging#5-alias', 6, 'conv-shared'); // another tab → same conv
    idx = removeTabSession(idx, 5);
    expect(tabSessionKey(idx, 5)).toBeUndefined();
    expect(tenantConv(idx, tabConvKey('acme|staging', 5))).toBeUndefined(); // tab 5's key pruned
    expect(tabSessionKey(idx, 6)).toBe('acme|staging#5-alias'); // tab 6 untouched
  });
});

describe('TabIndex (per-tab session map)', () => {
  it('maps a tab id to a conversation id immutably', () => {
    const a = emptyTabIndex();
    const b = setTabConv(a, 7, 'conv-7');
    expect(tabConv(b, 7)).toBe('conv-7');
    expect(tabConv(a, 7)).toBeUndefined(); // original unchanged
  });
  it('removes a tab and returns the conversation it pointed at', () => {
    const idx = setTabConv(setTabConv(emptyTabIndex(), 7, 'conv-7'), 8, 'conv-8');
    const { index, removedConv } = removeTab(idx, 7);
    expect(removedConv).toBe('conv-7');
    expect(tabConv(index, 7)).toBeUndefined();
    expect(tabConv(index, 8)).toBe('conv-8');
    expect(removeTab(index, 99).removedConv).toBeUndefined();
  });
});
