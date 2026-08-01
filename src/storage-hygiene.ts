/** Former storage layouts that could contain tenant keys, session identifiers,
 * page URLs, prompts, or response content. The clean-break release deletes them
 * without reading or migrating their values. */
import { LEGACY_DIAG_STORAGE_KEYS } from './diagnostics';

const OBSOLETE_EXACT_KEYS = new Set<string>(LEGACY_DIAG_STORAGE_KEYS);
const OBSOLETE_PREFIXES = ['xcsh.chat.'];

export function obsoleteLocalStorageKeys(keys: readonly string[]): string[] {
  return keys.filter(
    (key) => OBSOLETE_EXACT_KEYS.has(key) || OBSOLETE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}
