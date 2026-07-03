import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/preact';
import { Smoke } from '../../src/ui/smoke';

describe('preact toolchain', () => {
  it('renders a component to the DOM', () => {
    const { getByText } = render(<Smoke label="xcsh" />);
    expect(getByText('xcsh')).toBeTruthy();
  });
});
