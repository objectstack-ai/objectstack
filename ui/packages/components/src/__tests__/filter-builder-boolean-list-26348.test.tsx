/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The builder's list values hold what the spec rule's list holds (#26348).
 *
 * `ViewFilterRuleSchema` (`@objectstack/spec/ui`) takes `in` / `not_in` /
 * `between` values as arrays of strings and numbers. The builder's row used to
 * declare a wider list member of its own, `(string | number | boolean)[]`, and
 * its one list writer for a scalar, `normalizeToArray`, kept a boolean a
 * boolean. So an `equals true` row (a boolean scalar, which the spec admits) on
 * a `select` column, switched to `In`, emitted `[true]`, and the schema refused
 * the rule the builder had just produced.
 *
 * The emitted list now matches the spec's list element at the source: a boolean
 * carried into a list or a range is written as its string spelling, the
 * conversion the builder already makes for a boolean that reaches a text
 * column. The row's value is the spec rule's value and nothing wider.
 *
 * Type-level pins are judged by `tsc -p tsconfig.test.json`; a green vitest run
 * says nothing about them.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ViewFilterRuleSchema, type ViewFilterRule } from '@objectstack/spec/ui';
import type { FilterGroup } from '@object-ui/types';
import {
  FilterBuilder,
  reshapeFilterValue,
  retypeFilterValue,
  type FilterBuilderProps,
  type FilterBuilderRow,
} from '../custom/filter-builder';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }

/* ── The shape ────────────────────────────────────────────────────────────── */

// The row's value IS the spec rule's value, with no wider list member beside it.
expectType<Equal<FilterBuilderRow['value'], ViewFilterRule['value']>>();
// So a boolean list is refused where it is written, as the schema refuses it.
const booleanList: FilterBuilderRow = {
  id: 'c1',
  field: 'stage',
  operator: 'in',
  // @ts-expect-error a list entry is a string or a number, as the spec's is
  value: [true],
};
// A boolean SCALAR stays admitted: the spec admits it, and `equals true` is a row.
const booleanScalar: FilterBuilderRow = { id: 'c1', field: 'active', operator: 'equals', value: true };
void booleanList;
void booleanScalar;

const FIELDS: NonNullable<FilterBuilderProps['fields']> = [
  {
    value: 'stage',
    label: 'Stage',
    type: 'select',
    options: [
      { value: 'true', label: 'True' },
      { value: 'won', label: 'Won' },
    ],
  },
  { value: 'closed_at', label: 'Closed at', type: 'date' },
];

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

/** Drive the row's REAL operator dropdown (index 1: field, operator, value). */
async function pickOperator(label: string) {
  fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the operator dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

function specAccepts(row: FilterBuilderRow): boolean {
  return ViewFilterRuleSchema.safeParse({ field: row.field, operator: row.operator, value: row.value })
    .success;
}

describe('#26348 — a boolean carried into a list is a list the spec accepts', () => {
  it('the schema refuses the list the builder used to emit (non-vacuity)', () => {
    expect(ViewFilterRuleSchema.safeParse({ field: 'stage', operator: 'in', value: [true] }).success).toBe(false);
    expect(ViewFilterRuleSchema.safeParse({ field: 'stage', operator: 'in', value: ['true'] }).success).toBe(true);
  });

  it('an `equals true` row on a select column, switched to In, emits ["true"]', async () => {
    const onChange = renderAuthored({ id: 'c1', field: 'stage', operator: 'equals', value: true });
    await pickOperator('In');
    const row = lastRow(onChange);
    expect(row.operator).toBe('in');
    expect(row.value).toEqual(['true']);
    expect(specAccepts(row)).toBe(true);
    // Still drawn: the list control compares entries with `String()`, so the
    // option whose value is "true" is the one ticked.
    const ticked = screen.getAllByRole('checkbox').filter((c) => c.getAttribute('data-state') === 'checked');
    expect(ticked).toHaveLength(1);
    expect(ticked[0].closest('label')).toHaveTextContent('True');
  });

  it('`equals false` switched to Not in emits ["false"]', async () => {
    const onChange = renderAuthored({ id: 'c1', field: 'stage', operator: 'equals', value: false });
    await pickOperator('Not in');
    const row = lastRow(onChange);
    expect(row.value).toEqual(['false']);
    expect(specAccepts(row)).toBe(true);
  });

  it('the helpers write a boolean list or range entry as its string spelling', () => {
    expect(reshapeFilterValue(true, 'in')).toEqual(['true']);
    expect(reshapeFilterValue(false, 'not_in')).toEqual(['false']);
    expect(reshapeFilterValue(true, 'between')).toEqual(['true', '']);
    // A scalar target is untouched: `equals true` keeps its boolean.
    expect(reshapeFilterValue(true, 'equals')).toBe(true);
    // A field switch into a list column converts the same way.
    expect(retypeFilterValue(true, 'select', 'in')).toEqual(['true']);
  });
});
