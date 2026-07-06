import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { activationReducer, initActivation } from '../../src/side-panel/activation';
import { ActivationOverlay } from '../../src/side-panel/components/ActivationOverlay';

afterEach(cleanup);

// bridge passed (ms 0, startedAt===now on a connected reset), worker active → readying
const readying = () =>
  activationReducer(
    initActivation(),
    { kind: 'reset', tenant: true, cold: true, connected: true, workerLive: false },
    100,
  );
const blocked = () => activationReducer(readying(), { kind: 'timeout', gate: 'worker' }, 15_100);

describe('ActivationOverlay', () => {
  it('shows the title, the passed bridge label + frozen ms, the active worker label, and no Retry while readying', () => {
    render(<ActivationOverlay activation={readying()} onRetry={() => {}} />);
    expect(screen.getByText('getting ready…')).toBeTruthy();
    expect(screen.getByText('bridge connected')).toBeTruthy();
    expect(screen.getByText('0 ms')).toBeTruthy();
    expect(screen.getByText('starting worker…')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('shows the hard-stall worker line and a Retry button that fires onRetry when blocked', () => {
    const onRetry = mock(() => {});
    render(<ActivationOverlay activation={blocked()} onRetry={onRetry} />);
    expect(screen.getByText("xcsh didn't start")).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
