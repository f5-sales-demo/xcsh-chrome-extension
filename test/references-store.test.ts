import { describe, expect, it } from 'bun:test';
import { DEFAULT_MODE } from '../src/chat-protocol';
import {
  appendAssistantDelta,
  appendToolNotice,
  appendUserMessage,
  deriveTitle,
  emptySessionIndex,
  finalizeAssistant,
  markAborted,
  newConversation,
  removeTabSession,
  setMode,
  setTenantConv,
  startAssistant,
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
    c = markAborted(c, 'm1', 5, 'user-stop');
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
    c = markAborted(c, 'a1', 5, 'user-stop');
    expect(c.messages[0].role).toBe('user');
    expect(c.messages[0].aborted).toBeUndefined();
    expect(c.messages[1].aborted).toBe(true);
    expect(c.messages[2].aborted).toBeUndefined();
  });
});

describe('SessionIndex (per-tenant session map)', () => {
  it('maps many tabs of one tenant to a single conversation', () => {
    let idx = emptySessionIndex();
    idx = setTenantConv(idx, 'example-corp|staging', 10, 'conv-example-corp');
    idx = setTenantConv(idx, 'example-corp|staging', 11, 'conv-example-corp'); // second tab, same tenant
    expect(tenantConv(idx, 'example-corp|staging')).toBe('conv-example-corp');
    expect(tabSessionKey(idx, 10)).toBe('example-corp|staging');
    expect(tabSessionKey(idx, 11)).toBe('example-corp|staging');
  });
  it('keeps conversations distinct across tenants and environments', () => {
    let idx = emptySessionIndex();
    idx = setTenantConv(idx, 'example-corp|staging', 10, 'conv-a-stg');
    idx = setTenantConv(idx, 'example-corp|production', 20, 'conv-a-prod');
    idx = setTenantConv(idx, 'example-partners|staging', 30, 'conv-g-stg');
    expect(tenantConv(idx, 'example-corp|staging')).toBe('conv-a-stg');
    expect(tenantConv(idx, 'example-corp|production')).toBe('conv-a-prod');
    expect(tenantConv(idx, 'example-partners|staging')).toBe('conv-g-stg');
  });
  it('removing a tab keeps the tenant conversation (many-tabs -> one-session)', () => {
    let idx = setTenantConv(
      setTenantConv(emptySessionIndex(), 'example-corp|staging', 10, 'conv-a'),
      'example-corp|staging',
      11,
      'conv-a',
    );
    idx = removeTabSession(idx, 10);
    expect(tabSessionKey(idx, 10)).toBeUndefined();
    expect(tabSessionKey(idx, 11)).toBe('example-corp|staging');
    expect(tenantConv(idx, 'example-corp|staging')).toBe('conv-a'); // conv persists for tab 11 / future tabs
  });
  it('prunes the per-tab byTenant entry on close, leaving other tabs untouched', () => {
    // Per-tab keying (#136): each tab has a DISTINCT conv key "tenant|env#tabId".
    let idx = setTenantConv(emptySessionIndex(), 'example-corp|staging#10', 10, 'conv-a10');
    idx = setTenantConv(idx, 'example-corp|staging#11', 11, 'conv-a11');
    idx = removeTabSession(idx, 10);
    // the closed tab's reverse mapping AND its orphan-prone byTenant entry are gone
    expect(tabSessionKey(idx, 10)).toBeUndefined();
    expect(tenantConv(idx, 'example-corp|staging#10')).toBeUndefined();
    // the other tab's mapping and conversation are untouched
    expect(tabSessionKey(idx, 11)).toBe('example-corp|staging#11');
    expect(tenantConv(idx, 'example-corp|staging#11')).toBe('conv-a11');
  });
  it('removeTabSession tolerates the compound key and keeps a conv shared by another live tab', () => {
    // Two tabs of one tenant, distinct compound keys but the SAME shared convId.
    let idx = setTenantConv(emptySessionIndex(), tabConvKey('example-corp|staging', 5), 5, 'conv-shared');
    idx = setTenantConv(idx, tabConvKey('example-corp|staging', 5), 5, 'conv-shared'); // idempotent re-bind
    idx = setTenantConv(idx, 'example-corp|staging#5-alias', 6, 'conv-shared'); // another tab → same conv
    idx = removeTabSession(idx, 5);
    expect(tabSessionKey(idx, 5)).toBeUndefined();
    expect(tenantConv(idx, tabConvKey('example-corp|staging', 5))).toBeUndefined(); // tab 5's key pruned
    expect(tabSessionKey(idx, 6)).toBe('example-corp|staging#5-alias'); // tab 6 untouched
  });
});
