import { describe, expect, it } from 'bun:test';
import { newConversation, startAssistant } from '../../src/references-store';
import { activationReducer, initActivation } from '../../src/side-panel/activation';
import {
  composerPlaceholder,
  contextChipText,
  initPanelState,
  inputLocked,
  overlayVisible,
  panelReducer,
} from '../../src/side-panel/state';

const base = () => initPanelState(newConversation('c1', 0));

const act = (over: Partial<{ connected: boolean; workerLive: boolean }> = {}) =>
  activationReducer(
    initActivation(),
    { kind: 'reset', tenant: true, cold: true, connected: false, workerLive: false, ...over },
    0,
  );

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

  it('composerPlaceholder shows the readying text in readying/blocked, else the default', () => {
    expect(composerPlaceholder({ ...base(), activation: act({ connected: true }) })).toBe(
      'starting xcsh for this tab…',
    );
    expect(composerPlaceholder(base())).toBe('ask xcsh about this page…');
  });

  it('composerPlaceholder: "starting" for BOTH readying and blocked; default for ready, degraded, inactive', () => {
    const readying = act({ connected: true }); // worker active
    const blocked = activationReducer(act({ connected: true }), { kind: 'timeout', gate: 'worker' }, 15_100);
    const ready = activationReducer(act({ connected: true, workerLive: true }), { kind: 'page' }, 50);
    const degraded = activationReducer(
      act({ connected: true, workerLive: true }),
      { kind: 'timeout', gate: 'page' },
      5_100,
    );
    const starting = 'starting xcsh for this tab…';
    const dflt = 'ask xcsh about this page…';
    expect(composerPlaceholder({ ...base(), activation: readying })).toBe(starting);
    expect(composerPlaceholder({ ...base(), activation: blocked })).toBe(starting);
    expect(composerPlaceholder({ ...base(), activation: ready })).toBe(dflt);
    expect(composerPlaceholder({ ...base(), activation: degraded })).toBe(dflt);
    expect(composerPlaceholder(base())).toBe(dflt); // inactive
  });

  it('derives context-chip text from the activation phase', () => {
    expect(contextChipText(base())).toBe('open an F5 XC console page'); // inactive
    const ready = {
      ...base(),
      attachContext: true,
      contextMeta: { title: 'Load Balancers' },
      activation: activationReducer(act({ connected: true, workerLive: true }), { kind: 'page' }, 50),
    };
    expect(contextChipText(ready)).toBe('Load Balancers');
    const degraded = {
      ...base(),
      activation: activationReducer(
        act({ connected: true, workerLive: true }),
        { kind: 'timeout', gate: 'page' },
        5_100,
      ),
    };
    expect(contextChipText(degraded)).toBe('page unavailable');
  });

  it('contextChipText: attachContext off → "context off"; on but no contextMeta → "no page attached"', () => {
    const readyAct = activationReducer(act({ connected: true, workerLive: true }), { kind: 'page' }, 50);
    const off = { ...base(), attachContext: false, contextMeta: { title: 'Load Balancers' }, activation: readyAct };
    expect(contextChipText(off)).toBe('context off'); // toggle off wins even with a title present
    const onNoMeta = { ...base(), attachContext: true, contextMeta: null, activation: readyAct };
    expect(contextChipText(onNoMeta)).toBe('no page attached');
  });
});

describe('activation in panel state', () => {
  it('initPanelState seeds an inactive activation', () => {
    expect(base().activation.phase).toBe('inactive');
  });

  it('set_activation stores the sub-state; set_session_label sets the label', () => {
    const a = act({ connected: true }); // readying (worker active)
    const s = panelReducer(base(), { type: 'set_activation', activation: a });
    expect(s.activation.phase).toBe('readying');
    expect(panelReducer(s, { type: 'set_session_label', label: 'acme·staging' }).sessionLabel).toBe('acme·staging');
  });

  it('overlayVisible is true while readying, blocked, or disconnected', () => {
    const readying = { ...base(), activation: act({ connected: true }) };
    const blocked = {
      ...base(),
      activation: activationReducer(act({ connected: true }), { kind: 'timeout', gate: 'worker' }, 15_100),
    };
    const disconnected = {
      ...base(),
      activation: activationReducer(act(), { kind: 'timeout', gate: 'bridge' }, 10_100),
    };
    const ready = {
      ...base(),
      activation: activationReducer(act({ connected: true, workerLive: true }), { kind: 'page' }, 50),
    };
    expect(overlayVisible(readying)).toBe(true);
    expect(overlayVisible(blocked)).toBe(true);
    expect(overlayVisible(disconnected)).toBe(true);
    expect(overlayVisible(ready)).toBe(false);
    expect(overlayVisible(base())).toBe(false); // inactive
  });

  it('inputLocked covers readying/blocked/disconnected but not ready/degraded/inactive', () => {
    const disconnected = {
      ...base(),
      activation: activationReducer(act(), { kind: 'timeout', gate: 'bridge' }, 10_100),
    };
    const degraded = {
      ...base(),
      activation: activationReducer(
        act({ connected: true, workerLive: true }),
        { kind: 'timeout', gate: 'page' },
        5_100,
      ),
    };
    const ready = {
      ...base(),
      activation: activationReducer(act({ connected: true, workerLive: true }), { kind: 'page' }, 50),
    };
    expect(inputLocked(disconnected)).toBe(true);
    expect(inputLocked(degraded)).toBe(false);
    expect(inputLocked(ready)).toBe(false);
    expect(inputLocked(base())).toBe(false); // inactive
  });
});
