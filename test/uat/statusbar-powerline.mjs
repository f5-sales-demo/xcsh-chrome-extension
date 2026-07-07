/**
 * Headless UAT for the statusline powerline caps (issue #213). Renders the REAL
 * panel CSS (PANEL_CSS + token vars) with the exact StatusBar cap markup in
 * Chrome and asserts, via layout geometry, that each clip-path cap is sized to
 * EXACTLY its chip height, is top-aligned, and butts flush against the chip edge
 * — the thing the fast bun tests cannot verify (happy-dom does no layout).
 *
 * The prior Nerd Font glyph caps rendered at 1.32x the bar height and off-center;
 * these assertions would fail on that implementation and pass on the clip-path one.
 *
 * Run: bun run uat:statusbar   Exits non-zero on any mismatch. Screenshot → .artifacts/.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PANEL_CSS } from '../../src/side-panel/panel-style';
import { cssVars, fontFaceCss } from '../../src/ui/theme/tokens';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const ARTIFACTS = join(HERE, '.artifacts');
mkdirSync(ARTIFACTS, { recursive: true });

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(sys)) return sys;
  const base = join(process.env.HOME, '.cache', 'puppeteer', 'chrome');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('mac')) : [];
  const cft =
    dirs.at(-1) &&
    join(
      base,
      dirs.at(-1),
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
  if (cft && existsSync(cft)) return cft;
  throw new Error('no Chrome; set CHROME_BIN');
}

const fontUrl = (p) => pathToFileURL(join(REPO, 'assets', p)).href;
const HTML = `<!doctype html><html><head>
<style>${fontFaceCss(fontUrl)}</style>
<style>${cssVars()}</style>
<style>${PANEL_CSS}</style>
<style>body{margin:0} .frame{position:relative;width:360px;height:64px;margin:24px;background:var(--deep-charcoal);border:1px solid var(--f5-red);border-radius:8px}</style>
</head><body>
<div class="frame">
  <div class="statusbar">
    <span class="seg seg-context" style="background:#1565c0;color:#fff">42%<span class="sep-r" style="background:#1565c0"></span></span>
    <span class="seg-spacer"></span>
    <span class="seg seg-session" style="background:#ca260a;color:#fff"><span class="sep-l" style="background:#ca260a"></span>acme&middot;production</span>
  </div>
</div>
</body></html>`;

const HTML_PATH = join(ARTIFACTS, '_statusbar.html');
writeFileSync(HTML_PATH, HTML);

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--allow-file-access-from-files', '--no-sandbox', '--force-device-scale-factor=3'],
});
let failures = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 120, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const rects = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, width: b.width };
    };
    return {
      segCtx: r('.seg-context'),
      sepR: r('.seg-context .sep-r'),
      segSes: r('.seg-session'),
      sepL: r('.seg-session .sep-l'),
    };
  });

  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`);
    if (!ok) failures++;
  };

  check(
    'left cap height == chip height',
    near(rects.sepL.height, rects.segSes.height),
    `${rects.sepL.height} vs ${rects.segSes.height}`,
  );
  check(
    'left cap top-aligned with chip',
    near(rects.sepL.top, rects.segSes.top),
    `${rects.sepL.top} vs ${rects.segSes.top}`,
  );
  check(
    'left cap flush against chip left edge',
    near(rects.sepL.right, rects.segSes.left),
    `${rects.sepL.right} vs ${rects.segSes.left}`,
  );
  check(
    'right cap height == chip height',
    near(rects.sepR.height, rects.segCtx.height),
    `${rects.sepR.height} vs ${rects.segCtx.height}`,
  );
  check(
    'right cap top-aligned with chip',
    near(rects.sepR.top, rects.segCtx.top),
    `${rects.sepR.top} vs ${rects.segCtx.top}`,
  );
  check(
    'right cap flush against chip right edge',
    near(rects.sepR.left, rects.segCtx.right),
    `${rects.sepR.left} vs ${rects.segCtx.right}`,
  );

  const shot = join(ARTIFACTS, 'statusbar-powerline.png');
  await page.screenshot({ path: shot, clip: { x: 12, y: 12, width: 396, height: 96 } });
  console.log(`\nscreenshot → ${shot}`);
  console.log(
    `chip height=${rects.segSes.height}px  cap height=${rects.sepL.height}px  cap width=${rects.sepL.width}px`,
  );
} finally {
  await browser.close();
  unlinkSync(HTML_PATH);
}
process.exit(failures ? 1 : 0);
