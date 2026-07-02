/**
 * Pure decisions for the native-messaging (NM) auto-provisioning bootstrap.
 * Chrome-free and socket-free so it is unit-tested directly; service-worker.ts
 * owns the live `connectNative` port and tab tracking and delegates the two
 * trigger decisions here.
 *
 * `tenantKey` is the extension's `sessionKeyStr(...)` string ("tenant|env") —
 * the same key the xcsh worker advertises via hello_ack, so `provision`/`release`
 * on the manager line up with the bridge the Phase-3 scan later discovers.
 */

/**
 * Should the SW ask the manager to `provision` a worker for the focused tenant?
 * True iff a tenant tab is focused (`sessionKey` set), no bridge port currently
 * serves it (`activePort === undefined`, i.e. the Phase-3 scan found nothing),
 * and we are not pinned to a single manual port (which disables auto-discovery).
 */
export function shouldProvision(
  sessionKey: string | null,
  activePort: number | undefined,
  manualPortPinned: boolean,
): boolean {
  return sessionKey !== null && sessionKey !== '' && activePort === undefined && !manualPortPinned;
}

/**
 * Should the SW ask the manager to `release` the closed tab's tenant worker?
 * True when NONE of the still-open tabs belong to that tenant — i.e. the closed
 * tab was the tenant's last window. Callers derive `remainingTenantKeys` from
 * `chrome.tabs.query` + `sessionKeyFromUrl`/`sessionKeyStr`, keeping this pure.
 */
export function hasNoRemainingTenantTab(remainingTenantKeys: string[], closedKey: string): boolean {
  return !remainingTenantKeys.includes(closedKey);
}
