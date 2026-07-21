/**
 * Resolve an extension-relative asset path (e.g. `fonts/MesloLGS-NF-Regular.ttf`)
 * to an absolute `chrome-extension://…` URL. The shared chat-ui font-face
 * injector (`vendor/chat-ui/theme/tokens`) defaults to identity URLs so it stays
 * host-agnostic; the extension must pin its font paths to the extension origin
 * (the files ship in `web_accessible_resources`). Content scripts inject the
 * `@font-face` into the HOST page's document, where a relative URL would resolve
 * against the page origin and 404 — `getURL` fixes it to the extension origin.
 * Guarded so importing this in unit tests (no `chrome`) never throws.
 */
export function extUrl(path: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
}
