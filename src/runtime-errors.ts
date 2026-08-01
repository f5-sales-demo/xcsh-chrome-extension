/**
 * Convert an internal exception into a response safe to cross a runtime boundary.
 * Browser, page, and policy errors can embed URLs, form values, or page text, so
 * the original message stays process-local.
 */
export function publicRuntimeError(_error: unknown): string {
  return 'operation failed; inspect the local browser state and retry';
}
