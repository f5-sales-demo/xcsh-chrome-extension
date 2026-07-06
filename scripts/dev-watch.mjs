#!/usr/bin/env node
/**
 * Auto-rebuild watcher for LOCAL DEVELOPMENT of the unpacked extension.
 *
 * There is no dev server for an MV3 extension — Chrome loads static files from
 * `dist/`, so "iterating on the UI" means: edit source → rebuild `dist/` → click
 * Reload on the extension at chrome://extensions. This script automates the middle
 * step: it runs the real dev build once, then rebuilds on every source change.
 *
 * It intentionally shells out to `bun run build:dev` (bundle + copy assets + inject
 * the dev `key`) rather than re-implementing any of it, so the watched build is byte
 * -identical to a manual `bun run build:dev` and there is a single source of truth.
 *
 * The one step it does NOT automate is the Chrome-side reload: MV3 allows a single
 * service worker, so a self-reload client would have to live in the extension's own
 * service worker (functional code) — out of scope. Each successful rebuild therefore
 * ends with a loud, unmistakable "click Reload" line (+ terminal bell).
 *
 * Usage: bun run watch:dev   (or: node scripts/dev-watch.mjs)
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';

// Source roots whose changes should trigger a rebuild. `src/` (recursive) covers
// all UI/logic; the others are static assets `build.ts` copies verbatim into dist/.
const WATCH_TARGETS = ['src', 'manifest.json', 'managed_schema.json', 'icons'];
const DEBOUNCE_MS = 150;

const stamp = () => new Date().toTimeString().slice(0, 8); // HH:MM:SS (local)
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

let building = false;
let queued = false;

/**
 * Run `bun run build:dev` once. Never rejects — a build failure is logged and
 * swallowed so the watcher keeps running (fix the source, save again, recover).
 * If a change lands mid-build, we coalesce it into exactly one follow-up build.
 */
function build(reason) {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  log(`building… (${reason})`);

  const child = spawn('bun', ['run', 'build:dev'], { stdio: 'inherit' });

  child.on('exit', (code) => {
    building = false;
    if (code === 0) {
      // \x07 = terminal bell; the box makes the one manual action impossible to miss.
      process.stdout.write('\x07');
      log(`↻ rebuilt ${DIST} — click Reload on this extension in chrome://extensions`);
    } else {
      log(`✗ build failed (exit ${code}) — fix the error above and save again; watcher still running`);
    }
    if (queued) {
      queued = false;
      build('coalesced change during previous build');
    }
  });

  child.on('error', (err) => {
    building = false;
    log(`✗ could not start build: ${err.message} (is bun on PATH?)`);
  });
}

let timer = null;
function scheduleBuild(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    build(reason);
  }, DEBOUNCE_MS);
}

// Print the absolute output folder so, when several clones of this repo exist on
// one machine, it is unambiguous which `dist/` to select in "Load unpacked" and
// which extension a "Reload" refers to. This watcher only ever touches paths under
// the clone it was launched from (cwd) — it starts no shared daemon and opens no
// ports, so multiple clones can each run `watch:dev` without interfering on disk.
//
// The one shared resource is Chrome + the xcsh native host: the host binary is
// hardcoded to the single extension ID klajkjdoehjidngligegnpknogmjjhkc, so the
// injected key is fixed and every clone's build carries that same ID. Only ONE
// unpacked build can be loaded and bridged at a time — do not load two at once.
const DIST = resolve('dist');
log(`clone:  ${resolve('.')}`);
log(`output: ${DIST}  ← select THIS folder in chrome://extensions → Load unpacked`);
log('note:   all clones share the fixed ID klajkjdoehjidngligegnpknogmjjhkc (the xcsh');
log('        host is hardcoded to it). Load only ONE unpacked build at a time — to');
log("        switch clones, Remove the other's load first, then Load the folder above.");
log(`watching ${WATCH_TARGETS.join(', ')} — Ctrl+C to stop`);
for (const target of WATCH_TARGETS) {
  try {
    watch(target, { recursive: true }, (_event, file) => {
      scheduleBuild(file ? `${target}/${file}` : target);
    });
  } catch (err) {
    log(`(skip) cannot watch ${target}: ${err.message}`);
  }
}

// Initial build so `dist/` is fresh the moment the watcher starts.
build('initial');
