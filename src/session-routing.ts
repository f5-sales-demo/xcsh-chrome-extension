/** Pure tab↔worker routing. The per-tab session id is derived from the Chrome
 *  tabId so it is recomputable after an MV3 service-worker suspension. */
export function sidForTab(tabId: number): string {
  return `tab-${tabId}`;
}

export interface BridgeLike {
  // `string | null` mirrors the live `BridgeInfo.sessionId` (a worker that sent no
  // per-tab sid stores null), so the real registry is accepted directly.
  sessionId?: string | null;
}

/** The bridge port whose worker advertised `sid` (from hello_ack), or undefined. */
export function portForTab(registry: Map<number, BridgeLike>, sid: string): number | undefined {
  for (const [port, info] of registry) if (info.sessionId === sid) return port;
  return undefined;
}

/** The tab bound to the worker socket `sourcePort`, or null. Never falls back to
 *  another tab — an unbound source yields null so the caller can refuse. */
export function resolveToolTab(sourcePort: number | undefined, portToTab: Map<number, number>): number | null {
  if (sourcePort === undefined) return null;
  return portToTab.get(sourcePort) ?? null;
}

/** The bridge port a chat turn from the panel bound to `tabId` must go to — the
 *  worker for THAT tab, never a global active-port fallback (which would route a
 *  turn to another tab's worker and can hit its busy session). undefined when the
 *  tab has no worker or the panel sent no tabId, so the caller refuses. */
export function resolveChatPort(tabId: number | undefined, registry: Map<number, BridgeLike>): number | undefined {
  if (tabId === undefined) return undefined;
  return portForTab(registry, sidForTab(tabId));
}
