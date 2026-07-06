/**
 * Headless overlay-render UAT (issue #192). Loads the REAL built side panel
 * (dist/side-panel.html + bundle + CSS) in Chrome-for-Testing and drives the
 * readiness overlay through its states via an INJECTED chrome-port stub — no
 * real service worker, bridge, or provisioning, so it is deterministic and
 * free of the MV3 flakiness that made the prior full-stack harness unreliable.
 *
 * It verifies what the fast bun tests cannot: that the real bundle loads and
 * PAINTS the overlay in a real browser, gates through message-by-message, and
 * reveals the panel when ready. Failure-state renders (blocked/disconnected)
 * are driven behind their real timeouts as optional slower scenarios.
 *
 * Run: bun run uat:overlay   (or: node test/uat/overlay-render.mjs)
 * Exits non-zero on any assertion mismatch. Screenshots → test/uat/.artifacts/.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PANEL_HTML = pathToFileURL(join(REPO, 'dist', 'side-panel.html')).href;
const ARTIFACTS = join(HERE, '.artifacts');
const FULL = process.argv.includes('--full'); // also drive the timeout-gated failure renders (slower)

const TAB = { id: 7, url: 'https://acme.console.ves.volterra.io/web/home' };
const KEY = 'acme|production';

// --- locate Chrome-for-Testing (cached by @puppeteer/browsers) or CHROME_BIN ---
function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = join(process.env.HOME, '.cache', 'puppeteer', 'chrome');
  if (!existsSync(base))
    throw new Error('no cached Chrome-for-Testing; set CHROME_BIN or `npx @puppeteer/browsers install chrome`');
  const verParts = (d) => (d.split('-')[1] ?? '').split('.').map(Number);
  const byVersion = (a, b) => {
    const x = verParts(a);
    const y = verParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  };
  const dirs = readdirSync(base)
    .filter((d) => d.startsWith('mac') || d.startsWith('linux') || d.startsWith('win'))
    .sort(byVersion);
  const latest = dirs.at(-1);
  const mac = join(
    base,
    latest,
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  );
  if (existsSync(mac)) return mac;
  const linux = join(base, latest, 'chrome-linux64', 'chrome');
  if (existsSync(linux)) return linux;
  throw new Error(`Chrome binary not found under ${join(base, latest)}`);
}

// --- the chrome stub injected before the bundle runs (serialized into the page) ---
function stub(tab) {
  const listeners = [];
  const posted = [];
  const store = {};
  const noop = { addListener() {}, removeListener() {} };
  globalThis.__xcsh = {
    posted,
    push: (frame) => {
      for (const fn of listeners.slice()) fn(frame);
    },
    reqIdOf: (type) => [...posted].reverse().find((m) => m && m.type === type && typeof m.reqId === 'number')?.reqId,
    postedTypes: () => posted.map((m) => m && m.type),
  };
  globalThis.chrome = {
    runtime: {
      id: 'stub-extension-id',
      connect: () => ({
        name: 'xcsh-chat',
        onMessage: {
          addListener: (fn) => listeners.push(fn),
          removeListener: (fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
        postMessage: (m) => posted.push(m),
        onDisconnect: noop,
        disconnect() {},
      }),
    },
    tabs: {
      onActivated: noop,
      onUpdated: noop,
      query: () => Promise.resolve([tab]),
      get: (id) => (id === tab.id ? Promise.resolve(tab) : Promise.reject(new Error('no tab'))),
    },
    storage: {
      local: {
        get: (k) => Promise.resolve(typeof k === 'string' ? { [k]: store[k] } : {}),
        set: (o) => {
          Object.assign(store, o);
          return Promise.resolve();
        },
        remove: (ks) => {
          for (const k of [].concat(ks)) delete store[k];
          return Promise.resolve();
        },
      },
    },
  };
}

// --- assertion plumbing ---
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const q = (page) =>
  page.evaluate(() => {
    const ov = document.querySelector('.activation-overlay');
    return {
      overlay: !!ov,
      overlayText: ov?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      gates: [...document.querySelectorAll('.ov-gate')].map((g) => ({
        cls: g.className,
        label: g.querySelector('.ov-label')?.textContent ?? '',
        ms: g.querySelector('.ov-ms')?.textContent ?? '',
      })),
      retry: !!document.querySelector('.ov-retry'),
      sendDisabled: document.querySelector('#send')?.hasAttribute('disabled') ?? null,
      chip: document.querySelector('#ctx-chip')?.textContent ?? '',
      postedTypes: globalThis.__xcsh?.postedTypes?.() ?? [],
    };
  });
const push = (page, frame) => page.evaluate((f) => globalThis.__xcsh.push(f), frame);
const waitFor = async (page, pred, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred(await q(page))) return true;
    await sleep(50);
  }
  return false;
};

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  if (!existsSync(fileURLToPath(PANEL_HTML))) {
    console.error('dist/side-panel.html missing — run `bun run build:dev` first');
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 380, height: 720 });
    page.on('pageerror', (e) => ok(`no page error`, false, String(e)));
    await page.evaluateOnNewDocument(`(${stub})(${JSON.stringify(TAB)})`);
    await page.goto(PANEL_HTML, { waitUntil: 'load' });

    // 1. Cold activation → readying overlay renders + input locked
    ok('readying overlay appears', await waitFor(page, (s) => s.overlay && /getting ready/i.test(s.overlayText)));
    let s = await q(page);
    ok(
      'bridge gate is the connecting line',
      s.gates[0]?.label === 'connecting to xcsh…',
      s.gates.map((g) => g.label).join(' | '),
    );
    ok('input locked while readying', s.sendDisabled === true, `sendDisabled=${s.sendDisabled}`);
    ok(
      'overlay actually paints (has box)',
      await page.evaluate(() => {
        const el = document.querySelector('.activation-overlay');
        const r = el?.getBoundingClientRect();
        return !!r && r.width > 100 && r.height > 100;
      }),
    );
    await page.screenshot({ path: join(ARTIFACTS, '1-readying.png') });

    // 2. bridge connects → worker gate active
    await push(page, { type: 'status', connected: true });
    ok(
      'worker gate becomes active after status connected',
      await waitFor(page, (s) => s.gates[1]?.cls?.includes('ov-active')),
    );
    ok('bridge gate shows passed (✓/ms)', (await q(page)).gates[0]?.cls?.includes('ov-passed'));
    ok('gate_blocked posted to drive reprovision', (await q(page)).postedTypes.includes('gate_blocked'));

    // 3. worker binds via bridges → page gate active, get_page_context requested
    await push(page, { type: 'bridges', tenants: [{ tenant: KEY, env: 'production' }] });
    ok('page gate active after worker binds', await waitFor(page, (s) => /reading this page/i.test(s.overlayText)));
    const reqId = await page.evaluate(() => globalThis.__xcsh.reqIdOf('get_page_context'));
    ok('get_page_context requested with a run reqId', typeof reqId === 'number', `reqId=${reqId}`);
    ok('still gated (overlay up) until page snapshot', (await q(page)).overlay === true);

    // 4. correlated page snapshot → ready: overlay gone, input enabled, chip shows the page
    await push(page, { type: 'page_context', snapshot: { title: 'Acme Console', path: '/web/home' }, reqId });
    ok('overlay dismissed at ready', await waitFor(page, (s) => s.overlay === false));
    s = await q(page);
    ok('input enabled at ready', s.sendDisabled === false, `sendDisabled=${s.sendDisabled}`);
    ok('page chip shows the driven page', /Acme Console/.test(s.chip), s.chip);
    await page.screenshot({ path: join(ARTIFACTS, '2-ready.png') });

    // (The reqId negative path — a stale snapshot for a superseded run is ignored —
    // is exhaustively covered deterministically in the bun activation UAT.)

    if (FULL) {
      // Optional slower scenarios: failure-state renders gated by real timeouts.
      const p2 = await browser.newPage();
      await p2.setViewport({ width: 380, height: 720 });
      await p2.evaluateOnNewDocument(`(${stub})(${JSON.stringify(TAB)})`);
      await p2.goto(PANEL_HTML, { waitUntil: 'load' });
      await waitFor(p2, (s) => s.overlay); // wait for the port listener to register before pushing
      await push(p2, { type: 'status', connected: true }); // worker active; no bridges → 15s stall
      ok(
        'blocked render: "xcsh didn\'t start" + Retry (~15s)',
        await waitFor(p2, (s) => /didn.t start/i.test(s.overlayText) && s.retry, 17000),
      );
      await p2.screenshot({ path: join(ARTIFACTS, '3-blocked.png') });
      await p2.close();

      const p3 = await browser.newPage();
      await p3.setViewport({ width: 380, height: 720 });
      await p3.evaluateOnNewDocument(`(${stub})(${JSON.stringify(TAB)})`);
      await p3.goto(PANEL_HTML, { waitUntil: 'load' });
      // no status → 10s bridge stall → disconnected
      ok(
        'disconnected render: "xcsh not connected" + Retry (~10s)',
        await waitFor(p3, (s) => /not connected/i.test(s.overlayText) && s.retry, 12000),
      );
      await p3.screenshot({ path: join(ARTIFACTS, '4-disconnected.png') });
      await p3.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''}`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
