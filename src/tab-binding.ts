/**
 * Pure decisions for the chat panel's controlled-tab binding and bridge-link
 * liveness. Chrome-free and DOM-free so it is unit-tested; the service worker
 * wires Chrome events to `decideBinding` and the heartbeat timer to `isLinkStale`.
 */

/** F5 XC console tab? (same scope as the SW's host_permissions / isScopedUrl.) */
export function isConsoleUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https:\/\/[^/]*\.volterra\.us\//.test(url) || /^https:\/\/[^/]*\.console\.ves\.volterra\.io\//.test(url);
}

export interface BindingState {
  controlledTabId: number | undefined;
  inFlight: boolean;
}

export type BindingEvent =
  | { kind: 'activated' | 'updated'; tabId: number; url: string | undefined }
  | { kind: 'removed'; tabId: number };

export type BindingAction =
  | { action: 'keep' }
  | { action: 'bind'; tabId: number }
  | { action: 'unbind' }
  | { action: 'inactive' };

/** Decide how a tab event changes the single controlled-tab binding. */
export function decideBinding(state: BindingState, event: BindingEvent): BindingAction {
  if (event.kind === 'removed') {
    return event.tabId === state.controlledTabId ? { action: 'unbind' } : { action: 'keep' };
  }
  if (event.kind === 'updated') {
    if (event.tabId !== state.controlledTabId) return { action: 'keep' };
    return isConsoleUrl(event.url) ? { action: 'keep' } : { action: 'unbind' };
  }
  // activated — automation always wins: never rebind while xcsh is busy.
  if (state.inFlight) return { action: 'keep' };
  if (!isConsoleUrl(event.url)) {
    return state.controlledTabId === undefined ? { action: 'inactive' } : { action: 'keep' };
  }
  if (event.tabId === state.controlledTabId) return { action: 'keep' };
  return { action: 'bind', tabId: event.tabId };
}

/** Open-but-silent socket detection: no inbound bridge traffic for > intervalMs. */
export function isLinkStale(lastActivityTs: number, now: number, intervalMs: number): boolean {
  return now - lastActivityTs > intervalMs;
}
