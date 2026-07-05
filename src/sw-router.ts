/**
 * Pure message-routing planners for the service worker. `service-worker.ts` runs
 * side-effects at import (keepalive, port scan, chrome listeners), so it can't be
 * unit-tested directly; instead its routing DECISIONS live here as pure functions
 * that take the message + a snapshot of SW state and return a plan the SW then
 * executes (send frames, mutate the registry, provision workers). This keeps the
 * tenant/tab isolation logic (#166) behind mutation-testable unit coverage — the
 * seam the earlier regression slipped through. Effects, timers, Date.now(), and
 * chrome APIs stay in the SW; nothing here touches them.
 */
import { type BridgeLike, resolveChatPort, resolveToolTab, sidForTab, staleTabPorts } from './session-routing';

/** Shown to the panel when a chat turn can't be routed to the tab's own worker. */
export const NO_WORKER_FOR_TAB = 'No xcsh running for this tab — open the F5 console tab and ensure xcsh is running';

export interface ChatRequestLike {
  id: string;
  tabId?: unknown;
  sessionKey?: unknown;
}

export type ChatRoutePlan = { kind: 'route'; id: string; port: number } | { kind: 'error'; id: string; error: string };

/** Decide where a panel chat turn goes: the worker for the panel's OWN tab whose
 *  advertised tenant|env matches `sessionKey` (when supplied) and whose socket is
 *  open — else an error (never a global-active-port fallback). RC-1's SW-side
 *  guard: a stale-tenant worker lingering on the tab's sid is refused, not used. */
export function planChatRequest(
  msg: ChatRequestLike,
  registry: Map<number, BridgeLike>,
  isOpen: (port: number) => boolean,
): ChatRoutePlan {
  const target = resolveChatPort(
    typeof msg.tabId === 'number' ? msg.tabId : undefined,
    registry,
    typeof msg.sessionKey === 'string' ? msg.sessionKey : undefined,
  );
  if (target === undefined || !isOpen(target)) return { kind: 'error', id: msg.id, error: NO_WORKER_FOR_TAB };
  return { kind: 'route', id: msg.id, port: target };
}

export type ToolPlan = { kind: 'run'; tabId: number } | { kind: 'refuse' };

/** A worker's tool_request runs against the tab BOUND to its socket, never a
 *  global fallback; an unbound source is refused so a worker drives only its tab. */
export function planToolRequest(sourcePort: number | undefined, portToTab: Map<number, number>): ToolPlan {
  const tabId = resolveToolTab(sourcePort, portToTab);
  return tabId === null ? { kind: 'refuse' } : { kind: 'run', tabId };
}

export interface HelloAckLike {
  sessionId?: unknown;
  tenant?: unknown;
  env?: unknown;
  contextBound?: unknown;
  contractVersion?: unknown;
}

export type HelloAckPlan =
  | { kind: 'ignore' }
  | { kind: 'reject' }
  | { kind: 'accept'; tenant: string | null; env: string | null; sessionId: string; contextBound: boolean };

/** Decide how to treat a hello_ack/tenant_changed: ignore a non-xcsh frame (no
 *  string sessionId), reject a major contract-version mismatch (SW closes +
 *  forgets the socket), else accept the identity fields (the SW adds port +
 *  lastSeen and stores the BridgeInfo). Kept pure — no Date.now() here. */
export function planHelloAck(msg: HelloAckLike, ownContractVersion: string): HelloAckPlan {
  if (typeof msg.sessionId !== 'string') return { kind: 'ignore' };
  if (
    typeof msg.contractVersion === 'string' &&
    msg.contractVersion.split('.')[0] !== ownContractVersion.split('.')[0]
  ) {
    return { kind: 'reject' };
  }
  return {
    kind: 'accept',
    tenant: (msg.tenant as string | null) ?? null,
    env: (msg.env as string | null) ?? null,
    sessionId: msg.sessionId,
    contextBound: msg.contextBound === true, // additive optional field; anything non-true → false
  };
}

export type ReTenantPlan =
  | { kind: 'noop' }
  | { kind: 'retenant'; releaseSid: string; evictPorts: number[]; provisionTenant: string | null };

/** On a tab navigation, decide whether its worker slot must be re-tenanted: any
 *  worker still on the tab's sid whose advertised key != the tab's new key is
 *  stale (RC-1). Returns the sid to release, the registry ports to evict, and the
 *  tenant to (re)provision — null when the tab left the console (release only). */
export function planReTenant(
  registry: Map<number, BridgeLike>,
  tabId: number,
  currentKey: string | null,
): ReTenantPlan {
  const evictPorts = staleTabPorts(registry, tabId, currentKey);
  if (evictPorts.length === 0) return { kind: 'noop' };
  return {
    kind: 'retenant',
    releaseSid: sidForTab(tabId),
    evictPorts,
    provisionTenant: currentKey || null, // '' / null (tab left the console) → release only, no provision
  };
}
