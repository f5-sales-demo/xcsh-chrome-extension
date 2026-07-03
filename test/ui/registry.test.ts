import { beforeEach, describe, expect, it } from 'bun:test';
import { clearRegistry, registerWidget, widgetsForSlot } from '../../src/ui/registry';

const Noop = () => null;

describe('widget registry', () => {
  beforeEach(() => clearRegistry());

  it('returns widgets for a slot ordered by order', () => {
    registerWidget({ id: 'b', slot: 'header', order: 2, component: Noop });
    registerWidget({ id: 'a', slot: 'header', order: 1, component: Noop });
    expect(widgetsForSlot('header').map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('hides flag-gated widgets unless the flag is on', () => {
    registerWidget({ id: 'refs', slot: 'drawer', flag: 'references', component: Noop });
    expect(widgetsForSlot('drawer')).toHaveLength(0);
    expect(widgetsForSlot('drawer', { references: true })).toHaveLength(1);
  });

  it('honors a when() predicate', () => {
    registerWidget({ id: 'x', slot: 'statusbar', when: () => false, component: Noop });
    expect(widgetsForSlot('statusbar')).toHaveLength(0);
  });
});
