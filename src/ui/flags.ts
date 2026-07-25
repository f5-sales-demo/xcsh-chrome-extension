export type FeatureFlag = 'overlaysArrow' | 'overlaysUnderline' | 'overlaysScrollTarget';

/** Phase-1 deferred features register but stay dormant here. */
export const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  overlaysArrow: false,
  overlaysUnderline: false,
  overlaysScrollTarget: false,
};

export function isEnabled(flag: FeatureFlag, overrides?: Partial<Record<FeatureFlag, boolean>>): boolean {
  return overrides?.[flag] ?? DEFAULT_FLAGS[flag];
}
