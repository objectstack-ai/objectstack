/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #26348 — a lookup chip hands `LookupValuePicker` the list the filter builder
 * edits: strings and numbers, the spec `ViewFilterRule` list's own entries.
 *
 * The bar's selection map is typed for every control kind at once, so its
 * entries may be booleans (a boolean chip's selection is `[true]`). The one door
 * a boolean has into a LOOKUP chip's selection is an authored `defaultValues`
 * entry, whose spec type is shared by every control kind. The chip used to hand
 * that list to the picker as it stood, so a picked id was appended beside a
 * boolean and the query carried `[true, id]`. It is now handed over in its
 * string spelling, the entry the builder writes for a boolean carried into a
 * list, so the chip still draws it and the user can remove it.
 *
 * No `SchemaRendererProvider` here on purpose: without a DataSource the picker
 * draws its by-hand id input, which is enough to read what it was handed and
 * to drive what it hands back.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { UserFilters } from '../UserFilters';

afterEach(cleanup);

function renderLookupChip(defaultValues: (string | number | boolean)[]) {
  const onFilterChange = vi.fn();
  render(
    <UserFilters
      config={{ element: 'dropdown', fields: [{ field: 'account_id', defaultValues }] }}
      objectDef={{ name: 'crm_contact', fields: { account_id: { type: 'lookup', reference: 'crm_account' } } }}
      data={[]}
      onFilterChange={onFilterChange}
    />,
  );
  fireEvent.click(screen.getByTestId('filter-badge-account_id'));
  // Non-vacuity: the lookup picker's by-hand id list is what rendered.
  expect(screen.getByTestId('filter-lookup-account_id')).toBeTruthy();
  return { onFilterChange, ids: screen.getByTestId('lookup-ids-account_id') };
}

/** The `in` values the most recent `onFilterChange` carried for the chip. */
function lastValues(onFilterChange: ReturnType<typeof vi.fn>): unknown[] {
  const conditions = onFilterChange.mock.calls.at(-1)?.[0] as Array<[string, string, unknown[]]>;
  const condition = conditions.find(([field]) => field === 'account_id');
  expect(condition, 'no condition for the lookup chip').toBeTruthy();
  expect(condition![1]).toBe('in');
  return condition![2];
}

describe('#26348 — the lookup chip hands the picker spec list entries', () => {
  it('a picked id joins an authored boolean default in its string spelling', () => {
    const { onFilterChange, ids } = renderLookupChip([true]);
    // Drawn, so the user can see and remove it.
    expect(within(ids).getByText('true')).toBeTruthy();
    const input = within(ids).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'acc_1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastValues(onFilterChange)).toEqual(['true', 'acc_1']);
  });

  it('ids that are already strings and numbers pass through untouched', () => {
    const { onFilterChange, ids } = renderLookupChip(['acc_1', 7]);
    const input = within(ids).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'acc_2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastValues(onFilterChange)).toEqual(['acc_1', 7, 'acc_2']);
  });
});
