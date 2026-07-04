export type FeatureFlag = 'references' | 'overlaysArrow' | 'overlaysUnderline' | 'overlaysScrollTarget';

/** Phase-1 deferred features register but stay dormant here. */
export const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  references: false,
  overlaysArrow: false,
  overlaysUnderline: false,
  overlaysScrollTarget: false,
};

export function isEnabled(flag: FeatureFlag, overrides?: Partial<Record<FeatureFlag, boolean>>): boolean {
  return overrides?.[flag] ?? DEFAULT_FLAGS[flag];
}
