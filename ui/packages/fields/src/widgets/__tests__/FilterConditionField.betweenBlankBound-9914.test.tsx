/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `between` row reaches stored criteria only once BOTH bounds are filled in
 * (objectui#9914).
 *
 * What is pinned here is the DOCUMENT that comes out — the string this widget
 * hands `onChange`, which is what a `sys_sharing_rule.criteria_json` ends up
 * holding — and not the builder's internal row state. The defect was that a
 * half-filled range emitted `{"age":{"$gte":1,"$lte":""}}`: `coerceByType`
 * returns `''` unchanged (its `value !== ''` conjunct), so the blank box
 * travelled through `handleBuilderChange` → `filterGroupToMongo` →
 * `onChange(JSON.stringify(mongo))` into storage. The existing operator pin
 * exercises `between` with a COMPLETE pair only, so the half-filled case had
 * never been driven.
 *
 * BOTH directions are pinned, because a drop that over-reaches is the same
 * class of defect as the emission it replaces: a complete range must still
 * author exactly the range it did before, and `0` must still count as a bound.
 *
 * Two reachable paths, and they are not the same path:
 *
 *   - the DROPDOWN path — only the date-like bucket offers `between`
 *     (`operatorsForFieldType` in `@object-ui/components`), so a fresh row
 *     reaches this arm on a date column;
 *   - the STORED-CRITERIA path — `kvToCondition` reads any two-key
 *     `{ $gte, $lte }` back as a `between` row whatever the column's type, so a
 *     criteria written in the raw-JSON editor (or by any other producer) puts a
 *     number range on screen with two editable bounds.
 *
 * DIRECTION, predicted before running: every assertion below that names the
 * empty string is RED without the guard in `condToMongo`'s `between` arm — the
 * first block additionally because picking `Between` emitted `{"signed_on":{}}`,
 * which `kvToCondition` cannot read back, so the widget forced itself into
 * raw-JSON mode and there was no "From" box to type into at all.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterConditionField, condToMongo, kvToCondition } from '../FilterConditionField';

/** A number column and a date column: only the latter offers `between`. */
const OBJECT_SCHEMA = {
  name: 'account',
  fields: [
    { name: 'age', label: 'Age', type: 'number' },
    { name: 'signed_on', label: 'Signed on', type: 'date' },
  ],
};

const dataSource = { getObjectSchema: async () => OBJECT_SCHEMA };

/**
 * The widget under its real contract: a parent that STORES what the widget
 * emits and hands it back as `value`. A constant `value` would hide the
 * round-trip this arm lives in.
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

/** Every criteria this widget has emitted so far, in order. */
function allEmitted(onChange: ReturnType<typeof vi.fn>): string[] {
  return onChange.mock.calls.map((c) => String(c[0]));
}

async function addRow() {
  const add = await screen.findByRole('button', { name: /add filter/i });
  await waitFor(() => expect(add).not.toBeDisabled());
  fireEvent.click(add);
}

/** Drive a REAL Radix dropdown: index 0 is the field, index 1 the operator. */
async function pickFrom(index: 0 | 1, label: string) {
  const triggers = screen.getAllByRole('combobox');
  expect(triggers.length, 'the builder row is not on screen').toBeGreaterThan(1);
  fireEvent.keyDown(triggers[index], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

describe('the dropdown path: a date range authors nothing until both bounds are filled', () => {
  it('emits nothing on pick and on one bound, then exactly the range', async () => {
    const { onChange } = renderWidget('');
    await addRow();
    await pickFrom(0, 'Signed on');
    await pickFrom(1, 'Between');

    // Picking the operator must not author a criteria of its own. The row is
    // still on screen and still in the VISUAL builder — the vacuous
    // `{"signed_on":{}}` this used to emit is unrepresentable, and reading it
    // back dropped the widget into the raw-JSON editor with the toggle
    // disabled.
    expect(lastEmitted(onChange)).toBe('');
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');

    fireEvent.change(from, { target: { value: '2024-01-01' } });
    expect(lastEmitted(onChange)).toBe('');
    // The row survives its own dropped fragment (objectui#8748's guarantee),
    // and the bound the admin typed is still in the box.
    expect(screen.getByLabelText('From')).toHaveValue('2024-01-01');

    fireEvent.change(to, { target: { value: '2024-03-01' } });
    expect(lastEmitted(onChange)).toBe(
      '{"signed_on":{"$gte":"2024-01-01","$lte":"2024-03-01"}}',
    );

    // ...and clearing a bound back out withdraws the criteria rather than
    // storing a half-range.
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } });
    expect(lastEmitted(onChange)).toBe('');

    // THE DEFECT, over the whole interaction: no document this widget emitted
    // ever carried a blank bound or a vacuous field object.
    for (const emitted of allEmitted(onChange)) {
      expect(emitted, 'a criteria carrying a blank bound reached storage').not.toMatch(
        /"\$(gte|lte)":""/,
      );
      expect(emitted, 'a vacuous field predicate reached storage').not.toMatch(
        /"signed_on":\{\}/,
      );
    }
  });
});

describe('the stored-criteria path: clearing a bound of a saved range', () => {
  it('withdraws the criteria instead of storing a blank bound', async () => {
    const { onChange } = renderWidget('{"age":{"$gte":1,"$lte":5}}');

    // A saved number range loads as a `between` row with two editable bounds,
    // even though the number bucket does not offer `between` in its dropdown.
    const to = await screen.findByLabelText('To');
    expect(to).toHaveValue(5);
    // Seeding is not an edit.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(to, { target: { value: '' } });

    expect(lastEmitted(onChange)).toBe('');
    expect(lastEmitted(onChange)).not.toBe('{"age":{"$gte":1,"$lte":""}}');

    // Re-typing an upper bound authors the range again, against the lower
    // bound the saved rule carried.
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '9' } });
    expect(lastEmitted(onChange)).toBe('{"age":{"$gte":1,"$lte":9}}');
  });
});

describe('a criteria already stored with a blank bound', () => {
  it('still loads into the builder and is not rewritten on mount', async () => {
    // The migration promise: this change moves what the widget WRITES, never
    // what is already saved. A rule stored before it keeps its fragment, shows
    // the bound it has, and is rewritten only when the admin edits it.
    const { onChange } = renderWidget('{"age":{"$gte":1,"$lte":""}}');

    const to = await screen.findByLabelText('To');
    expect(screen.getByLabelText('From')).toHaveValue(1);
    expect(to).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(to, { target: { value: '5' } });
    expect(lastEmitted(onChange)).toBe('{"age":{"$gte":1,"$lte":5}}');
  });
});

describe('condToMongo: the `between` arm, both directions', () => {
  const numTypes = () => 'number';
  const noTypes = () => undefined;
  const row = (value: unknown) =>
    condToMongo({ id: 'c', field: 'age', operator: 'between', value } as any, numTypes);

  it.each([
    ['lower bound only', [1, '']],
    ['upper bound only', ['', 5]],
    ['both bounds blank', ['', '']],
    ['the cleared shape the builder writes', []],
    ['a scalar left over from another operator', 'x'],
    ['nothing at all', undefined],
    ['a bound explicitly nulled', [1, null]],
  ])('drops a range with %s', (_label, value) => {
    expect(row(value)).toBeNull();
  });

  it('still emits a complete range unchanged', () => {
    expect(row([1, 5])).toEqual({ age: { $gte: 1, $lte: 5 } });
    expect(
      condToMongo(
        { id: 'c', field: 'signed_on', operator: 'between', value: ['2024-01-01', '2024-03-01'] } as any,
        noTypes,
      ),
    ).toEqual({ signed_on: { $gte: '2024-01-01', $lte: '2024-03-01' } });
  });

  it('counts `0` and `false` as real bounds, never as unfilled', () => {
    // `0` is a bound a number column can genuinely carry; a `!bound` reading
    // would drop a filter the admin can see on screen (objectui#4873).
    expect(row([0, 5])).toEqual({ age: { $gte: 0, $lte: 5 } });
    expect(row([0, 0])).toEqual({ age: { $gte: 0, $lte: 0 } });
    // `false` likewise — read through an UNTYPED field, since `coerceByType`
    // legitimately folds a boolean to a number on a number column.
    expect(
      condToMongo({ id: 'c', field: 'flag', operator: 'between', value: [false, true] } as any, noTypes),
    ).toEqual({ flag: { $gte: false, $lte: true } });
  });

  it('leaves every other operator alone — `equals ""` is still a real predicate', () => {
    expect(condToMongo({ id: 'c', field: 'name', operator: 'equals', value: '' } as any, noTypes))
      .toEqual({ name: '' });
    expect(condToMongo({ id: 'c', field: 'age', operator: 'greater_than_or_equal', value: '' } as any, noTypes))
      .toEqual({ age: { $gte: '' } });
  });

  it('round-trips the range it does emit', () => {
    const frag = row([1, 5])!;
    expect(kvToCondition('age', frag.age, 0)).toEqual({
      id: 'c_0_age',
      field: 'age',
      operator: 'between',
      value: [1, 5],
    });
  });
});
