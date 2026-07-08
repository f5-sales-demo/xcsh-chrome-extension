import { describe, expect, it } from 'bun:test';
import { CHAT_ERROR_REASONS, PANEL_ONLY_ABORT_REASONS, type PanelAbortReason } from '../src/chat-protocol';
import { abortInfo } from '../src/side-panel/state';

// The committed failure-mode matrix (FAILURE-MODES.md) made executable: every
// turn-failure cause maps to a DISTINCT, actionable, non-terse message, and the
// recovery affordances (retryable / autoRecover) are exactly as documented. This
// is the guard that "all scenarios are accounted for" — a new reason with no
// mapping, a duplicate/terse message, or a mismatched flag fails CI.
const ALL_REASONS: PanelAbortReason[] = [...CHAT_ERROR_REASONS, ...PANEL_ONLY_ABORT_REASONS];

// The single source of truth for expected recovery behavior, mirrored in the doc.
const EXPECTED: Record<PanelAbortReason, { retryable: boolean; autoRecover: boolean }> = {
  'user-stop': { retryable: false, autoRecover: false },
  'tab-closed': { retryable: false, autoRecover: false },
  'first-token-timeout': { retryable: true, autoRecover: true },
  'bridge-disconnected': { retryable: true, autoRecover: true },
  'bridge-unresponsive': { retryable: true, autoRecover: true },
  'no-worker': { retryable: true, autoRecover: true },
  'session-busy': { retryable: true, autoRecover: false },
  'session-disposed': { retryable: true, autoRecover: true },
  'token-expired': { retryable: false, autoRecover: false },
  'token-expiring': { retryable: false, autoRecover: false },
  'provider-4xx': { retryable: false, autoRecover: false },
  'provider-5xx': { retryable: true, autoRecover: false },
};

describe('failure-mode matrix (FAILURE-MODES.md)', () => {
  it('maps every abort reason to a non-empty, non-terse message that is not the bare fallback', () => {
    for (const reason of ALL_REASONS) {
      const { text } = abortInfo(reason);
      expect(text.length).toBeGreaterThan(6); // non-terse
      expect(text).not.toBe('Turn aborted.'); // never the catch-all
      expect(text.trim()).toBe(text);
    }
  });

  it('gives every reason a DISTINCT message (no two failures look identical)', () => {
    const texts = ALL_REASONS.map((r) => abortInfo(r).text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('matches the documented retryable / autoRecover affordances exactly', () => {
    for (const reason of ALL_REASONS) {
      const info = abortInfo(reason);
      expect({ retryable: info.retryable, autoRecover: info.autoRecover }).toEqual(EXPECTED[reason]);
    }
  });

  it('auto-recoverable reasons are always retryable (auto-resend falls back to the Retry button)', () => {
    for (const reason of ALL_REASONS) {
      const info = abortInfo(reason);
      if (info.autoRecover) expect(info.retryable).toBe(true);
    }
  });

  it('an unknown/absent reason falls back to the bare "Turn aborted." (legacy, not retryable)', () => {
    expect(abortInfo(undefined)).toEqual({ text: 'Turn aborted.', retryable: false, autoRecover: false });
  });

  it('covers every wire ChatErrorReason (no emittable cause is unmapped)', () => {
    for (const reason of CHAT_ERROR_REASONS) {
      expect(EXPECTED[reason]).toBeDefined();
    }
  });
});
