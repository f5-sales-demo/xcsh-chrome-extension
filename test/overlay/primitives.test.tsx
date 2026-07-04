import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/preact';
import { Highlight } from '../../src/overlay/primitives';

describe('overlay primitives', () => {
  it('renders a highlight box at the planned rect', () => {
    const { container } = render(<Highlight rect={{ x: 10, y: 20, w: 100, h: 30 }} label="Save" />);
    const box = container.querySelector('.ov-highlight') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.left).toBe('10px');
    expect(box.style.width).toBe('100px');
  });
});
