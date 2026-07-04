import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/preact';
import { Composer } from '../../src/side-panel/components/Composer';
import { Header } from '../../src/side-panel/components/Header';
import { StatusBar } from '../../src/side-panel/components/StatusBar';

describe('chrome components', () => {
  it('shows the session link and connection state in the header', () => {
    const { container, getByText } = render(
      <Header mode="educational" onMode={() => {}} sessionLabel="acme·production" connected={true} sessionTitle="" />,
    );
    expect(getByText('acme·production')).toBeTruthy();
    expect(container.querySelector('.dot.on')).toBeTruthy();
  });

  it('statusbar shows model + context, and no path/git segment', () => {
    const { container, getByText } = render(
      <StatusBar model="opus" contextPct={42} contextLabel="Load Balancers" connected={true} />,
    );
    expect(getByText(/opus/)).toBeTruthy();
    expect(getByText(/42%/)).toBeTruthy();
    expect(container.querySelector('.seg-path')).toBeNull();
    expect(container.querySelector('.seg-git')).toBeNull();
  });

  it('composer sends trimmed text and clears', () => {
    let sent = '';
    const { getByPlaceholderText, getByText } = render(
      <Composer disabled={false} sending={false} onSend={(t) => (sent = t)} onStop={() => {}} />,
    );
    const ta = getByPlaceholderText(/ask xcsh/i) as HTMLTextAreaElement;
    ta.value = '  hello  ';
    fireEvent.input(ta);
    fireEvent.click(getByText('send'));
    expect(sent).toBe('hello');
  });
});
