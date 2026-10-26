/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The FilterBuilder must not mint a value shape `ViewFilterRuleSchema` refuses
 * (objectui#3958, objectstack#6227).
 *
 * Three facts are pinned here, and they are three because the builder had three
 * independent ways to produce the same broken row:
 *
 *   1. **The families come from the spec.** `VIEW_FILTER_LIST_VALUE_OPERATORS`
 *      and `VIEW_FILTER_PAIR_VALUE_OPERATORS` are imported here and asserted
 *      against `filterValueArity`, so the component cannot answer this question
 *      from a local list again. The local list it used to keep — `["in",
 *      "notIn"]` — was already one spelling adrift: `notIn` is an ALIAS and the
 *      canonical member is `not_in`, so a stored view read back in canonical
 *      form got the SINGLE-value input for a set operator.
 *   2. **Changing the operator re-shapes the value.** The dropdown used to
 *      write `{ operator }` alone, so the seed `""` (or whatever the previous
 *      family had produced) survived the switch into `in`.
 *   3. **Every family has an input that can express it.** A select or lookup
 *      column OFFERS `in` in its dropdown but carries no static `options` until
 *      something loads them, so the row fell through to the single-value input
 *      and the user could only ever type a scalar into it; `between` had one
 *      input for two bounds.
 *
 * DIRECTION, predicted before running: every pin below is RED on `origin/main`
 * and green after — none of them is a "must not change" guard. The reverse
 * mutation is recorded in the PR: restoring the `["in", "notIn"]` literal turns
 * the canonical-`not_in` pin red (and ONLY that one — the alias spelling keeps
 * matching, which is exactly why the defect survived so long); restoring
 * `updateCondition(id, { operator })` turns the three switching pins red.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
  ViewFilterRuleSchema,
  normalizeFilterOperator,
} from '@objectstack/spec/ui';
import {
  FilterBuilder,
  filterValueArity,
  reshapeFilterValue,
} from '../custom/filter-builder';

/**
 * `stage` is the column this card is about: a `select` — so its bucket OFFERS
 * `in` / `notIn` — carrying no static `options`, which is what made
 * `renderValueInput` fall past every multi-value branch to the single-value
 * input. (Only the select and lookup buckets offer the set operators at all; a
 * `text` column can still ARRIVE at one by being read back from stored
 * metadata, which the spelling cases below cover.)
 */
const FIELDS = [
  { value: 'stage', label: 'Stage', type: 'select' },
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'closed_at', label: 'Closed at', type: 'date' },
];

function group(condition: Record<string, unknown>) {
  return { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
}

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted OUT of the JSX: `FilterBuilder`'s sync effect re-seeds its internal
  // state whenever the `value` PROP's identity changes, so an inline literal
  // would undo the interaction under test on the next render.
  const value = group(condition);
  const utils = render(
    <FilterBuilder fields={FIELDS as any} value={value as any} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

/** The row the component handed back on its most recent `onChange`. */
function lastRow(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the builder never called onChange').toBeGreaterThan(0);
  return calls[calls.length - 1][0].conditions[0];
}

/**
 * Drive the REAL operator dropdown. The row's three controls are Radix
 * comboboxes in field / operator / value order, so index 1 is the operator.
 */
async function pickOperator(label: string) {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[1], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the operator dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

describe('operator families are the SPEC vocabulary, not a local literal', () => {
  it.each([...VIEW_FILTER_LIST_VALUE_OPERATORS])('reads %s as a list operator', (operator) => {
    expect(filterValueArity(operator)).toBe('list');
  });

  it.each([...VIEW_FILTER_PAIR_VALUE_OPERATORS])('reads %s as a pair operator', (operator) => {
    expect(filterValueArity(operator)).toBe('pair');
  });

  it('reads BOTH spellings of the same operator the same way', () => {
    // The whole point of folding through `normalizeFilterOperator`: the
    // builder's camelCase dropdown id and the canonical spelling a stored rule
    // carries are one operator, so they get one answer.
    expect(normalizeFilterOperator('notIn')).toBe('not_in');
    expect(filterValueArity('notIn')).toBe('list');
    expect(filterValueArity('not_in')).toBe('list');
  });

  it('leaves every other operator scalar', () => {
    for (const operator of ['equals', 'notEquals', 'contains', 'greaterThan', 'isEmpty']) {
      expect(filterValueArity(operator), operator).toBe('scalar');
    }
  });
});

describe('changing the operator re-shapes the value across families', () => {
  it('scalar to list: what the user typed becomes a one-element list', () => {
    expect(reshapeFilterValue('acme', 'in')).toEqual(['acme']);
    // The seed an untouched row carries becomes the EMPTY list, which the spec
    // accepts as a real predicate — not the `""` it refuses.
    expect(reshapeFilterValue('', 'notIn')).toEqual([]);
  });

  it('list to scalar: the first entry survives, the rest cannot', () => {
    expect(reshapeFilterValue(['a', 'b'], 'equals')).toBe('a');
    expect(reshapeFilterValue([], 'equals')).toBe('');
  });

  it('scalar to pair: one bound is filled, the other left open', () => {
    expect(reshapeFilterValue('2024-01-01', 'between')).toEqual(['2024-01-01', '']);
    // Nothing to carry → the "not filled in yet" shape, which the write path
    // drops rather than persisting an empty range.
    expect(reshapeFilterValue('', 'between')).toEqual([]);
  });

  it('pair to scalar, and list to pair', () => {
    expect(reshapeFilterValue(['1', '9'], 'greaterThan')).toBe('1');
    expect(reshapeFilterValue(['a', 'b', 'c'], 'between')).toEqual(['a', 'b']);
  });

  it('within one family the value is untouched', () => {
    const values = ['a', 'b'];
    expect(reshapeFilterValue(values, 'notIn')).toBe(values);
    expect(reshapeFilterValue('acme', 'contains')).toBe('acme');
  });

  it('drives it through the real operator dropdown', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'equals', value: 'acme' });
    await pickOperator('In');
    expect(lastRow(onChange)).toMatchObject({ operator: 'in', value: ['acme'] });
  });

  it('drives the reverse switch too', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'in', value: ['acme', 'globex'] });
    await pickOperator('Equals');
    expect(lastRow(onChange)).toMatchObject({ operator: 'equals', value: 'acme' });
  });

  it('drives a switch into the pair family', async () => {
    const { onChange } = renderRow({ field: 'closed_at', operator: 'after', value: '2024-01-01' });
    await pickOperator('Between');
    expect(lastRow(onChange)).toMatchObject({ operator: 'between', value: ['2024-01-01', ''] });
  });
});

describe('a list operator on an optionless field has a list input', () => {
  it('renders the token input and emits an ARRAY', () => {
    const { onChange, getByTestId } = renderRow({ field: 'stage', operator: 'in', value: [] });
    const input = getByTestId('filter-multi-value-stage').querySelector('input')!;
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastRow(onChange).value).toEqual(['acme']);
  });

  it('converts tokens on a numeric column', () => {
    const { onChange, getByTestId } = renderRow({ field: 'amount', operator: 'in', value: [] });
    const input = getByTestId('filter-multi-value-amount').querySelector('input')!;
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // A number, not "42": `ViewFilterRuleSchema` accepts both, but the live
    // grid compares against a numeric column.
    expect(lastRow(onChange).value).toEqual([42]);
  });

  it('removes a token', () => {
    const { onChange, getByTestId } = renderRow({
      field: 'stage',
      operator: 'in',
      value: ['acme', 'globex'],
    });
    const remove = getByTestId('filter-multi-value-stage').querySelectorAll('button')[0];
    fireEvent.click(remove);
    expect(lastRow(onChange).value).toEqual(['globex']);
  });

  // The two-directional pin. `notIn` is the spelling the dropdown writes;
  // `not_in` is the spelling a stored rule carries. Both are the same operator
  // and both must reach the same input — the canonical one is the half that was
  // broken, and it was invisible because the alias half worked.
  it.each(['in', 'notIn', 'not_in'])('renders it for the %s spelling', (operator) => {
    const { getByTestId } = renderRow({ field: 'title', operator, value: [] });
    expect(getByTestId('filter-multi-value-title')).toBeInTheDocument();
  });
});

describe('the pair operator has two bounds', () => {
  it('renders two inputs and emits a two-element array', () => {
    const { onChange, getByTestId } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: [],
    });
    const inputs = getByTestId('filter-range-closed_at').querySelectorAll('input');
    expect(inputs.length).toBe(2);
    fireEvent.change(inputs[0], { target: { value: '2024-01-01' } });
    expect(lastRow(onChange).value).toEqual(['2024-01-01', '']);
  });

  it('collapses back to the unfilled shape when both bounds are cleared', () => {
    const { onChange, getByTestId } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', ''],
    });
    const inputs = getByTestId('filter-range-closed_at').querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: '' } });
    expect(lastRow(onChange).value).toEqual([]);
  });
});

describe('the scalar operators are untouched', () => {
  it('still renders ONE plain input and still emits a scalar', () => {
    const { onChange, container } = renderRow({ field: 'title', operator: 'equals', value: '' });
    const inputs = container.querySelectorAll('input');
    expect(inputs.length).toBe(1);
    fireEvent.change(inputs[0], { target: { value: 'acme' } });
    expect(lastRow(onChange).value).toBe('acme');
  });

  it('draws no token or range input for a scalar operator', () => {
    const { queryByTestId } = renderRow({ field: 'title', operator: 'contains', value: 'ac' });
    expect(queryByTestId('filter-multi-value-title')).toBeNull();
    expect(queryByTestId('filter-range-title')).toBeNull();
  });
});

/**
 * The end this whole card is about: what the builder produces must PARSE.
 *
 * The real spec schema, not a restatement of it — and the `id` strip plus
 * operator normalization mirror what `app-shell`'s `foldFilterGroupToSpecRules`
 * does on the way to storage (pinned against the actual fold in
 * `viewFilterFold.builderSetOperators.test.tsx`, which this package cannot
 * import: `app-shell` depends on this one).
 */
function parseAsSpecRule(row: Record<string, unknown>) {
  const { id: _id, ...rest } = row;
  return ViewFilterRuleSchema.safeParse({
    ...rest,
    operator: normalizeFilterOperator(rest.operator),
  });
}

describe('what the builder emits is what the spec accepts', () => {
  it('refuses the shape this card is about — proving the parse is discriminating', () => {
    const refused = parseAsSpecRule({ id: 'c1', field: 'stage', operator: 'in', value: 'acme' });
    expect(refused.success).toBe(false);
    expect(refused.error!.issues[0].message).toMatch(/requires an ARRAY/);
  });

  it('accepts the row the token input builds', () => {
    const { onChange, getByTestId } = renderRow({ field: 'stage', operator: 'notIn', value: [] });
    const input = getByTestId('filter-multi-value-stage').querySelector('input')!;
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const parsed = parseAsSpecRule(lastRow(onChange));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual({ field: 'stage', operator: 'not_in', value: ['acme'] });
  });

  it('accepts the row the operator switch re-shapes', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'equals', value: 'acme' });
    await pickOperator('In');
    const parsed = parseAsSpecRule(lastRow(onChange));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual({ field: 'stage', operator: 'in', value: ['acme'] });
  });

  it('accepts the range the pair input builds', () => {
    const { onChange, getByTestId } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', ''],
    });
    const inputs = getByTestId('filter-range-closed_at').querySelectorAll('input');
    fireEvent.change(inputs[1], { target: { value: '2024-12-31' } });
    const parsed = parseAsSpecRule(lastRow(onChange));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', '2024-12-31'],
    });
  });
});
