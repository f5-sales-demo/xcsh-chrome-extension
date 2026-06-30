import { describe, expect, it } from 'bun:test';
import { escapeHtml, isSafeUrl, renderMarkdown, renderReferenceChip } from '../src/markdown-render';

describe('escaping & url safety', () => {
  it('escapes html', () => {
    expect(escapeHtml('<b>&"x"')).toBe('&lt;b&gt;&amp;&quot;x&quot;');
  });
  it('allows http(s)/mailto only', () => {
    expect(isSafeUrl('https://x')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,x')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('renders bold, inline code, and safe links with rel=noopener', () => {
    const html = renderMarkdown('Use **bold** and `code` see [docs](https://d/p)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://d/p"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
  it('neutralizes script and javascript: links', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });
});

describe('renderReferenceChip', () => {
  it('escapes the title and keeps a safe href', () => {
    const html = renderReferenceChip({ title: '<x>', url: 'https://d', kind: 'doc' });
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('href="https://d"');
  });
  it('falls back to href="#" and strips javascript: url', () => {
    const html = renderReferenceChip({ title: 't', url: 'javascript:alert(1)' });
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });
});

describe('escapeHtml single quotes', () => {
  it('escapes single quotes to &#39;', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });
  it('existing test still passes (no single quote in original input)', () => {
    expect(escapeHtml('<b>&"x"')).toBe('&lt;b&gt;&amp;&quot;x&quot;');
  });
});

describe('renderMarkdown security', () => {
  it('forged placeholder token does not produce "undefined" and contains no injected tag', () => {
    // A user who types the raw placeholder token string must not cause "undefined" in output
    const html = renderMarkdown('BLOCKPLACEHOLDER0BLOCKPLACEHOLDER');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('<');
  });
  it('renders italic with <em>', () => {
    const html = renderMarkdown('*italic*');
    expect(html).toContain('<em>italic</em>');
  });
});
