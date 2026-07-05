import { describe, expect, test } from 'bun:test';
import {
  type BridgeRegistry,
  liveTenants,
  PORT_RANGE_END,
  PORT_RANGE_START,
  portCandidates,
  portForTenant,
  stalePorts,
  tenantToPort,
} from '../src/bridge-discovery';

function reg(...entries: Array<[number, string | null, string | null, number, boolean?]>): BridgeRegistry {
  const m: BridgeRegistry = new Map();
  for (const [port, tenant, env, lastSeen, contextBound = false] of entries) {
    m.set(port, { port, tenant, env, sessionId: `s-${port}`, contextBound, lastSeen });
  }
  return m;
}

describe('bridge-discovery', () => {
  test('portCandidates is the inclusive range', () => {
    const c = portCandidates();
    expect(c[0]).toBe(PORT_RANGE_START);
    expect(c.at(-1)).toBe(PORT_RANGE_END);
    expect(c.length).toBe(PORT_RANGE_END - PORT_RANGE_START + 1);
  });

  test('tenantToPort maps only bridges that reported tenant+env', () => {
    const m = reg([19222, 'alpha', 'staging', 0], [19223, null, null, 0], [19224, 'beta', 'production', 0]);
    const t = tenantToPort(m);
    expect(t.get('alpha|staging')).toBe(19222);
    expect(t.get('beta|production')).toBe(19224);
    expect(t.size).toBe(2);
  });

  test('portForTenant resolves a session key, undefined when absent/null', () => {
    const m = reg([19222, 'alpha', 'staging', 0]);
    expect(portForTenant(m, 'alpha|staging')).toBe(19222);
    expect(portForTenant(m, 'beta|staging')).toBeUndefined();
    expect(portForTenant(m, null)).toBeUndefined();
  });

  test('stalePorts returns ports older than ttl', () => {
    const now = 100_000;
    const m = reg([19222, 'a', 'staging', now - 40_000], [19223, 'b', 'staging', now - 5_000]);
    expect(stalePorts(m, now, 30_000)).toEqual([19222]);
  });

  test('liveTenants lists session keys with a tenant+env and their contextBound state', () => {
    const m = reg([19222, 'alpha', 'staging', 0, true], [19223, null, null, 0], [19224, 'beta', 'production', 0]);
    expect(liveTenants(m)).toEqual([
      { tenant: 'alpha|staging', contextBound: true },
      { tenant: 'beta|production', contextBound: false },
    ]);
  });

  // Tenant-correlation contract (xcsh#1872 / #164): a bridge is usable only when
  // it advertises BOTH tenant AND env. The panel's gate blocks input for a tab
  // whose key is absent from liveTenants, so an ASYMMETRIC frame (tenant but no
  // env, or env but no tenant) — which a producer CAN emit (e.g. a malformed
  // "tenant|env" with no env half) — MUST be excluded here, not partially kept.
  test('liveTenants + tenantToPort exclude asymmetric frames (tenant XOR env)', () => {
    const m = reg(
      [19222, 'full', 'production', 0], // both → kept
      [19223, 'tenantonly', null, 0], // env missing → excluded
      [19224, null, 'production', 0], // tenant missing → excluded
      [19225, null, null, 0], // both missing → excluded
      [19226, '', '', 0], // empty strings → excluded
    );
    expect(liveTenants(m)).toEqual([{ tenant: 'full|production', contextBound: false }]);
    expect([...tenantToPort(m).keys()]).toEqual(['full|production']);
    expect(portForTenant(m, 'tenantonly|production')).toBeUndefined();
    expect(portForTenant(m, 'full|production')).toBe(19222);
  });
});
