/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The builder accepts the spec-derived group the `filter-builder` renderer
 * hands it (#26306).
 *
 * The renderer passes `schema.value` — the authored `FilterGroup` from
 * `@object-ui/types`, whose row takes its operator from the spec's
 * `ViewFilterOperator` — to a builder typed on its own `FilterBuilderRowGroup`.
 * The two were assignable in neither direction, and the renderer props' `any`
 * index signature hid that. Measured against the spec's `ViewFilterRule`
 * (`@objectstack/spec/ui`), the row diverged in three VALUE cases and in no
 * operator case a consumer can author:
 *
 *   | case                           | spec rule              | builder row (before)            |
 *   |--------------------------------|------------------------|---------------------------------|
 *   | value omitted (unary operator) | `value?`               | `value` required                |
 *   | value `null`                   | admitted               | refused                         |
 *   | boolean entry in a list / pair | refused                | admitted (narrowed by #26348)   |
 *   | operator                       | `VIEW_FILTER_OPERATORS` | those + opt-in `exists` / `notExists` |
 *
 * The operator row is not a divergence on the way IN: every spec id is a
 * builder id. The opt-in pair is the builder's emit-side extension (objectui#9559
 * ruling B) and is pinned in `filter-builder-name-authority-9306.test.tsx`.
 *
 * The builder's row now takes the spec's value by reference
 * (`ViewFilterRule["value"]`), so the two cases that kept an authored group out
 * of the builder have one pin each below. Neither was only a type gap: a field
 * switch converted the ABSENT value, so a value-less row on a number column
 * threw on `.trim()` and on a text column came back as the string
 * `"undefined"`.
 *
 * The third case runs the other way — the builder was WIDER than the spec, so it
 * did not keep an authored group out — and was left as it was here. #26348
 * narrowed it: the row's value is now the spec's value and nothing wider, and
 * the writers that produced a boolean list entry write its string spelling.
 * Its pins live in `filter-builder-boolean-list-26348.test.tsx`.
 *
 * Type-level pins are judged by `tsc -p tsconfig.test.json`; a green vitest run
 * says nothing about them.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ViewFilterRule } from '@objectstack/spec/ui';
import type { FilterField, FilterGroup } from '@object-ui/types';
import {
  FilterBuilder,
  retypeFilterValue,
  type FilterBuilderProps,
  type FilterBuilderRow,
} from '../custom/filter-builder';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }
type Assignable<From, To> = [From] extends [To] ? true : false;

/* ── The shapes ───────────────────────────────────────────────────────────── */

// The row's value IS the spec rule's value — by reference, not a copy of it.
expectType<Equal<FilterBuilderRow['value'], ViewFilterRule['value']>>();
expectType<Assignable<ViewFilterRule['value'], FilterBuilderRow['value']>>();
// The renderer's two reads cross with no cast: the authored group and the
// authored field list are what the builder's props take.
expectType<Assignable<FilterGroup, NonNullable<FilterBuilderProps['value']>>>();
expectType<Assignable<FilterField[], NonNullable<FilterBuilderProps['fields']>>>();

const FIELDS: NonNullable<FilterBuilderProps['fields']> = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'quota', label: 'Quota', type: 'currency' },
];

/** Render ONE authored row, typed as the authored group — no cast. */
function renderAuthored(row: FilterGroup['conditions'][number]) {
  const onChange = vi.fn();
  // Hoisted out of the JSX: the sync effect re-seeds state when the `value`
  // prop's identity changes, which would undo the interaction under test.
  const value: FilterGroup = { logic: 'and', conditions: [row] };
  render(<FilterBuilder fields={FIELDS} value={value} onChange={onChange} />);
  return onChange;
}

function lastRow(onChange: ReturnType<typeof vi.fn>): FilterBuilderRow {
  expect(onChange.mock.calls.length, 'the builder never called onChange').toBeGreaterThan(0);
  return onChange.mock.calls.at(-1)?.[0].conditions[0];
}

/** Drive the row's REAL dropdown at `index` (0 = field). */
async function pick(index: number, label: string) {
  fireEvent.keyDown(screen.getAllByRole('combobox')[index], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in dropdown ${index}`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

describe('#26306 — the builder accepts the spec-derived row', () => {
  it('value omitted: a value-less row keeps no value through a field switch (it used to throw on a number column)', async () => {
    const onChange = renderAuthored({ id: 'c1', field: 'title', operator: 'is_null' });
    await pick(0, 'Amount');
    const row = lastRow(onChange);
    expect(row.field).toBe('amount');
    expect(row.operator).toBe('is_null');
    expect(row.value).toBeUndefined();
    // The text family, where the absence used to come back spelled out.
    expect(retypeFilterValue(undefined, 'text', 'is_null')).toBeUndefined();
  });

  it('value null: a null row keeps null through a field switch (it used to throw on `.trim()`)', async () => {
    const onChange = renderAuthored({ id: 'c1', field: 'amount', operator: 'equals', value: null });
    // Drawn as unfilled, not as the string "null".
    expect((document.querySelector('input[placeholder="Value"]') as HTMLInputElement).value).toBe('');
    await pick(0, 'Quota');
    const row = lastRow(onChange);
    expect(row.field).toBe('quota');
    expect(row.value).toBeNull();
  });

});
