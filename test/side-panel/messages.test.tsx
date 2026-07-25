import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/preact';
import { newConversation } from '../../src/references-store';
import { convToMessages } from '../../src/side-panel/adapt';
import { AssistantMessage, ErrorMessage, ToolMessage, Transcript, UserMessage } from '../../src/vendor/chat-ui';

// These render the VENDORED shared message components under preact/compat — the
// Phase-5 interop regression proof (the components themselves are unit-tested at
// their xcsh home in React).
describe('transcript messages', () => {
  it('renders assistant markdown as HTML via renderMarkdown', () => {
    const { container } = render(<AssistantMessage text="**bold**" />);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('.gutter')?.textContent).toBe('●');
  });

  it('renders the user message as the F5 admonition block (π gutter, italic, never HTML)', () => {
    const { container, getByText } = render(<UserMessage text="<b>hi</b>" />);
    expect(container.querySelector('.gutter')?.textContent).toBe('π');
    // user text is a text node, not parsed HTML
    expect(container.querySelector('b')).toBeNull();
    expect(getByText('<b>hi</b>')).toBeTruthy();
    expect(container.querySelector('.msg-user')).toBeTruthy();
  });

  it('renders a tool notice with ok/fail glyph', () => {
    // A tool notice WITH detail text is now a collapsible <details>: the label and
    // status sit in the <summary>, the output in <pre>. (It used to be one flat row,
    // which is why this assertion reads by class rather than by matched text.)
    const okRender = render(<ToolMessage tool="click" ok={true} text="clicked" />);
    expect(okRender.container.querySelector('.tool-activity-status')?.textContent).toBe('✓');
    expect(okRender.container.querySelector('.tool-activity-detail')?.textContent).toBe('clicked');
    okRender.unmount();

    // The failure glyph — which this test's name always promised but never checked.
    const failRender = render(<ToolMessage tool="click" ok={false} text="boom" />);
    expect(failRender.container.querySelector('.tool-activity-status')?.textContent).toBe('✗');
  });

  it('renders an error message with no Retry button by default', () => {
    const { container, getByText } = render(<ErrorMessage text="xcsh stopped responding" />);
    expect(getByText('xcsh stopped responding')).toBeTruthy();
    expect(container.querySelector('.msg-retry')).toBeNull();
  });

  it('shows a Retry button that fires onRetry when the failure is recoverable', () => {
    let clicked = 0;
    const { container } = render(<ErrorMessage text="lost connection" onRetry={() => (clicked += 1)} />);
    const btn = container.querySelector('.msg-retry') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Retry');
    fireEvent.click(btn);
    expect(clicked).toBe(1);
  });
});

// End-to-end for citations: the store's normalised shape → convToMessages → the
// vendored Transcript → real DOM. The adapt unit tests prove the mapping is
// SHAPED right; this proves a cited source actually PAINTS as a usable link.
describe('cited sources reach the DOM', () => {
  it('renders a clickable chip for each source the answer cited', () => {
    const conv = {
      ...newConversation('c1', 0),
      references: [
        { id: 'r0', kind: 'doc', title: 'HTTP LB guide', url: 'https://docs.cloud.f5.com/lb', firstSeenMsg: 'a1' },
        { id: 'r1', kind: 'console', title: 'Load Balancers', url: 'https://tenant.console.ves.volterra.io/lb', firstSeenMsg: 'a1' },
      ],
      messages: [{ id: 'a1', role: 'assistant', text: 'Use an HTTP LB.', at: 0, refs: ['r0', 'r1'] }],
    } as never;

    const { container } = render(<Transcript messages={convToMessages(conv)} streaming={false} />);

    const links = Array.from(container.querySelectorAll('a')).map((a) => ({
      href: a.getAttribute('href'),
      rel: a.getAttribute('rel'),
      text: a.textContent,
    }));
    expect(links.map((l) => l.href)).toEqual([
      'https://docs.cloud.f5.com/lb',
      'https://tenant.console.ves.volterra.io/lb',
    ]);
    expect(links[0].text).toContain('HTTP LB guide');
    // Opened from a side panel, so each must be a safe external link.
    expect(links.every((l) => (l.rel ?? '').includes('noopener'))).toBe(true);
  });

  it('an answer that cited nothing renders no chip row', () => {
    const conv = {
      ...newConversation('c1', 0),
      messages: [{ id: 'a1', role: 'assistant', text: 'No sources needed.', at: 0 }],
    } as never;
    const { container } = render(<Transcript messages={convToMessages(conv)} streaming={false} />);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
