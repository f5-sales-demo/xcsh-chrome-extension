#!/usr/bin/env node
/**
 * Upload + publish the Chrome Web Store package, with HONEST error handling.
 *
 * Wraps `chrome-webstore-upload-cli@3` (which reads the OAuth credentials from
 * the EXTENSION_ID / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN env vars).
 *
 * A version that did not go live is NEVER reported as shipped. Both steps fail
 * loudly:
 *
 *   - SUCCESS                       → exit 0
 *   - UPLOAD or PUBLISH blocked by  → ::error:: + exit 1. The item is locked by
 *     an in-review / ready-to-       a submission in review or a "ready to
 *     publish lock                   publish" draft, so nothing shipped. (The
 *                                    old pipeline exited 0 on a publish lock,
 *                                    assuming CWS would auto-publish the draft
 *                                    later — it does not; the draft then locks
 *                                    every future release. See issue #211.)
 *   - ANYTHING ELSE (bad/expired    → ::error:: + exit 1.
 *     credentials, network, quota,
 *     wrong EXTENSION_ID, …)
 *
 * On ANY failure the git tag semantic-release already pushed for this version
 * is deleted (best-effort), because semantic-release tags BEFORE the publish
 * plugins run — leaving it would drift the git version ahead of the shipped
 * CWS version and stop a clean re-run. See scripts/cws-lib.mjs.
 *
 * Usage: node scripts/publish-cws.mjs [version]
 */
import { execFileSync } from 'node:child_process';
import { classifyOutcome, deleteTagRef, failureMessage } from './cws-lib.mjs';

const ZIP = 'xcsh-chrome-extension.zip';
const CLI = ['--yes', 'chrome-webstore-upload-cli@3'];

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

/**
 * Surface the CWS failure, reconcile the phantom tag, and exit 1. The real CWS
 * error is always printed first; tag cleanup is best-effort and never masks it.
 */
async function reconcileTagAndFail(outcome) {
  console.error(`::error::${failureMessage(outcome, version)}`);
  if (outcome.output) console.error(outcome.output);
  if (version) {
    const tag = `v${version}`;
    const removed = await deleteTagRef({
      tag,
      repo: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
    });
    console.error(
      removed
        ? `::warning::Removed tag ${tag} — nothing shipped; a re-run will recompute the version.`
        : `::warning::Could not auto-remove tag ${tag}; delete it before re-running: git push origin --delete ${tag}`,
    );
  }
  process.exit(1);
}

const uploadOutcome = classifyOutcome('upload', run(['upload', '--source', ZIP]));
if (uploadOutcome.action === 'fail') await reconcileTagAndFail(uploadOutcome);

const publishOutcome = classifyOutcome('publish', run(['publish']));
if (publishOutcome.action === 'fail') await reconcileTagAndFail(publishOutcome);

console.log(`publish-cws: uploaded + published${version ? ` v${version}` : ''} to the Chrome Web Store.`);
