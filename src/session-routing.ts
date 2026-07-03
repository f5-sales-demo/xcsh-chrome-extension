/** Pure tab↔worker routing. The per-tab session id is derived from the Chrome
 *  tabId so it is recomputable after an MV3 service-worker suspension. */
export function sidForTab(tabId: number): string {
  return `tab-${tabId}`;
}

export interface BridgeLike {
  sessionId?: string;
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
