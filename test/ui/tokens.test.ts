import { describe, expect, it } from 'bun:test';
import { COLORS, GLYPHS, cssVars } from '../../src/ui/theme/tokens';

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
});
