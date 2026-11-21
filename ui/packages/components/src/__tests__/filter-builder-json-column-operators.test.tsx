/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A field stored as a JSON column — a multi-value field (`multiselect` /
 * `checkboxes` / `tags`, or a multi-capable type with `multiple: true`) or a
 * structured-JSON type — takes only the operators the server answers on it.
 * The server refuses the equality, list-membership, ordering and text-match
 * operators there with `400 INVALID_FILTER` (`JSON_COLUMN_INCOMPATIBLE_OPERATORS`
 * in `@objectstack/core`); membership is `contains` / `not_contains`, and no
 * value is the empty pair.
 *
 * What the dropdown offers is pinned here; the wire shape each offered
 * operator lowers to, checked against the server's refusal set itself, is
 * pinned beside the list's lowering in `plugin-list`'s conditions harness.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  FilterBuilder,
  jsonColumnFilterOperators,
  operatorsForField,
  operatorsForFieldType,
  type FilterBuilderRowGroup,
} from '../custom/filter-builder';

afterEach(cleanup);

const OPTIONS = [
  { value: 'quality_lead', label: 'Quality lead' },
  { value: 'safety_officer', label: 'Safety officer' },
];
const FIELDS = [
  { value: 'responsibilities', label: 'Responsibilities', type: 'select', multiple: true, options: OPTIONS },
  { value: 'labels', label: 'Labels', type: 'multiselect', options: OPTIONS },
  { value: 'stage', label: 'Stage', type: 'select', options: OPTIONS },
  { value: 'address', label: 'Address', type: 'address' },
  { value: 'name', label: 'Name', type: 'text' },
];
const MULTI_OFFER = ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
const MULTI_LABELS = ['Contains', 'Does not contain', 'Is empty', 'Is not empty'];

function renderRow(condition: Record<string, unknown>, fields: typeof FIELDS = FIELDS) {
  const onChange = vi.fn();
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', value: '', ...condition }] } as unknown as FilterBuilderRowGroup;
  render(<FilterBuilder fields={fields} value={value} onChange={onChange} />);
  return { onChange };
}

async function openOperatorList(): Promise<string[]> {
  fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
  return waitFor(() => {
    const found = screen.getAllByRole('option');
    expect(found.length).toBeGreaterThan(0);
    return found.map((o) => o.textContent ?? '');
  });
}

describe('jsonColumnFilterOperators — the one helper every filter surface reads', () => {
  it('a multi-value field, by type or by `multiple: true`, takes contains / not contains / empty pair', () => {
    for (const field of [
      { type: 'multiselect' },
      { type: 'checkboxes' },
      { type: 'tags' },
      { type: 'select', multiple: true },
      { type: 'radio', multiple: true },
      { type: 'lookup', multiple: true },
      { type: 'user', multiple: true },
    ]) {
      expect(jsonColumnFilterOperators(field), JSON.stringify(field)).toEqual(MULTI_OFFER);
      expect(operatorsForField(field).map((op) => op.value)).toEqual(MULTI_OFFER);
    }
  });

  it('a structured-JSON field takes the empty pair only', () => {
    for (const type of ['json', 'address', 'location', 'repeater']) {
      expect(jsonColumnFilterOperators({ type }), type).toEqual(['is_empty', 'is_not_empty']);
    }
  });

  it('every other field keeps its type bucket (CONTROL: single select, lookup, text)', () => {
    for (const field of [{ type: 'select' }, { type: 'select', multiple: false }, { type: 'lookup' }, { type: 'text' }, undefined]) {
      expect(jsonColumnFilterOperators(field)).toBeUndefined();
      expect(operatorsForField(field).map((op) => op.value)).toEqual(
        operatorsForFieldType(field?.type).map((op) => op.value),
      );
    }
    expect(operatorsForField({ type: 'select' }).map((op) => op.value)).toEqual(
      expect.arrayContaining(['equals', 'not_equals', 'in', 'not_in']),
    );
  });

  it('what a row can HOLD is still the type bucket, so a stored refused operator stays editable', () => {
    expect(operatorsForFieldType('multiselect').map((op) => op.value)).toContain('equals');
  });
});

describe('FilterBuilder — a multi-value row offers only what the server accepts', () => {
  it('a `select` with `multiple: true` offers 包含 / 不包含 / 为空 / 不为空 and none of the refused set', async () => {
    renderRow({ field: 'responsibilities', operator: 'contains' });
    expect(await openOperatorList()).toEqual(MULTI_LABELS);
  });

  it('a `multiselect` offers the same four', async () => {
    renderRow({ field: 'labels', operator: 'contains' });
    expect(await openOperatorList()).toEqual(MULTI_LABELS);
  });

  it('a structured-JSON field offers the empty pair only', async () => {
    renderRow({ field: 'address', operator: 'is_empty' });
    expect(await openOperatorList()).toEqual(['Is empty', 'Is not empty']);
  });

  it('a single-value select keeps equals / in (CONTROL)', async () => {
    renderRow({ field: 'stage', operator: 'equals' });
    expect(await openOperatorList()).toEqual(
      expect.arrayContaining(['Equals', 'Not equals', 'In', 'Not in', 'Is empty', 'Is not empty']),
    );
  });

  it('a stored `equals` on a multi-value field still loads and shows, beside the four', async () => {
    renderRow({ field: 'responsibilities', operator: 'equals', value: 'quality_lead' });
    expect(screen.getAllByRole('combobox')[1].textContent).toBe('Equals');
    expect(await openOperatorList()).toEqual(['Equals', ...MULTI_LABELS]);
  });

  it('contains draws a single-option picker of the field’s options', () => {
    renderRow({ field: 'labels', operator: 'contains', value: 'quality_lead' });
    // combobox 2 is the value Select (field, operator, value)
    expect(screen.getAllByRole('combobox')[2].textContent).toBe('Quality lead');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('switching a row on `equals` to a multi-value field lands on contains', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'equals', value: 'quality_lead' });
    fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
    const option = await waitFor(() => {
      const found = screen.getAllByRole('option').find((o) => o.textContent === 'Responsibilities');
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.click(option);
    const row = onChange.mock.calls[onChange.mock.calls.length - 1][0].conditions[0];
    expect(row).toMatchObject({ field: 'responsibilities', operator: 'contains', value: 'quality_lead' });
  });

  it('“Add filter” on a multi-value first field seeds contains, not equals', () => {
    const onChange = vi.fn();
    render(
      <FilterBuilder
        fields={FIELDS}
        value={{ id: 'root', logic: 'and', conditions: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange.mock.calls.at(-1)[0].conditions[0]).toMatchObject({ field: 'responsibilities', operator: 'contains' });
  });
});
