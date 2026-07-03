#!/usr/bin/env node
/**
 * Upload + publish the Chrome Web Store package, with HONEST error handling.
 *
 * Wraps `chrome-webstore-upload-cli@3` (which reads the OAuth credentials from
 * the EXTENSION_ID / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN env vars). Unlike a
 * blanket `... || echo warning`, this classifies failures. Crucially, the
 * "in review" lock is handled DIFFERENTLY for upload vs publish, because they
 * mean opposite things for whether the version actually shipped:
 *
 *   - SUCCESS                      → exit 0
 *   - PUBLISH blocked by in-review → ::warning:: + exit 0. The package WAS
 *     (ITEM_NOT_UPDATABLE on         uploaded as a draft; only the publish
 *      publish)                      transition is held, and CWS publishes the
 *                                    draft automatically once review clears.
 *   - UPLOAD blocked by in-review  → ::error:: + exit 1. The upload was
 *     (ITEM_NOT_UPDATABLE on         REJECTED, so this version was neither
 *      upload)                       uploaded nor queued — it did NOT ship. Fail
 *                                    loudly (never report a phantom "queued"
 *                                    success); re-run the release after the
 *                                    in-review submission is approved.
 *   - ANYTHING ELSE (bad/expired   → ::error:: + exit 1 (fail the release loudly
 *     credentials, network, quota,   so a real break is visible, never silently
 *     wrong EXTENSION_ID, …)         swallowed)
 *
 * Usage: node scripts/publish-cws.mjs [version]
 */
import { execFileSync } from 'node:child_process';

const ZIP = 'xcsh-chrome-extension.zip';
const CLI = ['--yes', 'chrome-webstore-upload-cli@3'];
// Markers that mean "the item is locked because a prior submission is in review".
// Tolerated ONLY on the publish step (the draft is already uploaded and CWS
// publishes it later); on the upload step it is a hard failure — nothing shipped.
const TRANSIENT = /ITEM_NOT_UPDATABLE|in[\s_-]?review|currently being reviewed|pending review/i;

const version = process.argv[2] ?? '';

for (const name of ['EXTENSION_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']) {
  if (!process.env[name]) {
    console.error(`::error::publish-cws: missing required env var ${name}`);
    process.exit(1);
  }
}

/** Run a CWS CLI subcommand, capturing output. Returns { ok, output }. */
function run(args) {
  try {
    const output = execFileSync('npx', [...CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(output);
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

// The publish transition was held because a prior submission is still in
// review. The package IS uploaded as a draft; CWS publishes it automatically
// once that review clears — so this is genuinely deferred, not dropped.
function deferPublish() {
  console.log(
    `::warning::Chrome Web Store publish deferred — a previous submission is still in review. ` +
      `v${version || '(next)'} is uploaded as a draft and will publish automatically once the current review clears.`,
  );
  process.exit(0);
}

function fail(step, output) {
  console.error(`::error::Chrome Web Store ${step} failed:`);
  if (output) console.error(output);
  process.exit(1);
}

const uploaded = run(['upload', '--source', ZIP]);
if (!uploaded.ok) {
  // An upload rejected because the item is locked by an in-review submission
  // means this version was NEITHER uploaded NOR queued — it did not ship. Fail
  // loudly; a phantom "queued" success here silently drops the release. Re-run
  // after the in-review submission is approved (the item unlocks then).
  if (TRANSIENT.test(uploaded.output)) {
    fail(
      'upload — item locked by a submission still in review; this version was NOT uploaded or published, re-run after approval',
      uploaded.output,
    ); // exits 1
  }
  fail('upload', uploaded.output); // exits 1
}

const published = run(['publish']);
if (!published.ok) {
  if (TRANSIENT.test(published.output)) deferPublish(); // exits 0 — draft uploaded, auto-publishes later
  fail('publish', published.output); // exits 1
}

console.log(`publish-cws: uploaded + published${version ? ` v${version}` : ''} to the Chrome Web Store.`);
