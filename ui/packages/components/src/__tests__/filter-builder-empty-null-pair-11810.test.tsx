/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11810 — one empty-check pair per column, unless the column's type
 * really tells "empty" from "null"; then both pairs, with a hint saying how.
 *
 * The per-type table is the spec's own (`expandEmptyOperator`, the function
 * every server face expands `$empty` with): on a `null_only` type `is_empty`
 * matches null and nothing else, which is exactly what `is_null` matches, so
 * the dropdown used to ask an end user to choose between two labels for one
 * set of records. `text` types count `''` as empty too and list types count
 * `[]`, so there the two pairs are two predicates and both stay.
 *
 * The narrowing is the dropdown's OFFER only. `operatorsForFieldType` — what a
 * row can HOLD, which `app-shell`'s dataset read-back and `plugin-list`'s
 * parity pin ask — is unchanged, and a stored `is_null` on a `select` column
 * still loads and shows as what it is.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { expandEmptyOperator } from '@objectstack/spec/data';
import { FilterBuilder, operatorsForFieldType, type FilterBuilderRowGroup } from '../custom/filter-builder';

const TEXT_HINT = '"Is empty" also matches blank text; "Is null" matches only a missing value.';
const LIST_HINT = '"Is empty" also matches an empty list; "Is null" matches only a missing value.';

/** One field per type under test, so a row can be pointed at any of them. */
const TYPES = [
  'text', 'textarea', 'email',
  'select', 'status', 'lookup', 'user', 'master_detail',
  'number', 'currency', 'date', 'datetime',
  'multiselect', 'tags',
] as const;
const FIELDS = TYPES.map((type) => ({ value: `f_${type}`, label: `F ${type}`, type }));

afterEach(cleanup);

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted out of the JSX: the builder re-seeds on a new `value` identity.
  // Cast: a stored row may carry a spelling the row type does not admit.
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', value: '', ...condition }] } as unknown as FilterBuilderRowGroup;
  render(<FilterBuilder fields={FIELDS} value={value} onChange={onChange} />);
  return { onChange };
}

/** Open the row's operator dropdown (combobox 1) and read what it mounts. */
async function openOperatorList(): Promise<{ options: string[]; hint: string | null }> {
  fireEvent.keyDown(screen.getAllByRole('combobox')[1], { key: 'ArrowDown' });
  const options = await waitFor(() => {
    const found = screen.getAllByRole('option');
    expect(found.length).toBeGreaterThan(0);
    return found.map((o) => o.textContent ?? '');
  });
  return { options, hint: screen.queryByTestId('filter-empty-check-hint')?.textContent ?? null };
}

const EMPTY_PAIR = ['Is empty', 'Is not empty'];
const NULL_PAIR = ['Is null', 'Is not null'];

describe('objectui#11810 — the dropdown offers one empty-check pair unless the type distinguishes them', () => {
  it('the per-type table this suite expects is the spec’s own (lit control on each arm)', () => {
    // Read, not restated: if the spec moves a type between arms, this pin says
    // so before the DOM pins below disagree with it for a reason nobody sees.
    expect(expandEmptyOperator({ type: 'select' }).arm).toBe('null_only');
    expect(expandEmptyOperator({ type: 'number' }).arm).toBe('null_only');
    expect(expandEmptyOperator({ type: 'lookup' }).arm).toBe('null_only');
    expect(expandEmptyOperator({ type: 'text' }).arm).toBe('text');
    expect(expandEmptyOperator({ type: 'tags' }).arm).toBe('multi_value');
  });

  for (const type of ['select', 'status', 'lookup', 'user', 'master_detail', 'number', 'currency', 'date', 'datetime'] as const) {
    it(`a ${type} column offers "Is empty" / "Is not empty" and no null pair, with no hint`, async () => {
      renderRow({ field: `f_${type}`, operator: 'equals' });
      const { options, hint } = await openOperatorList();
      expect(options).toEqual(expect.arrayContaining(EMPTY_PAIR));
      for (const label of NULL_PAIR) expect(options).not.toContain(label);
      expect(hint).toBeNull();
    });
  }

  for (const type of ['text', 'textarea', 'email'] as const) {
    it(`a ${type} column offers both pairs and the blank-text hint`, async () => {
      renderRow({ field: `f_${type}`, operator: 'equals' });
      const { options, hint } = await openOperatorList();
      expect(options).toEqual(expect.arrayContaining([...EMPTY_PAIR, ...NULL_PAIR]));
      expect(hint).toBe(TEXT_HINT);
    });
  }

  for (const type of ['multiselect', 'tags'] as const) {
    it(`a ${type} column offers both pairs and the empty-list hint`, async () => {
      renderRow({ field: `f_${type}`, operator: 'equals' });
      const { options, hint } = await openOperatorList();
      expect(options).toEqual(expect.arrayContaining([...EMPTY_PAIR, ...NULL_PAIR]));
      expect(hint).toBe(LIST_HINT);
    });
  }
});

describe('objectui#11810 — a stored null check still loads (controls)', () => {
  it('a stored `is_null` on a select column shows "Is null" and keeps it mounted', async () => {
    renderRow({ field: 'f_select', operator: 'is_null' });
    // The trigger matches against MOUNTED items: an unmounted operator draws
    // blank (objectui#4768 / #7561), which is the regression this guards.
    expect(screen.getAllByRole('combobox')[1].textContent).toBe('Is null');
    const { options, hint } = await openOperatorList();
    expect(options).toContain('Is null');
    // Only the row's own: its partner is still not offered to a fresh choice.
    expect(options).not.toContain('Is not null');
    // Same records as "Is empty" on this column — nothing to explain.
    expect(hint).toBeNull();
  });

  it('a stored camelCase `isNotNull` on a number column loads as "Is not null"', () => {
    // The read boundary folds the deprecated spelling (objectui#9306); the
    // row-own rule must compare the FOLDED id, or this draws blank.
    renderRow({ field: 'f_number', operator: 'isNotNull' });
    expect(screen.getAllByRole('combobox')[1].textContent).toBe('Is not null');
  });

  it('switching a text row on "Is null" to a select column keeps the row’s operator', async () => {
    const { onChange } = renderRow({ field: 'f_text', operator: 'is_null' });
    fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
    const option = await waitFor(() => {
      const found = screen.getAllByRole('option').find((o) => o.textContent === 'F select');
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.click(option);
    const row = onChange.mock.calls[onChange.mock.calls.length - 1][0].conditions[0];
    expect(row).toMatchObject({ field: 'f_select', operator: 'is_null' });
    expect(screen.getAllByRole('combobox')[1].textContent).toBe('Is null');
  });

  it('what a row can HOLD is unchanged: `operatorsForFieldType` still carries both pairs', () => {
    // The author-facing callers read this, not the dropdown: the dataset
    // inspector's read-back (`builderHolds`) keeps a stored `$null` on a
    // select column editable in the visual builder only while it does.
    for (const type of ['select', 'lookup', 'number', 'date', 'text']) {
      const ids = operatorsForFieldType(type).map((op) => op.value);
      expect(ids, type).toEqual(expect.arrayContaining(['is_empty', 'is_not_empty', 'is_null', 'is_not_null']));
    }
  });
});
