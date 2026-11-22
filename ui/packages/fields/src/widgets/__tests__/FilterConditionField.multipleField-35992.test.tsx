/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35992 — the criteria widget hands the shared builder a column's
 * declared `multiple`, so a `select` / `lookup` / `user` declared
 * `multiple: true` is offered what the server's engine answers on it.
 *
 * The evaluator is the engine's `find` (a sharing rule's criteria, a roll-up
 * filter). Measured on a live showcase backend (`SqlDriver`) through
 * `POST /data/:object/query` on a list-valued column: `{ FIELD: value }` and
 * `$in` are refused with 400 `INVALID_FILTER`; `$contains` and an `$or` of
 * `$contains` answer rows. So the offered set is `jsonColumnFilterOperators`'
 * — read here, never restated.
 *
 * Direction: without `multiple` reaching the builder, the three columns keep
 * their type's bucket (`Equals`, `Is any of`, …) and these cases are red; the
 * single-value controls are green either way.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { jsonColumnFilterOperators, operatorsForField } from '@object-ui/components';
import { FilterConditionField } from '../FilterConditionField';

const OBJECT_SCHEMA = {
  name: 'deal',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'owners', label: 'Owners', type: 'user', multiple: true },
    { name: 'accounts', label: 'Accounts', type: 'lookup', reference: 'account', multiple: true },
    { name: 'regions', label: 'Regions', type: 'select', multiple: true, options: [{ value: 'emea', label: 'EMEA' }] },
    { name: 'owner', label: 'Owner', type: 'user' },
    { name: 'region', label: 'Region', type: 'select', options: [{ value: 'emea', label: 'EMEA' }] },
  ],
};

const dataSource = {
  getObjectSchema: async () => OBJECT_SCHEMA,
  find: async () => ({ data: [], total: 0 }),
};

/** The widget under its real contract: a parent that stores what it emits. */
function renderWidget() {
  function Harness() {
    const [value, setValue] = React.useState<string | object>('');
    return (
      <FilterConditionField
        value={value}
        onChange={(next: string | object) => setValue(next)}
        dataSource={dataSource}
        dependentValues={{ object_name: 'deal' }}
        field={{ name: 'criteria_json', type: 'textarea' }}
      />
    );
  }
  render(<Harness />);
}

async function addRow() {
  const add = await screen.findByRole('button', { name: /add filter/i });
  await waitFor(() => expect(add).not.toBeDisabled());
  fireEvent.click(add);
}

/** Open a REAL Radix dropdown by its trigger's index and read its option labels. */
async function optionsOf(index: number): Promise<string[]> {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[index], { key: 'ArrowDown' });
  return waitFor(() => {
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.length).toBeGreaterThan(0);
    return options;
  });
}

async function pickFrom(index: number, label: string) {
  const options = await optionsOf(index);
  expect(options, `no "${label}" in the dropdown`).toContain(label);
  fireEvent.click(screen.getAllByRole('option').find((o) => o.textContent === label)!);
}

/** The operator labels the shared builder draws for these facts — its own answer. */
const labelsFor = (type: string, multiple: boolean) => operatorsForField({ type, multiple }).map((o) => o.label);

describe('criteria rows on a multiple: true column (objectstack#35992)', () => {
  it.each([
    ['Owners', 'user'],
    ['Accounts', 'lookup'],
    ['Regions', 'select'],
  ])('%s (%s, multiple) is offered the JSON-column set only', async (label, type) => {
    renderWidget();
    await addRow();
    await pickFrom(0, label);
    const offered = await optionsOf(1);
    expect(jsonColumnFilterOperators({ type, multiple: true })).toEqual(['contains', 'not_contains', 'is_empty', 'is_not_empty']);
    expect(offered).toEqual(labelsFor(type, true));
    cleanup();
  });

  it.each([
    ['Owner', 'user'],
    ['Region', 'select'],
  ])('%s (%s, single-value control) keeps its equality operators', async (label) => {
    renderWidget();
    await addRow();
    await pickFrom(0, label);
    const offered = await optionsOf(1);
    expect(offered).toContain('Equals');
    expect(offered).not.toEqual(labelsFor('multiselect', false));
    cleanup();
  });
});
