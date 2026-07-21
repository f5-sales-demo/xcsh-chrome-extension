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

  it('a 4xx prefers the raw provider text over the generic copy', () => {
    const [m] = convToMessages(
      conv([
        { id: 'a1', role: 'assistant', text: 'model not found', at: 0, aborted: true, abortReason: 'provider-4xx' },
      ]),
    );
    expect(m.text).toBe('model not found');
  });

  it('an unclassified abort (no reason) falls back to the raw text or "Turn aborted."', () => {
    const [withText, withoutText] = convToMessages(
      conv([
        { id: 'a1', role: 'assistant', text: 'boom', at: 0, aborted: true },
        { id: 'a2', role: 'assistant', text: '', at: 0, aborted: true },
      ]),
    );
    expect(withText.text).toBe('boom');
    expect(withoutText.text).toBe('Turn aborted.');
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
