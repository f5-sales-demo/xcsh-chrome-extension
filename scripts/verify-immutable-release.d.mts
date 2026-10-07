export function verifyImmutableRelease(
  repository: string,
  request?: (endpoint: string) => Promise<{ enabled?: boolean }>,
): Promise<void>;
