import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { activationReducer, initActivation } from '../../src/side-panel/activation';
import { activationToGates, overlayBlocked } from '../../src/side-panel/adapt';
import { ActivationOverlay } from '../../src/vendor/chat-ui';

afterEach(cleanup);

// Render the VENDORED overlay fed by the Chrome adapter (activation → gates[] +
// blocked) under preact/compat — proves the shared overlay + the adapter's gate
// label copy together reproduce the old local render.
const overlay = (a: ReturnType<typeof initActivation>, onRetry: () => void) => (
  <ActivationOverlay gates={activationToGates(a)} blocked={overlayBlocked(a)} onRetry={onRetry} />
);

// bridge passed (ms 0, startedAt===now on a connected reset), worker active → readying
const readying = () =>
  activationReducer(
    initActivation(),
    { kind: 'reset', tenant: true, cold: true, connected: true, workerLive: false },
    100,
  );
const blocked = () => activationReducer(readying(), { kind: 'timeout', gate: 'worker' }, 15_100);
// bridge active (unconnected reset), then hard bridge timeout → disconnected
const disconnected = () =>
  activationReducer(
    activationReducer(
      initActivation(),
      { kind: 'reset', tenant: true, cold: true, connected: false, workerLive: false },
      100,
    ),
    { kind: 'timeout', gate: 'bridge' },
    10_100,
  );

describe('ActivationOverlay', () => {
  it('shows the title, the passed bridge label + frozen ms, the active worker label, and no Retry while readying', () => {
    render(overlay(readying(), () => {}));
    expect(screen.getByText('getting ready…')).toBeTruthy();
    expect(screen.getByText('bridge connected')).toBeTruthy();
    expect(screen.getByText('0 ms')).toBeTruthy();
    expect(screen.getByText('starting worker…')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('shows the hard-stall worker line and a Retry button that fires onRetry when blocked', () => {
    const onRetry = mock(() => {});
    render(overlay(blocked(), onRetry));
    expect(screen.getByText("xcsh didn't start")).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the bridge-stalled line and a Retry button that fires onRetry when disconnected', () => {
    const onRetry = mock(() => {});
    render(overlay(disconnected(), onRetry));
    expect(screen.getByText('xcsh not connected — start the CLI')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
