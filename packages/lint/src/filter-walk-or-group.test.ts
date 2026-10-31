// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28020] The filter field-key walk steps INTO an any-of group element of a
 * view filter list (`{ or: [rule, ...] }`).
 *
 * Before the walk knew the element, a group read as a field-keyed condition
 * object: its own key `or` was reported as the field it filters by, and the
 * rules inside it — the fields the query really filters by — were never seen.
 * So a group cost a false finding AND hid a true one. These pins hold both
 * halves, on the walk itself and through the list-view rule that reads it.
 */

import { describe, expect, it } from 'vitest';
import { walkFilterFieldKeys } from './filter-walk.js';
import { LIST_VIEW_FIELD_UNKNOWN, validateListViewFieldRefs } from './validate-list-view-field-refs.js';

const keysOf = (filter: unknown) => {
  const out: Array<{ field: string; path: string }> = [];
  walkFilterFieldKeys(filter, 'filter', (key) => out.push(key));
  return out;
};

describe('walkFilterFieldKeys and the any-of group', () => {
  it('reports the rules of a group, at their own paths, and never `or` itself', () => {
    expect(keysOf([
      { or: [
        { field: 'status', operator: 'equals', value: 'open' },
        { field: 'completed_at', operator: 'after', value: '{7_days_ago}' },
      ] },
      { field: 'owner', operator: 'equals', value: '{current_user_id}' },
    ])).toEqual([
      { field: 'status', path: 'filter[0].or[0].field' },
      { field: 'completed_at', path: 'filter[0].or[1].field' },
      { field: 'owner', path: 'filter[1].field' },
    ]);
  });

  it('CONTROL: a whole-filter condition object whose field is named `or` is still a condition', () => {
    // Only a MEMBER of a filter list is an element; a Mongo-style record that
    // is the whole filter keeps its field-keyed reading.
    expect(keysOf({ or: 'x' })).toEqual([{ field: 'or', path: 'filter.or' }]);
  });
});

describe('validateListViewFieldRefs through a group', () => {
  const stack = (filter: unknown) => ({
    name: 'probe',
    objects: [{
      name: 'duly_task',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'status', type: 'select' },
        { name: 'completed_at', type: 'datetime' },
      ],
    }],
    views: [{ name: 'duly_task', object: 'duly_task', list: { type: 'grid', columns: ['title'], filter } }],
  });

  it('a group of real fields is silent', () => {
    const findings = validateListViewFieldRefs(stack([{ or: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'completed_at', operator: 'after', value: '{7_days_ago}' },
    ] }]));
    expect(findings).toEqual([]);
  });

  it('an unknown field inside a group is an error at its own path', () => {
    const findings = validateListViewFieldRefs(stack([{ or: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'no_such_field', operator: 'equals', value: 'x' },
    ] }]));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [LIST_VIEW_FIELD_UNKNOWN, 'views[0].list.filter[0].or[1].field'],
    ]);
  });
});
