import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/preact';
import { AssistantMessage, ErrorMessage, ToolMessage, UserMessage } from '../../src/vendor/chat-ui';

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
