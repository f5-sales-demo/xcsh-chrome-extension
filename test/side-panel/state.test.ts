import { describe, expect, it } from 'bun:test';
import { newConversation, startAssistant } from '../../src/references-store';
import { composerPlaceholder, contextChipText, initPanelState, panelReducer } from '../../src/side-panel/state';

const base = () => initPanelState(newConversation('c1', 0));

describe('provisioning indicator (#180)', () => {
  it('composerPlaceholder shows "starting xcsh…" while provisioning, else the default', () => {
    expect(composerPlaceholder({ ...base(), provisioning: true })).toBe('starting xcsh for this tab…');
    expect(composerPlaceholder({ ...base(), provisioning: false })).toBe('ask xcsh about this page…');
  });
  it('set_provisioning toggles the flag', () => {
    const on = panelReducer(base(), { type: 'set_provisioning', on: true });
    expect(on.provisioning).toBe(true);
    expect(panelReducer(on, { type: 'set_provisioning', on: false }).provisioning).toBe(false);
  });
  it('becoming an active tenant clears a pending provisioning indicator (worker bound)', () => {
    const provisioning = panelReducer(base(), { type: 'set_provisioning', on: true });
    const active = panelReducer(provisioning, { type: 'set_active_tenant', label: 'acme·staging' });
    expect(active.provisioning).toBe(false);
  });
});

describe('panelReducer', () => {
  it('toggles connection', () => {
    const s = panelReducer(base(), { type: 'connected', on: true });
    expect(s.connected).toBe(true);
  });

  it('streams a delta into the active assistant turn', () => {
    let s = base();
    s = { ...s, conv: startAssistant(s.conv, 'a1', 0) };
    s = panelReducer(s, { type: 'begin_turn', id: 't1', msgId: 'a1' });
    s = panelReducer(s, { type: 'stream', msg: { type: 'chat_delta', id: 't1', seq: 0, delta: 'hi' } });
    expect(s.active?.state.text).toBe('hi');
    expect(s.conv.messages.find((m) => m.id === 'a1')?.text).toBe('hi');
  });

  it('finalizes and clears the active turn on chat_done', () => {
    let s = base();
    s = { ...s, conv: startAssistant(s.conv, 'a1', 0) };
    s = panelReducer(s, { type: 'begin_turn', id: 't1', msgId: 'a1' });
    s = panelReducer(s, { type: 'stream', msg: { type: 'chat_done', id: 't1' } });
    expect(s.active).toBeNull();
  });

  it('surfaces chat_error as an aborted assistant message', () => {
    let s = base();
    s = { ...s, conv: startAssistant(s.conv, 'a1', 0) };
    s = panelReducer(s, { type: 'begin_turn', id: 't1', msgId: 'a1' });
    s = panelReducer(s, { type: 'stream', msg: { type: 'chat_error', id: 't1', error: 'boom' }, at: 5 });
    expect(s.active).toBeNull();
    const msg = s.conv.messages.find((m) => m.id === 'a1');
    expect(msg?.aborted).toBe(true);
    expect(msg?.text).toBe('boom');
  });

  it('derives context-chip text', () => {
    let s = panelReducer(base(), { type: 'page_context', meta: { title: 'Load Balancers' }, snapshot: {} });
    expect(contextChipText(s)).toBe('Load Balancers');
    s = panelReducer(s, { type: 'set_inactive', label: '' });
    expect(contextChipText(s)).toBe('open an F5 XC console page');
  });
});
