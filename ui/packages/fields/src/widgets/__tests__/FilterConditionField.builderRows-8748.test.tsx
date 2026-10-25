/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The builder ROW survives an operator switch (objectui#8748).
 *
 * `condToMongo` drops a text-operator row whose value box is still empty — that
 * is the producer half of objectui#8748, and it is what keeps a half-built row
 * from authoring the shape `ValueDataSource` now refuses. But this widget is a
 * CONTROLLED ROUND-TRIP: it emits `filterGroupToMongo(rows)` and used to read
 * its rows straight back out of the value it had just emitted, while
 * `FilterBuilder` re-seeds its internal rows whenever the incoming `value`
 * differs from them (`filter-builder.tsx`). Dropping at `condToMongo` therefore
 * DELETED THE ROW FROM THE SCREEN: switching a row to any of `contains` /
 * `containsCaseInsensitive` / `notContains` / `startsWith` / `endsWith` (the
 * builder's ids when this was written; `contains` / `icontains` /
 * `not_contains` / `starts_with` / `ends_with` since objectui#9306, and the
 * case-insensitive one is no longer opt-in) emitted no fragment, the criteria
 * went back to empty, and the row vanished before a comparand could be typed.
 * Those five operators were unreachable through this UI except by typing the
 * value under `equals` first.
 *
 * No unit test could see it: `condToMongo` is a pure function and answers
 * correctly in isolation. It takes a RENDER-level round-trip — a controlled
 * parent that stores what the widget emits and hands it back, which is what
 * `renderWidget` below is.
 *
 * DIRECTION, predicted before running: the first `describe` is RED without the
 * local row state (the row is gone, so there is no operator trigger to read and
 * no value box to type into) and green with it. The second and third are green
 * in BOTH directions on purpose — they are the guards that stop the fix from
 * over-reaching: a widget that simply IGNORED its incoming value would pass the
 * first block and fail these two.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterConditionField } from '../FilterConditionField';

/** One text column, so the seeded row is `name` and the value box is an Input. */
const OBJECT_SCHEMA = {
  name: 'account',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'city', label: 'City', type: 'text' },
  ],
};

const dataSource = {
  getObjectSchema: async () => OBJECT_SCHEMA,
};

/**
 * The widget under its real contract: a parent that STORES what the widget
 * emits and hands it back as `value`. The bug only exists in this loop — feed
 * the widget a constant `value` and the row survives for the wrong reason.
 */
function renderWidget(initial: string | object = '') {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = React.useState<string | object>(initial);
    return (
      <FilterConditionField
        value={value}
        onChange={(next: string | object) => {
          onChange(next);
          setValue(next);
        }}
        dataSource={dataSource}
        dependentValues={{ object_name: 'account' }}
        field={{ name: 'criteria_json', type: 'textarea' }}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, onChange };
}

/** What the widget emitted most recently — the STORED criteria, as a string. */
function lastEmitted(onChange: ReturnType<typeof vi.fn>): unknown {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the widget never called onChange').toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

/** Wait for `getObjectSchema` to resolve — the Add button is disabled until it does. */
async function addRow() {
  const add = await screen.findByRole('button', { name: /add filter/i });
  await waitFor(() => expect(add).not.toBeDisabled());
  fireEvent.click(add);
}

/**
 * Drive the REAL operator dropdown. The row's Radix comboboxes are in
 * field / operator order, so index 1 is the operator.
 */
async function pickOperator(label: string) {
  const triggers = screen.getAllByRole('combobox');
  expect(triggers.length, 'the builder row is not on screen').toBeGreaterThan(1);
  fireEvent.keyDown(triggers[1], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the operator dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

describe('a text-operator row survives losing its emitted fragment', () => {
  it('keeps the row on screen, emits nothing, and authors $icontains once typed', async () => {
    const { onChange } = renderWidget('');
    await addRow();

    // The seed row is `name equals ''`, which still round-trips.
    expect(lastEmitted(onChange)).toBe('{"name":""}');

    await pickOperator('Contains (ignore case)');

    // THE REGRESSION: the row used to be gone by now.
    const triggers = screen.getAllByRole('combobox');
    expect(triggers).toHaveLength(2);
    expect(triggers[1]).toHaveTextContent('Contains (ignore case)');
    const valueBox = screen.getByPlaceholderText('Value');
    expect(valueBox).toBeInTheDocument();

    // ...and the producer half still holds: an empty comparand authors NO
    // criteria, rather than the `{ name: { $icontains: '' } }` the matcher
    // refuses.
    expect(lastEmitted(onChange)).toBe('');

    fireEvent.change(valueBox, { target: { value: 'acme' } });

    expect(lastEmitted(onChange)).toBe('{"name":{"$icontains":"acme"}}');
  });

  it('drops the fragment again when the comparand is cleared back out', async () => {
    const { onChange } = renderWidget('');
    await addRow();
    await pickOperator('Contains (ignore case)');
    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: 'acme' } });
    expect(lastEmitted(onChange)).toBe('{"name":{"$icontains":"acme"}}');

    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: '' } });

    expect(lastEmitted(onChange)).toBe('');
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByPlaceholderText('Value')).toHaveValue('');
  });
});

describe('a stored criteria still seeds the rows', () => {
  it('loads `{ name: { $icontains: "x" } }` into a row and emits nothing on its own', async () => {
    const { onChange } = renderWidget('{"name":{"$icontains":"x"}}');

    const triggers = await screen.findAllByRole('combobox');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toHaveTextContent('Name');
    expect(triggers[1]).toHaveTextContent('Contains (ignore case)');
    expect(screen.getByPlaceholderText('Value')).toHaveValue('x');

    // Seeding is not an edit: a widget that re-emitted on mount would rewrite
    // stored criteria nobody touched.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('an OUTSIDE change to the criteria re-seeds the rows', () => {
  it('replaces the rows when the stored value changes under the widget', async () => {
    function Harness() {
      const [value, setValue] = React.useState<string | object>('{"name":{"$icontains":"x"}}');
      return (
        <>
          <button type="button" onClick={() => setValue('{"city":"Paris"}')}>
            load other record
          </button>
          <FilterConditionField
            value={value}
            onChange={(next: string | object) => setValue(next)}
            dataSource={dataSource}
            dependentValues={{ object_name: 'account' }}
            field={{ name: 'criteria_json', type: 'textarea' }}
          />
        </>
      );
    }
    render(<Harness />);

    await waitFor(() =>
      expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('Contains (ignore case)'),
    );

    fireEvent.click(screen.getByRole('button', { name: /load other record/i }));

    await waitFor(() => {
      const triggers = screen.getAllByRole('combobox');
      expect(triggers[0]).toHaveTextContent('City');
      expect(triggers[1]).toHaveTextContent('Equals');
    });
    expect(screen.getByPlaceholderText('Value')).toHaveValue('Paris');
  });
});
