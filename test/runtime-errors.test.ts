import { describe, expect, it } from 'bun:test';
import { publicRuntimeError } from '../src/runtime-errors';

describe('publicRuntimeError', () => {
  it('does not expose URLs, account values, or page text from internal exceptions', () => {
    const internal = new Error('request failed for a customer console URL and page value');
    const message = publicRuntimeError(internal);

    expect(message).toBe('operation failed; inspect the local browser state and retry');
    expect(message).not.toContain(internal.message);
  });
});
