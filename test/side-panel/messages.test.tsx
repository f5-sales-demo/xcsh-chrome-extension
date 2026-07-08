import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/preact';
import { AssistantMessage, ErrorMessage, ToolMessage, UserMessage } from '../../src/side-panel/components/messages';

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
    const { getByText } = render(<ToolMessage tool="click" ok={true} text="clicked" />);
    expect(getByText(/click/).textContent).toContain('✓');
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
