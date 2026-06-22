/**
 * Options page script — reports live connection status to the xcsh native host.
 *
 * Pings the service worker via `status_request`; the SW replies with whether
 * its native-messaging port is currently connected.
 */

// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed
const el = document.getElementById('status')!;

function render(connected: boolean): void {
  if (connected) {
    el.innerHTML = '<span class="dot green"></span>Connected to xcsh';
  } else {
    el.innerHTML = '<span class="dot red"></span>Not connected — start xcsh and run <code>xcsh chrome setup</code>';
  }
}

chrome.runtime.sendMessage({ type: 'status_request' }, (resp: { connected?: boolean } | undefined) => {
  // A missing response (e.g. SW asleep / runtime error) counts as disconnected.
  if (chrome.runtime.lastError) {
    render(false);
    return;
  }
  render(!!resp?.connected);
});
