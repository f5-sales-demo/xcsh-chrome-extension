import { describe, expect, it } from 'bun:test';
import { obsoleteLocalStorageKeys } from '../src/storage-hygiene';

describe('obsoleteLocalStorageKeys', () => {
  it('removes every former chat and identity-capable diagnostics key', () => {
    expect(
      obsoleteLocalStorageKeys([
        'bridgePort',
        'xcsh.chat.index',
        'xcsh.chat.conv.conv-example',
        'xcsh.chat.sessionindex',
        'xcsh.diag.suspension',
        'xcsh.diag.noise',
        'xcsh.diag.metrics.v2',
      ]),
    ).toEqual([
      'xcsh.chat.index',
      'xcsh.chat.conv.conv-example',
      'xcsh.chat.sessionindex',
      'xcsh.diag.suspension',
      'xcsh.diag.noise',
    ]);
  });
});
