# xcsh for F5 XC — Chrome Extension

`xcsh` is a Manifest V3 Chrome extension that drives automation against the F5
Distributed Cloud (XC) console. It injects a `document_start` content script into
the scoped XC console domains (`*.volterra.us` and `*.console.ves.volterra.io`)
that builds a ref-handled accessibility tree of the page, allowing an external
native host (`com.f5xc.xcsh.chrome_host`) to read the DOM as a compact
role/name/ref tree and resolve any `ref_<n>` back to on-screen coordinates for
input synthesis via the `debugger` (CDP) protocol. The MV3 service worker
(implemented in a later task) coordinates the native-messaging session.

## Signing key

The extension uses a fixed `key` in `manifest.json` so it always loads with the
stable extension ID `khlalklompggpfnmeclpligmcbknkemg`. The matching **private**
key lives in `key.pem`, which is intentionally **not committed** (see
`.gitignore`). Store `key.pem` in your team's secrets manager; it is required to
repackage/sign the extension and must never be checked into git.

## Build & load

```bash
bun install
bun test          # unit tests for the AX serializer (linkedom)
bun run build     # bundles src/ → dist/ and copies manifest.json into dist/
bun run check:types
```

`bun run build` produces `dist/` containing `manifest.json`,
`accessibility-tree.js`, and `service-worker.js`. To load it unpacked: open
`chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
select the `dist/` directory.
