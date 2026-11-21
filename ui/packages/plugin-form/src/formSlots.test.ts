import { describe, it, expect, vi } from 'vitest';
import { FormSlotStore, formSlotGroupIndex, placeFormSlots, type FormSlotRequest } from './formSlots';

// objectstack#35889 — a collection a field group places sits at that group in
// the header form, by the record page's rule (`bodyTablePlacement`).

const groups = [
  { key: 'header', label: 'Header', fields: ['ref'] },
  { key: 'lines', label: 'Lines', relatedList: 'po_line' },
  { key: 'totals', label: 'Totals', fields: ['memo'] },
];
const lines: FormSlotRequest = { id: 'd0', childObject: 'po_line', relationshipField: 'po' };
const named = (s: { name?: string }) => s.name;
const order = (sequence: Array<{ section: { name?: string } } | { slot: FormSlotRequest }>) =>
  sequence.map((item) => ('slot' in item ? `slot:${item.slot.id}` : item.section.name ?? '(ungrouped)'));

describe('placeFormSlots (objectstack#35889)', () => {
  it('puts a placed collection after the groups declared before its group and before those after it', () => {
    const { sequence, placed } = placeFormSlots(
      [{ name: 'header' }, { name: 'totals' }, {}],
      named,
      groups,
      [lines],
    );
    expect(order(sequence)).toEqual(['header', 'slot:d0', 'totals', '(ungrouped)']);
    expect(placed).toEqual(['d0']);
  });

  it('a group declared last puts it after the declared groups and before the ungrouped bucket', () => {
    const last = [groups[0], groups[2], groups[1]];
    const { sequence } = placeFormSlots([{ name: 'header' }, { name: 'totals' }, {}], named, last, [lines]);
    expect(order(sequence)).toEqual(['header', 'totals', 'slot:d0', '(ungrouped)']);
  });

  it('reads the group entry as the record page does: a bare child, or object.field', () => {
    expect(formSlotGroupIndex(groups, lines)).toBe(1);
    expect(formSlotGroupIndex([{ key: 'l', relatedList: 'po_line.po' }], lines)).toBe(0);
    expect(formSlotGroupIndex([{ key: 'l', relatedList: 'po_line.other' }], lines)).toBeNull();
    // No FK on the request: only a bare child-name group places it.
    expect(formSlotGroupIndex([{ key: 'l', relatedList: 'po_line.po' }], { id: 'x', childObject: 'po_line' })).toBeNull();
    expect(formSlotGroupIndex(groups, { id: 'x', childObject: 'po_line' })).toBe(1);
  });

  it('places nothing a group does not name, and nothing when no section names a declared group', () => {
    const other: FormSlotRequest = { id: 'd1', childObject: 'note', relationshipField: 'po' };
    const a = placeFormSlots([{ name: 'header' }], named, groups, [other]);
    expect(order(a.sequence)).toEqual(['header']);
    expect(a.placed).toEqual([]);
    // Authored sections of their own: no position to give, the host keeps it.
    const b = placeFormSlots([{ name: 'main' }, { name: 'more' }], named, groups, [lines]);
    expect(order(b.sequence)).toEqual(['main', 'more']);
    expect(b.placed).toEqual([]);
    expect(placeFormSlots([{ name: 'header' }], named, undefined, [lines]).placed).toEqual([]);
  });
});

describe('FormSlotStore (objectstack#35889)', () => {
  it('draws a collection in place until a layout claims it, then in its slot, and nowhere while the slot is unmounted', () => {
    const store = new FormSlotStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.placement('d0')).toBe('inline');

    const el = { tagName: 'DIV' } as unknown as HTMLElement;
    store.refFor('d0')(el);
    // Mounted but not claimed: still in place.
    expect(store.placement('d0')).toBe('inline');
    store.claim(['d0']);
    expect(store.placement('d0')).toBe(el);
    store.refFor('d0')(null);
    expect(store.placement('d0')).toBeNull();
    store.claim([]);
    expect(store.placement('d0')).toBe('inline');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('hands out one element callback per id, and an equal claim changes nothing', () => {
    const store = new FormSlotStore();
    expect(store.refFor('d0')).toBe(store.refFor('d0'));
    store.claim(['d0']);
    const v = store.getVersion();
    store.claim(['d0']);
    expect(store.getVersion()).toBe(v);
  });
});
