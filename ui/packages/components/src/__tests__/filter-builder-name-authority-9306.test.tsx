/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The builder's row and group are DERIVED from `@object-ui/types`
 * (objectui#9306, which settles objectui#6349's two parked name-authority
 * rows).
 *
 * This package used to declare its own `FilterBuilderCondition` and
 * `FilterGroup` beside the ones `@object-ui/types` declares: the same two
 * names, twice, with `operator: string`, a required group `id` and nothing
 * tying either to the other declaration. The ruling makes the types
 * declaration the one name authority. This package keeps exactly two named
 * extensions on the row:
 *
 *   - `operator` — `FilterBuilderOperator`, the protocol's ids plus the opt-in
 *     `exists` / `notExists` (objectui#9559 ruling B);
 *   - `value` — required and narrowed to what this builder edits.
 *
 * Everything else comes from the authority, and the group restates only
 * `conditions` (to hold this package's row), so its `id` is optional here as it
 * is there.
 *
 * The two derived declarations carry names of their own, `FilterBuilderRow`
 * and `FilterBuilderRowGroup` (objectui#6349, batch 12): under the authority's
 * names they were a second authority for each name, with a shape assignable to
 * the authority's in neither direction. So `FilterBuilderCondition` and
 * `FilterGroup` mean the authored row and group only, and this module no
 * longer publishes either; the pins under "The names" hold that. The retirement of nested sub-groups on the authority is pinned in
 * `packages/types/src/__tests__/filter-builder-nested-group-retired-9306.test.ts`.
 *
 * Type-level pins below are judged by `tsc -p tsconfig.test.json`; a green
 * vitest run says nothing about them, since type assertions are erased first.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ViewFilterOperator } from '@objectstack/spec/ui';
import type {
  FilterBuilderCondition as AuthorityCondition,
  FilterGroup as AuthorityGroup,
} from '@object-ui/types';
import {
  FilterBuilder,
  type FilterBuilderRow,
  type FilterBuilderOperator,
  type FilterBuilderRowGroup,
} from '../custom/filter-builder';
import type * as BuilderModule from '../custom/filter-builder';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }

type NamedExtensions = 'operator' | 'value';

/* ── The names: the authority's two are not published here (objectui#6349) ── */

// Each `@ts-expect-error` IS the assertion: declare or re-export either name in
// this module again and the line stops erroring, which fails the compile.
// @ts-expect-error the builder's row is `FilterBuilderRow`; `FilterBuilderCondition` is @object-ui/types' authored row
type _OldRowName = BuilderModule.FilterBuilderCondition;
// @ts-expect-error the builder's group is `FilterBuilderRowGroup`; `FilterGroup` is @object-ui/types' authored group
type _OldGroupName = BuilderModule.FilterGroup;
// …while the operator extension keeps the name the ruling gives it (objectui#9306).
expectType<Equal<BuilderModule.FilterBuilderOperator, FilterBuilderOperator>>();

/* ── The row: everything but the two named extensions IS the authority's ─── */

expectType<Equal<Omit<FilterBuilderRow, NamedExtensions>, Omit<AuthorityCondition, NamedExtensions>>>();
expectType<Equal<keyof FilterBuilderRow, keyof AuthorityCondition>>();
expectType<Equal<FilterBuilderRow['id'], string>>();
// `id` is REQUIRED, not merely typed `string` (objectui#8415) — and it is the
// authority's requiredness, since this package no longer restates the member.
// @ts-expect-error `FilterBuilderRow.id` is required
const rowWithoutId: FilterBuilderRow = { field: 'a', operator: 'equals', value: 'x' };

// The operator extension: the protocol's ids plus the opt-in pair — and the
// authority's operator is WITHIN it, so a row the authority types is a row the
// dropdown can hold.
expectType<Equal<FilterBuilderRow['operator'], FilterBuilderOperator>>();
expectType<Equal<FilterBuilderOperator, ViewFilterOperator | 'exists' | 'notExists'>>();
expectType<Equal<Exclude<AuthorityCondition['operator'], FilterBuilderOperator>, never>>();
expectType<Equal<Exclude<FilterBuilderOperator, AuthorityCondition['operator']>, 'exists' | 'notExists'>>();
// …and it is no longer `string`: an id no dropdown entry holds is refused.
const offVocabulary: FilterBuilderRow = {
  id: 'c1',
  field: 'a',
  // @ts-expect-error `operator` is FilterBuilderOperator, not string
  operator: 'greaterThan',
  value: 1,
};

// The value extension: the builder's own scalar-or-list union, REQUIRED —
// ruled over the authority's `value?: any`, which would switch the typing of
// every exported value helper off in silence.
expectType<Equal<FilterBuilderRow['value'], string | number | boolean | (string | number | boolean)[]>>();
// @ts-expect-error `value` is required on the builder's row
const rowWithoutValue: FilterBuilderRow = { id: 'c1', field: 'a', operator: 'equals' };

/* ── The group: only `conditions` is restated ─────────────────────────────── */

expectType<Equal<Omit<FilterBuilderRowGroup, 'conditions'>, Omit<AuthorityGroup, 'conditions'>>>();
expectType<Equal<FilterBuilderRowGroup['conditions'], FilterBuilderRow[]>>();
expectType<Equal<FilterBuilderRowGroup['id'], string | undefined>>();
// `id` is OPTIONAL, not merely `string | undefined`: a group that omits it is a
// group, which only this annotation proves.
const groupWithoutId: FilterBuilderRowGroup = { logic: 'and', conditions: [] };
// A nested sub-group is not a row.
const nested: FilterBuilderRowGroup = {
  logic: 'and',
  // @ts-expect-error — `conditions` holds flat rows; a sub-group is retired (objectui#9306)
  conditions: [{ logic: 'or', conditions: [] }],
};

describe('objectui#9306 — the builder derives its row and group from @object-ui/types', () => {
  it('the type-level pins above compile (see `tsc -p tsconfig.test.json`); the fixtures are live values', () => {
    expect(rowWithoutId.field).toBe('a');
    expect(offVocabulary.id).toBe('c1');
    expect(rowWithoutValue.operator).toBe('equals');
    expect(groupWithoutId.conditions).toEqual([]);
    expect(nested.logic).toBe('and');
  });

  it('an id-less group comes back from `onChange` id-less — so the optional `id` describes what the builder emits', () => {
    // The runtime reading the aligned optionality rests on (the ruling's
    // premise 2): `onChange` spreads the group the host passed, so it never
    // invents an `id` for a group that had none.
    const onChange = vi.fn();
    const value: FilterBuilderRowGroup = {
      logic: 'and',
      conditions: [{ id: 'c1', field: 'name', operator: 'equals', value: 'x' }],
    };
    render(
      <FilterBuilder fields={[{ value: 'name', label: 'Name', type: 'text' }]} value={value} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    const emitted = onChange.mock.calls.at(-1)?.[0] as FilterBuilderRowGroup;
    expect(emitted).not.toHaveProperty('id');
    expect(emitted.logic).toBe('and');
    expect(emitted.conditions).toHaveLength(2);
    expect(emitted.conditions[1]).toMatchObject({ field: 'name', operator: 'equals', value: '' });
  });

  it('CONTROL — a group WITH an id keeps it, and no value at all emits the builder\'s own `root` group', () => {
    const withId = vi.fn();
    const { unmount } = render(
      <FilterBuilder
        fields={[{ value: 'name', label: 'Name', type: 'text' }]}
        value={{ id: 'g1', logic: 'or', conditions: [] }}
        onChange={withId}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect((withId.mock.calls.at(-1)?.[0] as FilterBuilderRowGroup).id).toBe('g1');
    unmount();

    const noValue = vi.fn();
    render(<FilterBuilder fields={[{ value: 'name', label: 'Name', type: 'text' }]} onChange={noValue} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect((noValue.mock.calls.at(-1)?.[0] as FilterBuilderRowGroup).id).toBe('root');
  });
});
