import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/preact';
import { Composer, ContextChip, StatusBar } from '../../src/vendor/chat-ui';

// Render the VENDORED shared components under preact/compat — the Phase-5 interop
// regression proof (the components are unit-tested at their xcsh home in React).
describe('chrome components (vendored, under preact)', () => {
  it('context chip shows the page label and the bridge connection dot', () => {
    const { container, getByText } = render(
      <ContextChip label="F5 Distributed Cloud Console" connected={true} onRefresh={() => {}} onDismiss={() => {}} />,
    );
    expect(getByText('F5 Distributed Cloud Console')).toBeTruthy();
    expect(container.querySelector('.dot.on')).toBeTruthy();
  });

  it('statusbar shows context% and the tenant session identity, but no cwd/git', () => {
    const { container, getByText } = render(<StatusBar contextPct={42} sessionLabel="acme·production" />);
    expect(getByText(/42%/)).toBeTruthy();
    expect(getByText(/acme·production/)).toBeTruthy();
    expect(container.querySelector('.seg-session')).toBeTruthy();
    // The browser session is tenant-tied, not filesystem-tied: no cwd/path or git.
    expect(container.querySelector('.seg-path')).toBeNull();
    expect(container.querySelector('.seg-git')).toBeNull();
  });

  it('powerline caps are colored CSS-triangle boxes, not Nerd Font glyphs', () => {
    const { container } = render(<StatusBar contextPct={42} sessionLabel="acme·production" />);
    const capR = container.querySelector('.seg-context .sep-r') as HTMLElement;
    const capL = container.querySelector('.seg-session .sep-l') as HTMLElement;
    expect(capR).toBeTruthy();
    expect(capL).toBeTruthy();
    // Caps are pure shapes (clip-path in CSS): the segment color drives them via
    // `background`, and they carry NO powerline PUA glyph text — that font-metric-
    // dependent approach rendered the cap at 1.32x the bar height (#213).
    expect(capR.textContent).toBe('');
    expect(capL.textContent).toBe('');
    expect(capR.style.background).not.toBe('');
    expect(capL.style.background).not.toBe('');
    // No leftover U+E0B0/E0B2 powerline glyphs anywhere in the bar (checked by
    // codepoint so this source stays pure-ASCII).
    const hasPua = [...(container.textContent ?? '')].some((c) => {
      const cp = c.codePointAt(0);
      return cp === 0xe0b0 || cp === 0xe0b2;
    });
    expect(hasPua).toBe(false);
  });

  it('composer sends trimmed text and clears the editor', () => {
    let sent = '';
    const { getByRole } = render(
      <Composer disabled={false} streaming={false} onSend={(t) => (sent = t)} onStop={() => {}} />,
    );
    const editor = getByRole('textbox', { name: /message input/i });
    editor.textContent = '  hello  ';
    fireEvent.input(editor);
    fireEvent.click(getByRole('button', { name: /send/i }));
    expect(sent).toBe('hello');
    expect(editor.textContent).toBe('');
  });
});
