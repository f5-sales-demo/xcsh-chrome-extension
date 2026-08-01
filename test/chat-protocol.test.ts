import { describe, expect, it } from 'bun:test';
import {
  buildChatRequest,
  buildChatStop,
  type ChatStreamMsg,
  initChatTurn,
  isChatInbound,
  isSkillsList,
  reduceChatTurn,
} from '../src/chat-protocol';

describe('buildChatRequest', () => {
  it('shapes a chat_request with passthrough context and mode', () => {
    const m = buildChatRequest('c-1', 'hi', { url: 'x' }, 'educational', 7, 'example-corp|production', 'conv-1');
    expect(m).toEqual({
      type: 'chat_request',
      id: 'c-1',
      text: 'hi',
      context: { url: 'x' },
      mode: 'educational',
      tabId: 7,
      sessionKey: 'example-corp|production',
      history_hint: 'conv-1',
    });
  });
  it('omits history_hint when not given', () => {
    const m = buildChatRequest('c-1', 'hi', null, 'presentation', 7, 'example-corp|production');
    expect('history_hint' in m).toBe(false);
    expect(m.mode).toBe('presentation');
  });
  // RC-1 (#166): the panel supplies the tab's current session key so the SW can
  // refuse a worker still bound to the tab's sid but advertising the OLD tenant.
  it('carries tabId and sessionKey when given', () => {
    const m = buildChatRequest('c-1', 'hi', null, 'educational', 7, 'example-corp|staging');
    expect(m.tabId).toBe(7);
    expect(m.sessionKey).toBe('example-corp|staging');
  });
  it('always carries the isolation key and bound tab', () => {
    const m = buildChatRequest('c-1', 'hi', null, 'educational', 7, 'example-corp|production');
    expect(m).toMatchObject({ tabId: 7, sessionKey: 'example-corp|production' });
  });
});

describe('buildChatStop', () => {
  it('shapes a chat_stop message', () => {
    const m = buildChatStop('c-1');
    expect(m).toEqual({ type: 'chat_stop', id: 'c-1' });
  });
});

describe('reduceChatTurn', () => {
  const feed = (msgs: ChatStreamMsg[]) => msgs.reduce(reduceChatTurn, initChatTurn('c-1'));

  it('accumulates ordered deltas', () => {
    const s = feed([
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'Hel' },
      { type: 'chat_delta', id: 'c-1', seq: 1, delta: 'lo' },
    ]);
    expect(s.text).toBe('Hello');
    expect(s.status).toBe('streaming');
  });

  it('ignores duplicate/older seq', () => {
    const s = feed([
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'A' },
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'A' },
      { type: 'chat_delta', id: 'c-1', seq: 1, delta: 'B' },
    ]);
    expect(s.text).toBe('AB');
  });

  it('finalizes on done with references', () => {
    const s = feed([
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'x' },
      { type: 'chat_done', id: 'c-1', references: [{ kind: 'doc', title: 'T', url: 'https://d' }] },
    ]);
    expect(s.status).toBe('done');
    expect(s.references).toHaveLength(1);
  });

  it('records errors and ignores events after a terminal state', () => {
    const s = feed([
      { type: 'chat_error', id: 'c-1', reason: 'provider-5xx' },
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'late' },
    ]);
    expect(s.status).toBe('error');
    expect(s.text).toBe('');
  });

  it('ignores chat_delta with mismatched id', () => {
    const s = feed([
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'Hel' },
      { type: 'chat_delta', id: 'c-2', seq: 1, delta: 'lo' }, // wrong id
    ]);
    expect(s.text).toBe('Hel');
  });

  it('chat_done without references yields empty array', () => {
    const s = feed([
      { type: 'chat_delta', id: 'c-1', seq: 0, delta: 'x' },
      { type: 'chat_done', id: 'c-1' }, // no references
    ]);
    expect(s.status).toBe('done');
    expect(s.references).toEqual([]);
  });
});

describe('isChatInbound', () => {
  it('accepts chat_delta, chat_done, chat_error, and chat_tool_notice', () => {
    expect(isChatInbound({ type: 'chat_delta', id: 'c', seq: 0, delta: '' })).toBe(true);
    expect(isChatInbound({ type: 'chat_done', id: 'c' })).toBe(true);
    expect(isChatInbound({ type: 'chat_error', id: 'c', reason: 'provider-5xx' })).toBe(true);
    expect(isChatInbound({ type: 'chat_error', id: 'c' })).toBe(false);
    expect(isChatInbound({ type: 'chat_tool_notice', id: 'c', tool: 'grep', ok: true })).toBe(true);
    expect(isChatInbound({ type: 'chat_keepalive', id: 'c' })).toBe(true);
    expect(isChatInbound({ type: 'tool_result', id: '1' })).toBe(false);
    expect(isChatInbound(null)).toBe(false);
  });
});

describe('list_skills / skills frames', () => {
  it('isSkillsList accepts a well-formed reply and rejects near-misses', () => {
    expect(isSkillsList({ type: 'skills', skills: [{ name: 'competitive', description: 'battlecards' }] })).toBe(true);
    expect(isSkillsList({ type: 'skills', skills: [] })).toBe(true);
    expect(isSkillsList({ type: 'skills' })).toBe(false);
    expect(isSkillsList({ type: 'skills', skills: 'nope' })).toBe(false);
    expect(isSkillsList({ type: 'chat_done', id: 'c-1' })).toBe(false);
    expect(isSkillsList(null)).toBe(false);
  });

  it('a skills reply is NOT chat-inbound (it carries no turn id to route by)', () => {
    // isChatInbound gates the frames the SW routes via turnToPort.get(frame.id).
    // `skills` is session-level, so widening that guard would route it to undefined.
    expect(isChatInbound({ type: 'skills', skills: [] })).toBe(false);
  });
});
