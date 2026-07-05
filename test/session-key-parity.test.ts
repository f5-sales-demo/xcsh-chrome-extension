/**
 * Cross-repo parity guard (#164) for the tenant session-key contract.
 *
 * `sessionKeyFromUrl` is implemented TWICE — here in the extension
 * (`src/tab-binding.ts`) and in the xcsh binary (`services/xcsh-env.ts`). They
 * must agree byte-for-byte on the URL → (tenant, env) mapping: the extension
 * derives a tab's key from its URL, the worker derives the SAME key from its
 * context/apiUrl, and the panel gate matches them with `===`. If the two copies
 * drift, a live worker's key won't match its tab and the panel shows
 * "No xcsh running for this tenant" (the xcsh#1872 failure mode).
 *
 * This GOLDEN TABLE is the shared contract. The identical set of cases is
 * asserted in xcsh `test/xcsh-env.test.ts` (describe "sessionKeyFromUrl"). When
 * you change one, change both — a divergence here or there fails that repo's CI.
 */
import { describe, expect, it } from 'bun:test';
import { sessionKeyFromUrl } from '../src/tab-binding';

// [url, expected] — expected null means "fail closed" (no tenant routing).
const GOLDEN: Array<[string | undefined, { tenant: string; env: 'production' | 'staging' } | null]> = [
  // production + staging of the same tenant are DISTINCT keys
  ['https://acme.console.ves.volterra.io/web/x', { tenant: 'acme', env: 'production' }],
  ['https://acme.staging.volterra.us/web/home', { tenant: 'acme', env: 'staging' }],
  // path/query/fragment are ignored (host-only match)
  ['https://f5-amer-ent.console.ves.volterra.io/web/home?iss=x', { tenant: 'f5-amer-ent', env: 'production' }],
  // Keycloak login realms → tenant (suffix stripped), env by host
  [
    'https://login.ves.volterra.io/auth/realms/acme-abc123/protocol/openid-connect/auth',
    { tenant: 'acme', env: 'production' },
  ],
  [
    'https://login-staging.volterra.us/auth/realms/acme-x/protocol/openid-connect/auth',
    { tenant: 'acme', env: 'staging' },
  ],
  // fail-closed: shared SaaS console, shared `volterra` realm, non-console host, IP, junk
  ['https://console.ves.volterra.io/web/devportal/domain', null],
  ['https://login.ves.volterra.io/auth/realms/volterra/protocol/openid-connect/auth', null],
  ['https://acme.ves.volterra.io', null], // no `.console` — must NOT match production
  ['https://192.168.1.10/web/home', null],
  ['https://api.gateway.internal', null],
  [undefined, null],
];

describe('sessionKeyFromUrl parity with xcsh services/xcsh-env.ts (#164)', () => {
  it.each(GOLDEN)('%s', (url, expected) => {
    expect(sessionKeyFromUrl(url)).toEqual(expected);
  });
});
