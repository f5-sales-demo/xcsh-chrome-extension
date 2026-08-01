import { describe, expect, it } from 'bun:test';
import { INTERACTION_MODES } from '../../src/chat-protocol';
import { newConversation } from '../../src/references-store';
import { type ActivationState, GATES } from '../../src/side-panel/activation';
import { activationToGates, convToMessages, MODES, overlayBlocked } from '../../src/side-panel/adapt';

function conv(messages: Parameters<typeof addMsgs>[1]) {
  return addMsgs(newConversation('c1', 0), messages);
}
function addMsgs(base: ReturnType<typeof newConversation>, messages: Record<string, unknown>[]) {
  return { ...base, messages: messages as never };
}

describe('convToMessages', () => {
  it('maps user / assistant / tool rows to the shared ChatMessage shape', () => {
    const out = convToMessages(
      conv([
        { id: 'u1', role: 'user', text: 'hi', at: 0 },
        { id: 'a1', role: 'assistant', text: 'hello', at: 0 },
        { id: 't1', role: 'tool', text: 'done', at: 0, tool: 'create_lb', ok: true },
      ]),
    );
    expect(out).toEqual([
      { id: 'u1', role: 'user', text: 'hi' },
      { id: 'a1', role: 'assistant', text: 'hello' },
      { id: 't1', role: 'tool', text: 'done', tool: 'create_lb', ok: true },
    ]);
  });

  it('folds a retryable aborted turn to an error row with the curated copy + retryText', () => {
    const [m] = convToMessages(
      conv([
        { id: 'a1', role: 'assistant', text: '', at: 0, aborted: true, abortReason: 'no-worker', retryPrompt: 'redo' },
      ]),
    );
    expect(m.error).toBe(true);
    expect(m.text).toBe('No xcsh running for this tab — reconnecting…');
    expect(m.retryText).toBe('redo');
  });

  it('a non-retryable abort (user-stop) has no retryText', () => {
    const [m] = convToMessages(
      conv([
        { id: 'a1', role: 'assistant', text: '', at: 0, aborted: true, abortReason: 'user-stop', retryPrompt: 'x' },
      ]),
    );
    expect(m.error).toBe(true);
    expect(m.text).toBe('Stopped.');
    expect(m.retryText).toBeUndefined();
  });

  it('a 4xx uses fixed copy and discards raw provider text', () => {
    const [m] = convToMessages(
      conv([
        { id: 'a1', role: 'assistant', text: 'model not found', at: 0, aborted: true, abortReason: 'provider-4xx' },
      ]),
    );
    expect(m.text).toBe('xcsh could not handle that request.');
  });

  it('fails closed for an invalid abort state with no reason', () => {
    const [message] = convToMessages(conv([{ id: 'a1', role: 'assistant', text: 'boom', at: 0, aborted: true }]));
    expect(message.text).toBe('Invalid abort state.');
  });
});

function stateWith(gates: Partial<ActivationState['gates']>, phase: ActivationState['phase']): ActivationState {
  const base = { status: 'pending' as const, startedAt: null, ms: null };
  return {
    runId: 1,
    cold: false,
    tenant: true,
    startedAt: 0,
    phase,
    gates: { bridge: { ...base }, worker: { ...base }, page: { ...base }, ...gates },
  };
}

describe('activationToGates', () => {
  it('returns the three gates in GATES order with the per-status label copy', () => {
    const g = activationToGates(
      stateWith(
        {
          bridge: { status: 'passed', startedAt: 0, ms: 12 },
          worker: { status: 'active', startedAt: 5, ms: null },
          page: { status: 'stalled', startedAt: 0, ms: 99 },
        },
        'readying',
      ),
    );
    expect(g.map((x) => x.name)).toEqual([...GATES]);
    expect(g[0]).toEqual({ name: 'bridge', label: 'bridge connected', status: 'passed', ms: 12 });
    expect(g[1]).toEqual({ name: 'worker', label: 'starting worker…', status: 'active', startedAt: 5 });
    expect(g[2]).toEqual({ name: 'page', label: 'page unavailable', status: 'stalled', ms: 99 });
  });

  it('emits the stalled bridge/worker actionable copy', () => {
    const g = activationToGates(
      stateWith(
        { bridge: { status: 'stalled', startedAt: 0, ms: 1 }, worker: { status: 'stalled', startedAt: 0, ms: 1 } },
        'blocked',
      ),
    );
    expect(g[0].label).toBe('xcsh not connected — start the CLI');
    expect(g[1].label).toBe("xcsh didn't start");
  });
});

describe('overlayBlocked', () => {
  it('is true only for the hard-stall phases', () => {
    expect(overlayBlocked(stateWith({}, 'blocked'))).toBe(true);
    expect(overlayBlocked(stateWith({}, 'disconnected'))).toBe(true);
    expect(overlayBlocked(stateWith({}, 'readying'))).toBe(false);
    expect(overlayBlocked(stateWith({}, 'ready'))).toBe(false);
  });
});

describe('MODES', () => {
  it('mirrors the wire INTERACTION_MODES ids + labels', () => {
    expect(MODES.map((m) => m.id)).toEqual(INTERACTION_MODES.map((m) => m.id));
    expect(MODES.map((m) => m.label)).toEqual(INTERACTION_MODES.map((m) => m.label));
  });
});

describe('convToMessages · cited sources', () => {
  /** A conversation with a reference pool plus messages that cite ids from it. */
  function convWithRefs(
    references: Array<{ id: string; kind: string; title: string; url: string }>,
    messages: Record<string, unknown>[],
  ) {
    return { ...newConversation('c1', 0), references: references as never, messages: messages as never };
  }

  it('resolves a message’s ref ids against the pool onto ChatMessage.references', () => {
    const [m] = convToMessages(
      convWithRefs(
        [
          { id: 'r0', kind: 'doc', title: 'HTTP LB', url: 'https://docs.cloud.f5.com/lb' },
          { id: 'r1', kind: 'console', title: 'Load Balancers', url: 'https://tenant.console.ves.volterra.io/lb' },
        ],
        [{ id: 'a1', role: 'assistant', text: 'see these', at: 0, refs: ['r0', 'r1'] }],
      ),
    );
    expect(m.references).toEqual([
      { kind: 'doc', title: 'HTTP LB', url: 'https://docs.cloud.f5.com/lb' },
      { kind: 'console', title: 'Load Balancers', url: 'https://tenant.console.ves.volterra.io/lb' },
    ]);
  });

  it('omits references entirely when a message cited nothing', () => {
    const [m] = convToMessages(convWithRefs([], [{ id: 'a1', role: 'assistant', text: 'no sources', at: 0 }]));
    expect(m.references).toBeUndefined();
  });

  it('attributes citations PER MESSAGE (a later answer’s sources stay off an earlier one)', () => {
    const out = convToMessages(
      convWithRefs(
        [
          { id: 'r0', kind: 'doc', title: 'First', url: 'https://d/1' },
          { id: 'r1', kind: 'doc', title: 'Second', url: 'https://d/2' },
        ],
        [
          { id: 'a1', role: 'assistant', text: 'one', at: 0, refs: ['r0'] },
          { id: 'a2', role: 'assistant', text: 'two', at: 1, refs: ['r1'] },
        ],
      ),
    );
    expect(out[0].references?.map((r) => r.title)).toEqual(['First']);
    expect(out[1].references?.map((r) => r.title)).toEqual(['Second']);
  });

  it('skips a ref id missing from the pool instead of crashing', () => {
    const [m] = convToMessages(
      convWithRefs(
        [{ id: 'r0', kind: 'doc', title: 'Kept', url: 'https://d/1' }],
        [{ id: 'a1', role: 'assistant', text: 'x', at: 0, refs: ['r0', 'r-pruned'] }],
      ),
    );
    expect(m.references).toEqual([{ kind: 'doc', title: 'Kept', url: 'https://d/1' }]);
  });

  it('keeps the link when the wire kind is unrecognised (the tag is a hint, not the payload)', () => {
    // chat-schema deliberately types kind as an open string for forward-compat, while
    // the shared component only tags doc/console. An unknown kind must never cost the
    // user the citation.
    const [m] = convToMessages(
      convWithRefs(
        [{ id: 'r0', kind: 'blueprint', title: 'Future', url: 'https://d/new' }],
        [{ id: 'a1', role: 'assistant', text: 'x', at: 0, refs: ['r0'] }],
      ),
    );
    expect(m.references).toHaveLength(1);
    expect(m.references?.[0].url).toBe('https://d/new');
    expect(m.references?.[0].kind).toBe('doc');
  });
});
