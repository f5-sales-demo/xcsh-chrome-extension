/**
 * Regression defense for manifest host_permissions.
 *
 * The extension needs host access to TWO different kinds of origin: the F5
 * Distributed Cloud consoles it automates, AND the `ws://127.0.0.1` loopback
 * bridge the service worker opens to talk to the local xcsh worker. Dropping
 * `<all_urls>` (PR #140, for least-privilege) silently removed the loopback
 * grant — the F5 patterns don't cover 127.0.0.1 — so every browser action died
 * with ERR_CONNECTION_REFUSED, undetected until manual UAT. These tests encode
 * that dependency so the class of bug can never ship again.
 */
import { describe, expect, test } from 'bun:test';
import manifest from '../manifest.json';
import { grantsUrl } from '../src/host-permission-check';

// The origin the service worker connects to (service-worker.ts bridgeUrl():
// `ws://127.0.0.1:${port}`, DEFAULT_BRIDGE_PORT 19222). The port is irrelevant to
// host-permission matching; the ws scheme + 127.0.0.1 host are what matter.
const BRIDGE_URL = 'ws://127.0.0.1:19222';
const F5_PROD_URL = 'https://acme.console.ves.volterra.io/web/namespaces/default/http_loadbalancers';
const F5_STAGING_URL = 'https://tenant.staging.volterra.us/web/home';

describe('grantsUrl — host-permission matcher', () => {
  test('http://127.0.0.1/* grants the ws:// loopback bridge (ws→http mapping)', () => {
    expect(grantsUrl(['http://127.0.0.1/*'], BRIDGE_URL)).toBe(true);
  });
  test('F5-console-only permissions do NOT grant the loopback bridge (the exact #140 regression)', () => {
    expect(grantsUrl(['https://*.volterra.us/*', 'https://*.console.ves.volterra.io/*'], BRIDGE_URL)).toBe(false);
  });
  test('<all_urls> grants the bridge — why the regression stayed hidden until it was removed', () => {
    expect(grantsUrl(['<all_urls>'], BRIDGE_URL)).toBe(true);
  });
  test('the F5 patterns grant the console subdomains, but not the bridge', () => {
    const f5 = ['https://*.volterra.us/*', 'https://*.console.ves.volterra.io/*'];
    expect(grantsUrl(f5, F5_PROD_URL)).toBe(true);
    expect(grantsUrl(f5, F5_STAGING_URL)).toBe(true);
    expect(grantsUrl(f5, 'https://evil.example.com/')).toBe(false);
  });
});

describe('manifest host_permissions invariants', () => {
  const hp = manifest.host_permissions as string[];

  test('grants the localhost bridge the service worker connects to (browser automation depends on it)', () => {
    // If this fails, the SW cannot open ws://127.0.0.1 and ALL browser automation
    // is dead (ERR_CONNECTION_REFUSED). This is the guard PR #140 lacked.
    expect(grantsUrl(hp, BRIDGE_URL)).toBe(true);
  });

  test('grants the F5 Distributed Cloud console domains', () => {
    expect(grantsUrl(hp, F5_PROD_URL)).toBe(true);
    expect(grantsUrl(hp, F5_STAGING_URL)).toBe(true);
  });

  test('least-privilege: does NOT request <all_urls>', () => {
    expect(hp).not.toContain('<all_urls>');
  });

  test('loopback grant is scoped to 127.0.0.1 (not a broad host)', () => {
    // The bridge grant must be the loopback only — never a public host or wildcard.
    const loopback = hp.filter((p) => !p.includes('volterra'));
    expect(loopback).toEqual(['http://127.0.0.1/*']);
  });
});
