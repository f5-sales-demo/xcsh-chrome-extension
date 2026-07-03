/**
 * Minimal Chrome host-permission (match-pattern) checker — enough to assert, in
 * tests, that the manifest's `host_permissions` actually grant every origin the
 * extension connects to at runtime. This is NOT a full match-pattern engine; it
 * covers the schemes/hosts we use: the https F5 consoles and the `ws://` loopback
 * bridge.
 *
 * The subtle part: Chrome maps a WebSocket's scheme to http/https for
 * host-permission matching (ws→http, wss→https). So a `ws://127.0.0.1:19222`
 * connection is granted by an `http://127.0.0.1/*` host permission — and by
 * `<all_urls>`. That mapping is exactly the dependency that made dropping
 * `<all_urls>` silently break the bridge (see test/manifest-permissions.test.ts):
 * with only the F5 console patterns left, the service worker had no permission to
 * open the localhost bridge, so all browser automation died with
 * ERR_CONNECTION_REFUSED.
 */
export function grantsUrl(patterns: readonly string[], url: string): boolean {
  const u = new URL(url);
  const scheme = u.protocol === 'ws:' ? 'http' : u.protocol === 'wss:' ? 'https' : u.protocol.slice(0, -1);
  const host = u.hostname;
  return patterns.some((p) => {
    if (p === '<all_urls>') return true;
    const m = /^(\*|https?|wss?|file|ftp):\/\/([^/]+)\/.*$/.exec(p);
    if (!m) return false;
    let pScheme = m[1];
    const pHost = m[2];
    if (pScheme === 'ws') pScheme = 'http';
    else if (pScheme === 'wss') pScheme = 'https';
    const schemeOk = pScheme === '*' ? scheme === 'http' || scheme === 'https' : pScheme === scheme;
    const hostOk =
      pHost === '*' ||
      pHost === host ||
      (pHost.startsWith('*.') && (host === pHost.slice(2) || host.endsWith(`.${pHost.slice(2)}`)));
    return schemeOk && hostOk;
  });
}
