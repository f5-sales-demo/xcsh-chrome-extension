import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/preact';
import { AssistantMessage, ToolMessage, UserMessage } from '../../src/side-panel/components/messages';

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
});
