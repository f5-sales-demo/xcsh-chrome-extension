/**
 * Matrix test: per-tab transcript isolation in the panel reducer.
 *
 * The single side panel serves one window's tabs. These tests exercise every
 * tab-switch scenario at the reducer level to catch cross-tab bleed (tab A's
 * content appearing in tab B's conversation) and blanking (returning to a tab
 * shows an empty transcript). No Chrome stubs needed — the reducer is pure.
 *
 * Scenario matrix:
 *   ✓ idle → switch tabs → conversations swap cleanly
 *   ✓ mid-turn → switch tabs → turn suspended (not aborted), content preserved
 *   ✓ suspended turn's stream events → ignored (not applied to wrong conv)
 *   ✓ both tabs running → each has own transcript (no bleed)
 *   ✓ return to tab with suspended turn → partial content visible (not blank)
 *   ✓ tab close mid-turn → turn aborted
 */
import { describe, expect, test } from 'bun:test';
import type { ChatDeltaMsg, ChatDoneMsg, ChatErrorMsg } from '../../src/chat-protocol';
import { appendUserMessage, newConversation, startAssistant } from '../../src/references-store';
import { initPanelState, type PanelAction, type PanelState, panelReducer } from '../../src/side-panel/state';

const now = () => Date.now();

/** Dispatch a sequence of actions and return the final state. */
function run(initial: PanelState, ...actions: PanelAction[]): PanelState {
  return actions.reduce(panelReducer, initial);
}

/** Make a conversation with one user message. */
function convWithUser(text: string) {
  const conv = newConversation(`conv-${text}`, now());
  return appendUserMessage(conv, { id: `msg-${text}`, role: 'user', text, at: now() });
}

/** Make a conversation with a user message + a started assistant message (ready for streaming). */
function convWithTurn(userText: string, asstMsgId: string) {
  const conv = convWithUser(userText);
  return startAssistant(conv, asstMsgId, now());
}

const delta = (id: string, text: string): ChatDeltaMsg => ({ type: 'chat_delta', id, seq: 0, delta: text });
const done = (id: string): ChatDoneMsg => ({ type: 'chat_done', id });
const error = (id: string, err: string): ChatErrorMsg => ({ type: 'chat_error', id, error: err });

describe('panel tab isolation — reducer matrix', () => {
  test('idle → switch tabs → conversations swap cleanly (no stale content)', () => {
    const convA = convWithUser('tab A message');
    const convB = convWithUser('tab B message');

    let s = run(initPanelState(convA)); // panel shows tab A
    expect(s.conv.messages).toHaveLength(1);
    expect(s.conv.messages[0].text).toBe('tab A message');

    s = run(s, { type: 'set_conv', conv: convB }); // switch to tab B
    expect(s.conv.messages).toHaveLength(1);
    expect(s.conv.messages[0].text).toBe('tab B message');

    s = run(s, { type: 'set_conv', conv: convA }); // switch back to A
    expect(s.conv.messages[0].text).toBe('tab A message');
  });

  test('mid-turn → suspend → content preserved (not aborted, not blank)', () => {
    const conv = convWithTurn('navigate to origin pools', 'asst-1');
    let s = run(initPanelState(conv), { type: 'begin_turn', id: 'c-1', msgId: 'asst-1' });
    expect(s.active).not.toBeNull();

    // Stream some content
    s = run(s, { type: 'stream', msg: delta('c-1', 'Navigating to origin pools') });
    expect(s.conv.messages.find((m) => m.id === 'asst-1')?.text).toContain('Navigating');

    // Suspend on tab switch
    s = run(s, { type: 'suspend_turn' });
    expect(s.active).toBeNull(); // turn tracking cleared
    // Content is PRESERVED (not aborted, not blank)
    expect(s.conv.messages.find((m) => m.id === 'asst-1')?.text).toContain('Navigating');
    expect(s.conv.messages.find((m) => m.id === 'asst-1')?.aborted).toBeFalsy();
  });

  test('suspended turn stream events → ignored (no cross-tab bleed)', () => {
    const conv = convWithTurn('tab A work', 'asst-a');
    let s = run(initPanelState(conv), { type: 'begin_turn', id: 'c-a', msgId: 'asst-a' });
    s = run(s, { type: 'stream', msg: delta('c-a', 'Working on A') });
    s = run(s, { type: 'suspend_turn' }); // tab switch

    // Switch to tab B with its own conversation
    const convB = convWithTurn('tab B work', 'asst-b');
    s = run(s, { type: 'set_conv', conv: convB }, { type: 'begin_turn', id: 'c-b', msgId: 'asst-b' });

    // Tab A's stream arrives while B is displayed — must be IGNORED
    s = run(s, { type: 'stream', msg: delta('c-a', ' — more A content') });
    // B's conversation is untouched by A's stream
    expect(s.conv.messages.find((m) => m.id === 'asst-b')?.text ?? '').not.toContain('A content');
    // B's own stream applies correctly
    s = run(s, { type: 'stream', msg: delta('c-b', 'Working on B') });
    expect(s.conv.messages.find((m) => m.id === 'asst-b')?.text).toContain('Working on B');
  });

  test('both tabs used → each has own transcript (no bleed, no injection)', () => {
    // Tab A: user sends, turn starts, streams
    const convA = convWithTurn('A: list health checks', 'asst-a');
    let s = run(
      initPanelState(convA),
      { type: 'begin_turn', id: 'c-a', msgId: 'asst-a' },
      { type: 'stream', msg: delta('c-a', 'Health checks: barba, blazz-del') },
    );
    // Suspend A, switch to B
    s = run(s, { type: 'suspend_turn' });
    const savedConvA = s.conv; // save A's conversation (controller does this)

    const convB = convWithTurn('B: list origin pools', 'asst-b');
    s = run(
      s,
      { type: 'set_conv', conv: convB },
      { type: 'begin_turn', id: 'c-b', msgId: 'asst-b' },
      { type: 'stream', msg: delta('c-b', 'Origin pools: op-1, op-2') },
    );

    // B's transcript has B's content ONLY
    expect(s.conv.messages.find((m) => m.id === 'asst-b')?.text).toContain('Origin pools');
    expect(s.conv.messages.find((m) => m.id === 'asst-b')?.text).not.toContain('Health checks');

    // Switch back to A — load saved conv
    s = run(s, { type: 'suspend_turn' }, { type: 'set_conv', conv: savedConvA });

    // A's transcript has A's content ONLY (not blank, not B's content)
    expect(s.conv.messages.find((m) => m.id === 'asst-a')?.text).toContain('Health checks');
    expect(s.conv.messages.find((m) => m.id === 'asst-a')?.text).not.toContain('Origin pools');
  });

  test('return to tab with suspended turn → partial content visible (NOT blank)', () => {
    const conv = convWithTurn('navigate to app firewall', 'asst-1');
    let s = run(
      initPanelState(conv),
      { type: 'begin_turn', id: 'c-1', msgId: 'asst-1' },
      { type: 'stream', msg: delta('c-1', 'Navigating to App Firewall — watch the browser.') },
      { type: 'suspend_turn' }, // tab switch away
    );
    const savedConv = s.conv;

    // Switch to another tab (different conv)
    s = run(s, { type: 'set_conv', conv: newConversation('conv-other', now()) });

    // Return to original tab
    s = run(s, { type: 'set_conv', conv: savedConv });

    // The partial turn content is THERE (not blank)
    const asst = s.conv.messages.find((m) => m.id === 'asst-1');
    expect(asst).toBeDefined();
    expect(asst?.text).toContain('App Firewall');
    expect(asst?.aborted).toBeFalsy();
  });

  test('tab close mid-turn → turn aborted (not suspended)', () => {
    const conv = convWithTurn('running task', 'asst-1');
    const s = run(
      initPanelState(conv),
      { type: 'begin_turn', id: 'c-1', msgId: 'asst-1' },
      { type: 'stream', msg: delta('c-1', 'Working...') },
      { type: 'abort_turn', at: now() },
    );
    expect(s.active).toBeNull();
    expect(s.conv.messages.find((m) => m.id === 'asst-1')?.aborted).toBe(true);
  });

  test('chat_done for a suspended turn → ignored (does not alter displayed conv)', () => {
    const conv = convWithTurn('tab A task', 'asst-a');
    let s = run(
      initPanelState(conv),
      { type: 'begin_turn', id: 'c-a', msgId: 'asst-a' },
      { type: 'stream', msg: delta('c-a', 'Working') },
      { type: 'suspend_turn' },
    );
    const convB = convWithUser('tab B is now active');
    s = run(s, { type: 'set_conv', conv: convB });

    // A's chat_done arrives after suspension — must NOT affect B's displayed conv
    const beforeConv = s.conv;
    s = run(s, { type: 'stream', msg: done('c-a') });
    expect(s.conv).toBe(beforeConv); // unchanged reference — event was ignored
  });

  test('chat_error for a suspended turn → ignored', () => {
    const conv = convWithTurn('failing task', 'asst-x');
    let s = run(initPanelState(conv), { type: 'begin_turn', id: 'c-x', msgId: 'asst-x' }, { type: 'suspend_turn' });
    const convB = convWithUser('tab B active');
    s = run(s, { type: 'set_conv', conv: convB });

    const beforeConv = s.conv;
    s = run(s, { type: 'stream', msg: error('c-x', 'turn failed on other tab') });
    expect(s.conv).toBe(beforeConv); // unchanged — error for suspended turn ignored
  });
});
