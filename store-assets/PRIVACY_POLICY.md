# xcsh Chrome Extension — Privacy Policy

**Last updated:** August 1, 2026

## What this extension does

xcsh is a browser automation extension that drives the F5 Distributed Cloud admin console on behalf of the xcsh AI assistant. It operates exclusively on F5 XC console domains (`*.volterra.us`, `*.console.ves.volterra.io`).

## Data collection and usage

### What we access

- **Page DOM/Accessibility Tree:** The extension reads the structure of F5 XC console pages to identify form fields, buttons, and navigation elements. Live console content can contain customer identifiers; it is processed transiently for the requested local automation and is not written to extension storage.
- **Console logs and network requests:** When explicitly requested by the user, the extension reads Chrome DevTools console and network data for debugging purposes. This data stays in memory and is returned only over the local xcsh bridge.
- **Screenshots:** When requested, the extension captures the visible tab as a PNG image and returns it locally to xcsh. Screenshots are not written to extension storage or sent to an external service by the extension.
- **Chat content and references:** Prompts, responses, and console reference links stay in process memory for the active side-panel lifetime. The extension does not persist chat content or tenant routing keys.

### What we do NOT collect

- We do NOT collect browsing history
- We do NOT collect customer or personal data for analytics, profiling, or advertising
- We do NOT track user behavior or analytics
- We do NOT collect data from non-F5-XC sites
- We do NOT use cookies or tracking pixels

### Authentication and extension storage

- The extension does not accept, fill, cache, or persist login credentials. You authenticate directly in Chrome.
- The extension stores the configured loopback bridge port and bounded lifecycle/performance metrics needed to diagnose Manifest V3 service-worker suspension.
- Persisted diagnostics contain timing, state, and count fields only. Tenant, environment, session, URL, page-content, and credential values are discarded before storage.
- This clean-break release deletes chat and identity-capable diagnostics written by prerelease builds without reading or migrating their values.

## Data transmission

Communication with xcsh uses local native messaging and loopback WebSocket connections. The extension has no analytics or cloud telemetry component and does not send captured console data to an external service.

## Enterprise policy

The extension supports Chrome Enterprise managed policy via `managed_schema.json`:

- `allowedDomains`: IT can restrict which domains the extension operates on
- `blockedUrlPatterns`: IT can block specific URL patterns
- `confirmBeforeMutating`: IT can require user confirmation before destructive actions

These policies are read-only to the extension and configured by your organization's Chrome administrator.

## Third-party services

This extension does not use any third-party services, analytics, or tracking.

## Changes to this policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last updated" date above.

## Contact

For questions about this privacy policy, [open an issue](https://github.com/f5-sales-demo/xcsh-chrome-extension/issues).
