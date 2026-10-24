/**
 * objectui#12418 — the `ui.list.<object>` slot's shape, kept by the pure
 * helpers every write goes through.
 *
 *   - A stored value keeps only what the slot declares, well formed: a
 *     malformed piece is dropped, never coerced into another meaning.
 *   - A view's entry: an empty sort is the user's choice and is KEPT (the list
 *     then asks for no order), distinct from a `null` sort, which clears it; a
 *     filter group with no condition and an empty column layout CLEAR their
 *     part; a view left with nothing is removed.
 *   - "Reset view" removes one view's entry and leaves the tab order.
 *   - The older per-browser keys are folded into the first read of an object
 *     with no cached entry, and only then.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  localListStateKey,
  patchViewPreference,
  readLocalListState,
  resetViewPreference,
  sanitizeObjectListPreference,
  setViewOrderPreference,
  writeLocalListState,
} from '../ListPreferencesProvider';

const GROUP = { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'x' }] };

describe('the slot keeps only what it declares (objectui#12418)', () => {
  it('drops malformed pieces and the builder row ids of a sort', () => {
    expect(sanitizeObjectListPreference({
      viewOrder: ['a', 2, 'b'],
      perView: {
        v1: {
          sort: [{ id: 'r1', field: 'name', order: 'desc' }, { order: 'asc' }, 'x'],
          filters: GROUP,
          columnState: { order: ['name'], widths: { name: 200, bad: 'wide' } },
          unknown: true,
        },
        v2: { filters: { conditions: [] } },
        v3: 'not an object',
      },
      extra: 1,
    })).toEqual({
      perView: {
        v1: {
          sort: [{ field: 'name', order: 'desc' }],
          filters: GROUP,
          columnState: { order: ['name'], widths: { name: 200 } },
        },
      },
    });
    expect(sanitizeObjectListPreference(['not', 'an', 'object'])).toEqual({});
    expect(sanitizeObjectListPreference({ viewOrder: ['a', 'b'] })).toEqual({ viewOrder: ['a', 'b'] });
  });
});

describe('a view entry\'s patch (objectui#12418)', () => {
  it('keeps an empty sort — the user cleared the order, which is not the view\'s order', () => {
    expect(patchViewPreference({}, 'v1', { sort: [] })).toEqual({ perView: { v1: { sort: [] } } });
  });

  it('`sort: []` stores "no sort"; `sort: null` (or undefined) clears the stored sort — two different facts', () => {
    const sorted = patchViewPreference({}, 'v1', { sort: [{ field: 'name', order: 'asc' }], filters: GROUP });
    const noSort = patchViewPreference(sorted, 'v1', { sort: [] });
    const cleared = patchViewPreference(sorted, 'v1', { sort: null });
    expect(noSort).toEqual({ perView: { v1: { sort: [], filters: GROUP } } });
    expect(cleared).toEqual({ perView: { v1: { filters: GROUP } } });
    expect(patchViewPreference(sorted, 'v1', { sort: undefined })).toEqual(cleared);
    expect(noSort).not.toEqual(cleared);
  });

  it('clears the filters on a group with no condition, and drops a view left empty', () => {
    const state = patchViewPreference({}, 'v1', { filters: GROUP });
    expect(state).toEqual({ perView: { v1: { filters: GROUP } } });
    expect(patchViewPreference(state, 'v1', { filters: { id: 'root', logic: 'and', conditions: [] } })).toEqual({});
  });

  it('clears the column layout on an empty one, and leaves the other parts', () => {
    const state = patchViewPreference({}, 'v1', { sort: [{ field: 'name', order: 'asc' }], columnState: { widths: { name: 1 } } });
    expect(patchViewPreference(state, 'v1', { columnState: {} })).toEqual({
      perView: { v1: { sort: [{ field: 'name', order: 'asc' }] } },
    });
  });

  it('"Reset view" removes one view\'s entry and leaves the tab order and the other views', () => {
    let state = setViewOrderPreference({}, ['v2', 'v1']);
    state = patchViewPreference(state, 'v1', { sort: [{ field: 'name', order: 'asc' }] });
    state = patchViewPreference(state, 'v2', { filters: GROUP });
    expect(resetViewPreference(state, 'v1')).toEqual({ viewOrder: ['v2', 'v1'], perView: { v2: { filters: GROUP } } });
    // Nothing stored for the view: the same state back.
    expect(resetViewPreference(state, 'v9')).toBe(state);
  });
});

describe('this browser\'s cache and the older keys (objectui#12418)', () => {
  beforeEach(() => localStorage.clear());

  it('the first read of an object with no cached entry folds `viewOrder:<object>` and each view\'s Filter panel group', () => {
    localStorage.setItem('viewOrder:deal', JSON.stringify(['deal.b', 'deal.a']));
    localStorage.setItem('list-filters:u1:deal:deal.a', JSON.stringify({ filters: GROUP, search: 'x' }));
    localStorage.setItem('list-filters:u1:deal:deal.b', JSON.stringify({ search: 'only a term' }));
    // Another user's and another object's keys are not this object's.
    localStorage.setItem('list-filters:u2:deal:deal.a', JSON.stringify({ filters: GROUP }));
    localStorage.setItem('list-filters:u1:lead:lead.a', JSON.stringify({ filters: GROUP }));

    expect(readLocalListState('u1', 'deal')).toEqual({
      viewOrder: ['deal.b', 'deal.a'],
      perView: { 'deal.a': { filters: GROUP } },
    });
  });

  it('once the object has a cached entry, the older keys are not read', () => {
    localStorage.setItem('viewOrder:deal', JSON.stringify(['deal.b', 'deal.a']));
    writeLocalListState('u1', 'deal', {});
    expect(readLocalListState('u1', 'deal')).toEqual({});
    expect(localStorage.getItem(localListStateKey('u1', 'deal'))).toBe('{}');
  });
});

describe('the density and the hidden fields are two more parts of a view\'s entry (objectui#12474)', () => {
  it('keeps a spec row height and drops any other value, never coercing it', () => {
    expect(sanitizeObjectListPreference({
      perView: {
        v1: { rowHeight: 'medium' },
        v2: { rowHeight: 'comfortable' },
        v3: { rowHeight: 7 },
      },
    })).toEqual({ perView: { v1: { rowHeight: 'medium' } } });
  });

  it('keeps the hidden fields as names, once each, and keeps an empty list as the user\'s choice', () => {
    expect(sanitizeObjectListPreference({
      perView: {
        v1: { hiddenFields: ['amount', 3, '', 'amount', 'stage'] },
        v2: { hiddenFields: [] },
        v3: { hiddenFields: 'amount' },
      },
    })).toEqual({ perView: { v1: { hiddenFields: ['amount', 'stage'] }, v2: { hiddenFields: [] } } });
  });

  it('a patch sets each part beside the others, and `null` clears only its own part', () => {
    let state = patchViewPreference({}, 'v1', { sort: [{ field: 'name', order: 'asc' }] });
    state = patchViewPreference(state, 'v1', { rowHeight: 'compact' });
    state = patchViewPreference(state, 'v1', { hiddenFields: ['amount'] });
    expect(state).toEqual({
      perView: { v1: { sort: [{ field: 'name', order: 'asc' }], rowHeight: 'compact', hiddenFields: ['amount'] } },
    });
    state = patchViewPreference(state, 'v1', { rowHeight: null });
    expect(state).toEqual({ perView: { v1: { sort: [{ field: 'name', order: 'asc' }], hiddenFields: ['amount'] } } });
    state = patchViewPreference(state, 'v1', { hiddenFields: null, sort: null });
    expect(state).toEqual({});
  });

  it('"Reset view" drops the density and the hidden fields with the rest of the view\'s entry', () => {
    const state = {
      viewOrder: ['v2', 'v1'],
      perView: { v1: { rowHeight: 'tall' as const, hiddenFields: [] }, v2: { rowHeight: 'short' as const } },
    };
    expect(resetViewPreference(state, 'v1')).toEqual({ viewOrder: ['v2', 'v1'], perView: { v2: { rowHeight: 'short' } } });
  });
});
