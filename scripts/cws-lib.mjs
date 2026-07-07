/**
 * Pure, side-effect-free helpers for the Chrome Web Store release step.
 *
 * Kept separate from publish-cws.mjs (which shells out to the CWS CLI and
 * exits the process) so the decision logic is unit-testable under `bun test`.
 */

// Markers that mean the item is locked because a submission is still in review
// or a draft is in "ready to publish" status. This is NO LONGER tolerated as a
// success on any step: a locked item means this version did not ship, and a
// publish left as a "ready to publish" draft locks every subsequent release
// (this was the root cause of the 1.20.10 stall — see issue #211).
export const TRANSIENT = /ITEM_NOT_UPDATABLE|in[\s_-]?review|currently being reviewed|ready to publish|pending review/i;

/**
 * Classify a CWS CLI step result. Both `upload` and `publish` failures are
 * hard failures — `locked` only tailors the operator-facing message, it does
 * not change the outcome.
 *
 * @param {'upload'|'publish'} step
 * @param {{ ok: boolean, output?: string }} result
 * @returns {{ action: 'ok'|'fail', step: string, locked: boolean, output: string }}
 */
export function classifyOutcome(step, result) {
  const output = result.output ?? '';
  if (result.ok) return { action: 'ok', step, locked: false, output };
  return { action: 'fail', step, locked: TRANSIENT.test(output), output };
}

/**
 * Operator-facing message body for a failed outcome (the `::error::` text).
 *
 * @param {{ step: string, locked: boolean }} outcome
 * @param {string} version
 * @returns {string}
 */
export function failureMessage(outcome, version) {
  const v = version ? `v${version}` : '(next)';
  if (outcome.locked) {
    return (
      `Chrome Web Store ${outcome.step} blocked — the item is locked by a submission still in ` +
      `review or a draft in "ready to publish" status. ${v} did NOT ship. Resolve the draft in ` +
      `the Developer Dashboard (publish or discard it), then re-run the release once the item is updatable.`
    );
  }
  return `Chrome Web Store ${outcome.step} failed for ${v}.`;
}

/**
 * Best-effort delete of the git tag that semantic-release created BEFORE this
 * publish step ran. semantic-release pushes the version tag ahead of the
 * publish plugins, so a failed upload/publish would otherwise leave a phantom
 * tag — the git version drifts ahead of the actually-shipped CWS version and a
 * plain re-run does nothing (semantic-release thinks it already released it).
 *
 * Deleting the ref keeps git honest so the next run recomputes correctly. This
 * NEVER throws: tag cleanup must not mask the real CWS error.
 *
 * @param {{ tag: string, repo: string, token: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<boolean>} true iff the ref is gone afterwards (deleted or already absent)
 */
export async function deleteTagRef({ tag, repo, token, fetchImpl = fetch }) {
  if (!tag || !repo || !token) return false;
  const url = `https://api.github.com/repos/${repo}/git/refs/tags/${tag}`;
  try {
    const res = await fetchImpl(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    // 204 = deleted; 404/422 = ref already absent. All three mean "no phantom tag".
    return res.status === 204 || res.status === 404 || res.status === 422;
  } catch {
    return false;
  }
}
