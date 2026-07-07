import { describe, expect, it } from 'bun:test';
import { classifyOutcome, deleteTagRef, failureMessage, TRANSIENT } from '../scripts/cws-lib.mjs';

const LOCK_OUTPUT =
  "uploadState: 'FAILURE'\nerror_code: 'ITEM_NOT_UPDATABLE'\n" +
  "error_detail: 'The item cannot be updated now because it is in pending review, ready to publish, or deleted status.'";

describe('classifyOutcome', () => {
  it('treats a successful step as ok', () => {
    expect(classifyOutcome('upload', { ok: true, output: 'done' })).toMatchObject({ action: 'ok', step: 'upload' });
    expect(classifyOutcome('publish', { ok: true })).toMatchObject({ action: 'ok', step: 'publish' });
  });

  it('fails a locked upload and flags it as locked', () => {
    const out = classifyOutcome('upload', { ok: false, output: LOCK_OUTPUT });
    expect(out).toMatchObject({ action: 'fail', step: 'upload', locked: true });
  });

  it('fails a locked PUBLISH — no silent defer (root cause of the stuck-draft wedge)', () => {
    const out = classifyOutcome('publish', { ok: false, output: LOCK_OUTPUT });
    // The old pipeline exited 0 here ("CWS auto-publishes later"); it does not,
    // and the ready-to-publish draft then locks every future release.
    expect(out).toMatchObject({ action: 'fail', step: 'publish', locked: true });
  });

  it('fails a generic (non-locked) error without the locked flag', () => {
    const out = classifyOutcome('upload', { ok: false, output: 'network timeout talking to Google' });
    expect(out).toMatchObject({ action: 'fail', step: 'upload', locked: false });
  });
});

describe('failureMessage', () => {
  it('gives an actionable dashboard message for a locked item', () => {
    const msg = failureMessage({ step: 'publish', locked: true }, '1.21.0');
    expect(msg).toContain('v1.21.0');
    expect(msg).toContain('did NOT ship');
    expect(msg.toLowerCase()).toContain('dashboard');
  });

  it('is concise for a generic failure', () => {
    const msg = failureMessage({ step: 'upload', locked: false }, '1.21.0');
    expect(msg).toContain('v1.21.0');
    expect(msg).not.toContain('dashboard');
  });
});

describe('TRANSIENT', () => {
  it('matches every CWS lock phrasing', () => {
    for (const s of ['ITEM_NOT_UPDATABLE', 'pending review', 'ready to publish', 'currently being reviewed']) {
      expect(TRANSIENT.test(s)).toBe(true);
    }
    expect(TRANSIENT.test('some unrelated error')).toBe(false);
  });
});

describe('deleteTagRef', () => {
  const base = { tag: 'v1.21.0', repo: 'owner/repo', token: 'tok' };

  it('DELETEs the git ref with auth and returns true on 204', async () => {
    let seen: { url: string; init: { method: string; headers: Record<string, string> } } | undefined;
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      seen = { url, init };
      return { status: 204 };
    };
    const ok = await deleteTagRef({ ...base, fetchImpl });
    expect(ok).toBe(true);
    expect(seen?.url).toBe('https://api.github.com/repos/owner/repo/git/refs/tags/v1.21.0');
    expect(seen?.init.method).toBe('DELETE');
    expect(seen?.init.headers.Authorization).toBe('Bearer tok');
  });

  it('treats an already-absent ref (404/422) as success', async () => {
    for (const status of [404, 422]) {
      const ok = await deleteTagRef({ ...base, fetchImpl: async () => ({ status }) });
      expect(ok).toBe(true);
    }
  });

  it('never throws and returns false when the request errors or inputs are missing', async () => {
    const rejecting = async () => {
      throw new Error('network down');
    };
    expect(await deleteTagRef({ ...base, fetchImpl: rejecting })).toBe(false);
    expect(await deleteTagRef({ tag: '', repo: 'owner/repo', token: 'tok', fetchImpl: rejecting })).toBe(false);
    expect(await deleteTagRef({ tag: 'v1', repo: '', token: 'tok', fetchImpl: rejecting })).toBe(false);
    expect(await deleteTagRef({ tag: 'v1', repo: 'owner/repo', token: '', fetchImpl: rejecting })).toBe(false);
  });
});
