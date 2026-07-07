/** Single typed source of the xcsh terminal look, shared by every surface.
 * Transcribed from xcsh/.../theme/defaults/xcsh-dark.json. */
export const COLORS = {
  f5Red: '#ca260a',
  deepCharcoal: '#0f1216',
  charcoal: '#151820',
  brightWhite: '#e8ecf4',
  coolGray: '#9ca3b0',
  chromeAccent: '#00b4ff',
  signalGreen: '#00ff88',
  alertRed: '#ff4757',
  warmAmber: '#ffb347',
  dim: '#6b7280',
  subtleGray: '#2a3038',
} as const;

export const GLYPHS = {
  assistant: '●',
  thinking: '✻',
  system: '※',
  userGutter: 'π',
  userBar: '┃',
  prompt: '❯',
  cursor: '▏',
  thinkingLevels: ['◔', '◑', '◒', '◕', '◉'],
} as const;

// MesloLGS NF — the Powerlevel10k single-width Nerd Font, bundled under
// `dist/fonts/` (see `injectFontFaces`) so the chat window reads exactly like an
// iTerm2 terminal (glyph coverage for the powerline separators + terminal icons).
// The named fallbacks cover the brief `font-display:swap` window and any surface
// where the face failed to register.
export const FONT_STACK = "'MesloLGS NF', 'JetBrains Mono', ui-monospace, Menlo, monospace";

/** The four bundled MesloLGS NF weights. Family name matches the installed
 * iTerm2 font so it renders identically. Paths are extension-relative and are
 * resolved to absolute `chrome-extension://` URLs by `defaultFontUrl`. */
const FONT_FACES = [
  { file: 'fonts/MesloLGS-NF-Regular.ttf', weight: 'normal', style: 'normal' },
  { file: 'fonts/MesloLGS-NF-Bold.ttf', weight: 'bold', style: 'normal' },
  { file: 'fonts/MesloLGS-NF-Italic.ttf', weight: 'normal', style: 'italic' },
  { file: 'fonts/MesloLGS-NF-Bold-Italic.ttf', weight: 'bold', style: 'italic' },
] as const;

const FONTFACE_ID = 'xcsh-fontface';

/** Default resolver: an extension-relative path → absolute `chrome-extension://`
 * URL. Content scripts inject the font-face into the *host page's* document, so a
 * relative URL would resolve against the page origin and 404 — `getURL` pins it to
 * the extension origin (and the file must be in `web_accessible_resources`).
 * Guarded so importing this module in unit tests (no `chrome`) never throws. */
function defaultFontUrl(path: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
}

/** The `@font-face` block registering all bundled MesloLGS NF weights. */
export function fontFaceCss(getUrl: (p: string) => string = defaultFontUrl): string {
  return FONT_FACES.map(
    (f) =>
      `@font-face { font-family: 'MesloLGS NF'; font-style: ${f.style}; font-weight: ${f.weight};` +
      ` font-display: swap; src: url('${getUrl(f.file)}') format('truetype'); }`,
  ).join('\n');
}

/** Register the bundled Nerd Font once (idempotent) at the DOCUMENT level.
 * `@font-face` rules do NOT resolve inside a ShadowRoot, so — unlike
 * `injectTokens` — this only ever targets a Document's `<head>`: the side-panel /
 * options pages, and (for the Shadow-DOM on-page overlays) the host page document,
 * whose faces the shadow trees then inherit. */
export function injectFontFaces(doc: Document, getUrl: (p: string) => string = defaultFontUrl): void {
  const head = doc.head ?? doc.documentElement;
  if (!head || head.querySelector(`#${FONTFACE_ID}`)) return;
  const style = doc.createElement('style');
  style.id = FONTFACE_ID;
  style.textContent = fontFaceCss(getUrl);
  head.append(style);
}

function kebab(k: string): string {
  return k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** A `:root{…}` block of `--<kebab-color>` custom properties + shared metrics. */
export function cssVars(): string {
  const lines = Object.entries(COLORS).map(([k, v]) => `  --${kebab(k)}: ${v};`);
  lines.push(`  --font-mono: ${FONT_STACK};`);
  lines.push('  --gutter: 2ch;');
  return `:root {\n${lines.join('\n')}\n}`;
}

const STYLE_ID = 'xcsh-tokens';

/** Insert the token stylesheet once into a Document or ShadowRoot.
 * A Document cannot accept element children directly (that throws
 * HierarchyRequestError), so we mount into `<head>` (falling back to
 * `<html>`); a ShadowRoot is itself a valid mount point. `nodeType === 9`
 * (DOCUMENT_NODE) is used to discriminate because `instanceof Document`
 * is unreliable across realms/test DOMs. */
export function injectTokens(root: Document | ShadowRoot): void {
  const isDocument = root.nodeType === 9;
  const mount: ParentNode | null = isDocument
    ? ((root as Document).head ?? (root as Document).documentElement)
    : (root as ShadowRoot);
  if (!mount) return;
  if (mount.querySelector(`#${STYLE_ID}`)) return;
  const doc = isDocument ? (root as Document) : (root as ShadowRoot).ownerDocument;
  if (!doc) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = cssVars();
  mount.append(style);
}
