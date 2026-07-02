import { describe, expect, test } from 'bun:test';
import { hasNoRemainingTenantTab, shouldProvision } from '../src/nm-bootstrap';

describe('nm-bootstrap: shouldProvision', () => {
  test('true when a tenant is focused, no bridge port, and not pinned', () => {
    expect(shouldProvision('alpha|staging', undefined, false)).toBe(true);
  });

  test('false when there is no focused tenant (null session key)', () => {
    expect(shouldProvision(null, undefined, false)).toBe(false);
  });

  test('false when a bridge port already serves the tenant', () => {
    expect(shouldProvision('alpha|staging', 19222, false)).toBe(false);
  });

  test('false when the port is pinned (manual-port mode)', () => {
    expect(shouldProvision('alpha|staging', undefined, true)).toBe(false);
  });

  test('false when both a port exists and pinned', () => {
    expect(shouldProvision('alpha|staging', 19222, true)).toBe(false);
  });
});

describe('nm-bootstrap: hasNoRemainingTenantTab', () => {
  test('true when no remaining tab belongs to the closed tab tenant', () => {
    expect(hasNoRemainingTenantTab(['beta|production'], 'alpha|staging')).toBe(true);
  });

  test('true when there are no remaining tenant tabs at all', () => {
    expect(hasNoRemainingTenantTab([], 'alpha|staging')).toBe(true);
  });

  test('false when another open tab still belongs to the tenant', () => {
    expect(hasNoRemainingTenantTab(['alpha|staging'], 'alpha|staging')).toBe(false);
  });

  test('false when the tenant appears among several remaining keys', () => {
    expect(hasNoRemainingTenantTab(['beta|production', 'alpha|staging'], 'alpha|staging')).toBe(false);
  });
});
