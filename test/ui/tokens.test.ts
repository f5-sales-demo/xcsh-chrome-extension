import { describe, expect, it } from 'bun:test';
import { COLORS, cssVars, fontFaceCss, GLYPHS, injectFontFaces, injectTokens } from '../../src/ui/theme/tokens';

describe('theme tokens', () => {
  it('carries the xcsh F5 palette', () => {
    expect(COLORS.f5Red).toBe('#ca260a');
    expect(COLORS.deepCharcoal).toBe('#0f1216');
    expect(COLORS.chromeAccent).toBe('#00b4ff');
  });
  it('exposes the terminal glyphs', () => {
    expect(GLYPHS.assistant).toBe('●');
    expect(GLYPHS.thinking).toBe('✻');
    expect(GLYPHS.userGutter).toBe('π');
    expect(GLYPHS.userBar).toBe('┃');
  });
  it('emits kebab-cased CSS custom properties', () => {
    const css = cssVars();
    expect(css).toContain('--f5-red: #ca260a');
    expect(css).toContain('--deep-charcoal: #0f1216');
  });
  it('sets the terminal font stack to the bundled Nerd Font', () => {
    expect(cssVars()).toContain("--font-mono: 'MesloLGS NF'");
  });
  it('builds one @font-face per bundled weight via the url resolver', () => {
    const css = fontFaceCss((p) => `RESOLVED/${p}`);
    expect((css.match(/@font-face/g) ?? []).length).toBe(4);
    expect(css).toContain("font-family: 'MesloLGS NF'");
    expect(css).toContain("src: url('RESOLVED/fonts/MesloLGS-NF-Regular.ttf')");
    expect(css).toContain('font-style: italic');
    expect(css).toContain('font-weight: bold');
  });
  it('registers the bundled font faces once at the document level', () => {
    injectFontFaces(document, (p) => p);
    injectFontFaces(document, (p) => p);
    expect(document.head.querySelectorAll('#xcsh-fontface').length).toBe(1);
    expect(document.head.querySelector('#xcsh-fontface')?.textContent).toContain('@font-face');
  });
  it('injects a single token stylesheet idempotently into a ShadowRoot', () => {
    const shadow = document.createElement('div').attachShadow({ mode: 'open' });
    injectTokens(shadow);
    injectTokens(shadow);
    expect(shadow.querySelectorAll('#xcsh-tokens').length).toBe(1);
  });
  it('injects a single token stylesheet idempotently into a Document', () => {
    injectTokens(document);
    injectTokens(document);
    expect(document.head.querySelectorAll('#xcsh-tokens').length).toBe(1);
  });
});
