import { describe, expect, it } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { CHAT_ERROR_REASONS } from '../src/chat-protocol';
import { ChatErrorSchema } from '../src/chat-schema';

// The chat_error `reason` is the additive (contract 1.6.0) machine-readable cause
// the panel maps to a distinct, actionable message. The wire schema is a CLOSED
// enum so an emitter typo can't ship a meaningless reason; omitting it is valid
// (legacy/unclassified → show the raw error text).
describe('chat_error reason wire field', () => {
  it('accepts a chat_error with no reason (optional, back-compatible)', () => {
    expect(Value.Check(ChatErrorSchema, { type: 'chat_error', id: 'c-1', error: 'boom' })).toBe(true);
  });

  it('accepts every reason in the shared vocabulary', () => {
    for (const reason of CHAT_ERROR_REASONS) {
      expect(Value.Check(ChatErrorSchema, { type: 'chat_error', id: 'c-1', error: 'boom', reason })).toBe(true);
    }
  });

  it('rejects an unknown reason (closed enum)', () => {
    expect(Value.Check(ChatErrorSchema, { type: 'chat_error', id: 'c-1', error: 'boom', reason: 'made-up' })).toBe(
      false,
    );
  });
});
