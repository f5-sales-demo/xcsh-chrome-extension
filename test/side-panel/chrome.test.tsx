import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/preact';
import { Composer } from '../../src/side-panel/components/Composer';
import { ContextChip } from '../../src/side-panel/components/ContextChip';
import { StatusBar } from '../../src/side-panel/components/StatusBar';

describe('chrome components', () => {
  it('context chip shows the page label and the bridge connection dot', () => {
    const { container, getByText } = render(
      <ContextChip label="F5 Distributed Cloud Console" connected={true} onRefresh={() => {}} onDetach={() => {}} />,
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
    // Caps are pure shapes now (clip-path in CSS): the segment color drives them
    // via `background`, and they carry NO powerline PUA glyph text — that font-
    // metric-dependent approach rendered the cap at 1.32x the bar height (#213).
    expect(capR.textContent).toBe('');
    expect(capL.textContent).toBe('');
    expect(capR.style.background).not.toBe('');
    expect(capL.style.background).not.toBe('');
    // No leftover U+E0B0/E0B2 powerline glyphs anywhere in the bar (checked by
    // codepoint so this source stays pure-ASCII, per the StatusBar convention).
    const hasPua = [...(container.textContent ?? '')].some((c) => {
      const cp = c.codePointAt(0);
      return cp === 0xe0b0 || cp === 0xe0b2;
    });
    expect(hasPua).toBe(false);
  });

  it('composer sends trimmed text and clears', () => {
    let sent = '';
    const { container, getByPlaceholderText } = render(
      <Composer
        disabled={false}
        sending={false}
        mode="educational"
        onMode={() => {}}
        onSend={(t) => (sent = t)}
        onStop={() => {}}
      />,
    );
    const ta = getByPlaceholderText(/ask xcsh/i) as HTMLTextAreaElement;
    ta.value = '  hello  ';
    fireEvent.input(ta);
    fireEvent.click(container.querySelector('#send') as HTMLButtonElement);
    expect(sent).toBe('hello');
  });
});
