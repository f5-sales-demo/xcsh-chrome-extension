import { describe, expect, it } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { CHAT_ERROR_REASONS } from '../src/chat-protocol';
import { ChatErrorSchema } from '../src/chat-schema';

// The chat_error `reason` is the required machine-readable cause the panel maps
// to fixed actionable copy. Raw provider error text is not part of the contract.
describe('chat_error reason wire field', () => {
  it('rejects a chat_error with no reason', () => {
    expect(Value.Check(ChatErrorSchema, { type: 'chat_error', id: 'c-1' })).toBe(false);
  });

  it('accepts every reason in the shared vocabulary', () => {
    for (const reason of CHAT_ERROR_REASONS) {
      expect(Value.Check(ChatErrorSchema, { type: 'chat_error', id: 'c-1', reason })).toBe(true);
    }
  });

  it('rejects an unknown reason (closed enum)', () => {
    expect(Value.Check(ChatErrorSchema, { type: 'chat_error', id: 'c-1', reason: 'made-up' })).toBe(false);
  });
});
