/** Pure tab↔worker routing. The per-tab session id is derived from the Chrome
 *  tabId so it is recomputable after an MV3 service-worker suspension. */
export function sidForTab(tabId: number): string {
  return `tab-${tabId}`;
}

export interface BridgeLike {
  // `string | null` mirrors the live `BridgeInfo.sessionId` (a worker that sent no
  // per-tab sid stores null), so the real registry is accepted directly.
  sessionId?: string | null;
  // The tenant|env the worker advertised (hello_ack). `resolveChatPort`'s tenant
  // guard reads these to reject a worker whose key no longer matches the tab.
  tenant?: string | null;
  env?: string | null;
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

/** The tab a chat turn's page-context snapshot must be built for: the panel's
 *  own (requested) tab when it supplied one, else the controlled/automation tab
 *  as a legacy fallback. Prevents attaching the controlled tab's context to a
 *  turn whose transcript belongs to a different, focused tab (RC-2, #166). */
export function contextTabFor(
  requestedTabId: number | undefined,
  controlledTabId: number | undefined,
): number | undefined {
  return typeof requestedTabId === 'number' ? requestedTabId : controlledTabId;
}

/** Ports whose worker is still bound to `tabId`'s sid but advertises a tenant|env
 *  that no longer matches the tab's CURRENT `currentKey` — i.e. stale after a
 *  same-tab re-login. The SW evicts these from the registry (and releases +
 *  reprovisions) so a turn for the new tenant can never resolve the old worker.
 *  Reads the registry (rebuilt from hello_acks), so it works even after an MV3
 *  suspension drops the in-memory tab→key map. `currentKey` null/empty (tab left
 *  the console) flags every worker on the sid for release. */
export function staleTabPorts(registry: Map<number, BridgeLike>, tabId: number, currentKey: string | null): number[] {
  const sid = sidForTab(tabId);
  const out: number[] = [];
  for (const [port, info] of registry) {
    if (info.sessionId !== sid) continue;
    const key = info.tenant && info.env ? `${info.tenant}|${info.env}` : null;
    if (key !== currentKey) out.push(port);
  }
  return out;
}

/** The bridge port a chat turn from the panel bound to `tabId` must go to — the
 *  worker for THAT tab, never a global active-port fallback (which would route a
 *  turn to another tab's worker and can hit its busy session). undefined when the
 *  tab has no worker or the panel sent no tabId, so the caller refuses.
 *
 *  RC-1 (#166): when `expectedKey` ("tenant|env") is given, the worker must ALSO
 *  advertise that exact key. The sid ("tab-<id>") is stable across a same-tab
 *  re-login, and the old-tenant worker lingers in the registry until its socket
 *  closes; without this guard a turn for the tab's NEW tenant could route to the
 *  stale OLD-tenant worker. We scan all ports (not just the first sid match) so a
 *  transient old+new race resolves the port whose tenant matches. */
export function resolveChatPort(
  tabId: number | undefined,
  registry: Map<number, BridgeLike>,
  expectedKey?: string | null,
): number | undefined {
  if (tabId === undefined) return undefined;
  const sid = sidForTab(tabId);
  if (!expectedKey) return portForTab(registry, sid);
  for (const [port, info] of registry) {
    if (info.sessionId !== sid) continue;
    if (info.tenant && info.env && `${info.tenant}|${info.env}` === expectedKey) return port;
  }
  return undefined;
}
