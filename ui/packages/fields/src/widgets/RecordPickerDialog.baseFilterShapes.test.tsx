/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordPickerDialog.baseFilter` accepts TWO shapes — objectui#3831.
 *
 * The slot was declared `Record< string, any >` and merged by object spread,
 * which serves the dependent-lookup chain (#2215) exactly right and cannot
 * carry a spec `ViewFilterRule[]` at all: TypeScript accepts an array there
 * (an array satisfies a string index of `any`), the spread flattens it to
 * `{"0": rule, "1": rule}`, and the query then filters on columns literally
 * named `0`/`1` — green types, wrong query, no diagnostic. That is the slot
 * `record:related_list.add.picker.filter` has to reach.
 *
 * So the merge now discriminates on shape, and both directions are pinned here:
 *
 *  - **record form** keeps KEY-OVERWRITE precedence, byte for byte. A cascaded
 *    parent value must REPLACE a stale same-field `lookupFilters` entry, not
 *    intersect with it — `account = 'stale' AND account = 'a1'` returns nothing.
 *    (`LookupField.dependsOn.test.tsx` owns the #2215 behaviour end-to-end and
 *    is deliberately left untouched; this file pins the same precedence at the
 *    dialog's own boundary, so a future merge change cannot pass by only
 *    satisfying the array path.)
 *  - **rule array** lowers through `mergeFilterNodes`, the repo's single filter
 *    sink, so all 19 `VIEW_FILTER_OPERATORS` survive — including the four
 *    (`before`, `after`, `is_empty`, `is_not_empty`) the MongoDB-style record
 *    form has no `$op` for and which a hand-rolled second lowering would have
 *    had to drop or throw on.
 */

import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RecordPickerDialog } from './RecordPickerDialog';

const records = [{ id: 'r1', name: 'One' }];

function makeDataSource() {
  const find = vi.fn(async () => ({ data: records, total: records.length }));
  return { find } as any;
}

/** The `$filter` of the most recent query. */
function lastFilter(ds: any) {
  const calls = ds.find.mock.calls;
  return calls[calls.length - 1][1]?.$filter;
}

describe('RecordPickerDialog baseFilter — record form (#2215 precedence)', () => {
  it('spreads a record baseFilter last, overwriting lookupFilters on the same field', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
        lookupFilters={[{ field: 'account', operator: 'eq', value: 'stale' }]}
        baseFilter={{ account: 'a1' }}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // Still the plain record form — NOT lowered to an AST, and emphatically not
    // an `and` of the stale value with the cascaded one.
    expect(lastFilter(ds)).toEqual({ account: 'a1' });
    expect(Array.isArray(lastFilter(ds))).toBe(false);
  });

  it('sends no $filter at all when nothing is constrained', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastFilter(ds)).toBeUndefined();
  });
});

describe('RecordPickerDialog baseFilter — spec ViewFilterRule[] (#3831)', () => {
  it('lowers a rule array to AST nodes instead of spreading it into index keys', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="sys_position"
        onSelect={vi.fn()}
        baseFilter={[{ field: 'is_active', operator: 'equals', value: true }]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastFilter(ds)).toEqual([['is_active', 'equals', true]]);
    // The old object-spread failure mode, pinned by structure rather than by
    // key: the spread produced a PLAIN OBJECT whose values were still rule
    // objects (`{"0": {field, operator, value}}`), so the query asked for a
    // column named `0`. Asserting on `Object.keys` cannot tell the two apart —
    // an array's keys are its indices too — so what is pinned is that each
    // element is an AST TRIPLE and no longer carries a `field` member.
    const filter = lastFilter(ds) as unknown[];
    expect(Array.isArray(filter)).toBe(true);
    expect(Array.isArray(filter[0])).toBe(true);
    expect(filter[0]).not.toHaveProperty('field');
  });

  it('preserves the four operators the record form cannot spell', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="sys_license"
        onSelect={vi.fn()}
        baseFilter={[
          { field: 'starts_at', operator: 'before', value: '2026-01-01' },
          { field: 'expires_at', operator: 'after', value: '2026-01-01' },
          { field: 'revoked_at', operator: 'is_empty' },
          { field: 'assigned_to', operator: 'is_not_empty' },
        ]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastFilter(ds)).toEqual([
      ['starts_at', 'before', '2026-01-01'],
      ['expires_at', 'after', '2026-01-01'],
      // A rule with no `value` stays two-element: inventing `null` here would be
      // a real `{revoked_at: null}` predicate, i.e. a different question.
      ['revoked_at', 'is_empty'],
      ['assigned_to', 'is_not_empty'],
    ]);
  });

  it('keeps a record baseFilter and a rule array as separate `and` children', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="sys_position"
        onSelect={vi.fn()}
        // A rule array is the author's restriction; the record-form base still
        // arrives via `lookupFilters` here, and the two must BOTH apply.
        lookupFilters={[{ field: 'company', operator: 'eq', value: 'c1' }]}
        baseFilter={[{ field: 'is_active', operator: 'equals', value: true }]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastFilter(ds)).toEqual([
      'and',
      ['company', '=', 'c1'],
      [['is_active', 'equals', true]],
    ]);
  });

  it('sends no $filter for an empty rule array', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="sys_position"
        onSelect={vi.fn()}
        baseFilter={[]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // An empty restriction is no restriction — not an empty `$filter` the wire
    // has to interpret.
    expect(lastFilter(ds)).toBeUndefined();
  });
});
