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

export const FONT_STACK = "'JetBrains Mono', ui-monospace, Menlo, monospace";

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
