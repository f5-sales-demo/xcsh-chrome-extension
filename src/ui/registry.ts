import type { ComponentType } from 'preact';
import { type FeatureFlag, isEnabled } from './flags';

export type Slot = 'header' | 'statusbar' | 'transcript-adornment' | 'drawer' | 'composer-accessory';

export interface WidgetDef {
  id: string;
  slot: Slot;
  order?: number;
  flag?: FeatureFlag;
  when?: () => boolean;
  component: ComponentType<Record<string, unknown>>;
}

const registry: WidgetDef[] = [];

export function registerWidget(def: WidgetDef): void {
  const i = registry.findIndex((w) => w.id === def.id);
  if (i >= 0) registry[i] = def;
  else registry.push(def);
}

export function clearRegistry(): void {
  registry.length = 0;
}

export function widgetsForSlot(slot: Slot, flags?: Partial<Record<FeatureFlag, boolean>>): WidgetDef[] {
  return registry
    .filter((w) => w.slot === slot)
    .filter((w) => (w.flag ? isEnabled(w.flag, flags) : true))
    .filter((w) => (w.when ? w.when() : true))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
