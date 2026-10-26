/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Is empty" / "Is not empty" write the spec's ONE 「is empty」 operator,
 * `$empty` (objectui#10813), and every shape the widget wrote before keeps
 * opening as the same row (objectui#10790).
 *
 * The stored shapes, in order:
 *
 *   - before objectui#10790: `{ FIELD: { $in: [null, ''] } }` /
 *     `{ FIELD: { $nin: [null, ''] } }`. A `null` list member is refused by the
 *     shared comparand-shape face (`assertListComparandShapes`, `INVALID_FILTER`
 *     / 400), so a rule authored with either failed when evaluated;
 *   - objectui#10790 to objectui#10813: `{ $or: [{ FIELD: { $in: [''] } },
 *     { FIELD: { $null: true } }] }` / `{ FIELD: { $nin: [''], $null: false } }`
 *     — "no value OR `''`" on EVERY field type, one of the three meanings of
 *     「is empty」 objectui#10813 converged;
 *   - since objectui#10813: `{ FIELD: { $empty: true } }` / `{ FIELD: { $empty:
 *     false } }`. What counts as empty is the field's DECLARED row of the spec's
 *     per-type table (ruling B on objectstack#20311), expanded by every
 *     evaluator (`expandEmptyOperator`); the widget keeps no copy of it, which
 *     is why the WRITER block pins the SAME token on every column type.
 *
 * What is pinned is the DOCUMENT the widget hands `onChange` — the string a
 * `relatedListFilter`, a roll-up filter or a `criteria_json` ends up holding —
 * judged by the objectstack faces themselves, imported from the installed
 * `@objectstack/spec`: the query face (`assertListComparandShapes`), the save
 * door (`FilterConditionSchema`), and `FILTER_OPERATORS`, the list every
 * executor derives its accepted operators from. The exact bytes are pinned
 * too, so a shape that merely passes the faces but means something else is
 * still red.
 *
 * Four blocks:
 *
 *   1. WRITER — each operator on each field type that offers it (text, number,
 *      date, select, lookup, and multiselect, whose JSON column the SQL driver
 *      refused the old `$in` on), driven through the REAL dropdowns. The
 *      `equals` rows are the control: the same harness and the same faces,
 *      green before and after.
 *   2. READER — the two legacy shapes and the new one each open as the same
 *      single builder row, and opening one emits nothing (no rewrite on read
 *      alone).
 *   3. RE-SAVE — a legacy rule is written as `$empty` the next time any row of
 *      it is edited. That is the stored-rule reading objectui#10813's
 *      changeset names: re-saving moves a rule to the declared-type meaning.
 *   4. GROUPS — the new entry is a FIELD key like every other row, so two
 *      "is empty" rows merge into one AND object instead of the `$and` form the
 *      legacy `$or` entry needed; a legacy group still reads back as its rows.
 *
 * DIRECTION, predicted before running on the base tree (the objectui#10790
 * writer): block 1's operator rows are red (the legacy bytes), the `equals`
 * controls are green; block 2's legacy rows are green and its `$empty` rows red
 * (`kvToCondition` had no `$empty` arm, so the widget fell to raw JSON); block
 * 3 is red; block 4's legacy-group rows are green and its new-shape rows red.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { assertListComparandShapes, FilterConditionSchema, FILTER_OPERATORS } from '@objectstack/spec/data';
import { FilterConditionField } from '../FilterConditionField';

/**
 * One column per field type that is offered the two operators. `name` is first,
 * so it is the column a fresh row is seeded with.
 */
const OBJECT_SCHEMA = {
  name: 'deal',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'amount', label: 'Amount', type: 'number' },
    { name: 'due_on', label: 'Due on', type: 'date' },
    {
      name: 'stage',
      label: 'Stage',
      type: 'select',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won' },
      ],
    },
    { name: 'account', label: 'Account', type: 'lookup', reference: 'account' },
    {
      name: 'tags',
      label: 'Tags',
      type: 'multiselect',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
  ],
};

const dataSource = {
  getObjectSchema: async () => OBJECT_SCHEMA,
  find: async () => ({ data: [], total: 0 }),
};

/** The widget under its real contract: a parent that stores what it emits. */
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
        dependentValues={{ object_name: 'deal' }}
        field={{ name: 'criteria_json', type: 'textarea' }}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, onChange };
}

function lastEmitted(onChange: ReturnType<typeof vi.fn>): string {
  const calls = onChange.mock.calls;
  expect(calls.length, 'the widget never called onChange').toBeGreaterThan(0);
  return String(calls[calls.length - 1][0]);
}

/** Wait for `getObjectSchema` to resolve — the Add button is disabled until it does. */
async function addRow() {
  const add = await screen.findByRole('button', { name: /add filter/i });
  await waitFor(() => expect(add).not.toBeDisabled());
  fireEvent.click(add);
}

/** Drive a REAL Radix dropdown by its trigger's index in the document. */
async function pickFrom(index: number, label: string) {
  const triggers = screen.getAllByRole('combobox');
  expect(triggers.length, 'the builder row is not on screen').toBeGreaterThan(index);
  fireEvent.keyDown(triggers[index], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/**
 * The two objectstack faces this criteria is stored behind, asked about the
 * document itself. The query face answers by throwing; its message is what the
 * failure prints, so a red row quotes the refusal.
 */
function expectAcceptedByTheFaces(stored: string) {
  const criteria = JSON.parse(stored);
  expect(() => assertListComparandShapes(criteria)).not.toThrow();
  const parsed = FilterConditionSchema.safeParse(criteria);
  expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
}

/** The pair as the widget writes it since objectui#10813. */
const isEmpty = (f: string) => ({ [f]: { $empty: true } });
const isNotEmpty = (f: string) => ({ [f]: { $empty: false } });
/** objectui#10790's shapes, written until objectui#10813 — still READ. */
const legacyIsEmpty = (f: string) => ({ $or: [{ [f]: { $in: [''] } }, { [f]: { $null: true } }] });
const legacyIsNotEmpty = (f: string) => ({ [f]: { $nin: [''], $null: false } });

const TYPES: ReadonlyArray<{ type: string; field: string; label: string }> = [
  { type: 'text', field: 'name', label: 'Name' },
  { type: 'number', field: 'amount', label: 'Amount' },
  { type: 'date', field: 'due_on', label: 'Due on' },
  { type: 'select', field: 'stage', label: 'Stage' },
  { type: 'lookup', field: 'account', label: 'Account' },
  { type: 'multiselect', field: 'tags', label: 'Tags' },
];

/** A fresh row on `label`'s column, still on the seed operator (`equals`). */
async function freshRowOn(label: string) {
  const utils = renderWidget('');
  await addRow();
  if (label !== 'Name') await pickFrom(0, label);
  return utils;
}

describe('WRITER — each operator on each offered field type writes `$empty` (objectui#10813)', () => {
  it('the operator it writes is one every executor accepts', () => {
    // `FILTER_OPERATORS` is the list the executors derive acceptance from; the
    // operator joined it in `@objectstack/spec` 17.6.0 (objectstack#20446).
    expect(FILTER_OPERATORS as readonly string[]).toContain('$empty');
  });

  it.each(TYPES)('"Is empty" on a $type column', async ({ field, label }) => {
    const { onChange } = await freshRowOn(label);
    await pickFrom(1, 'Is empty');
    const stored = lastEmitted(onChange);
    // The SAME token on every column type: the per-type meaning is the spec's
    // expansion, not this widget's.
    expect(stored).toBe(JSON.stringify(isEmpty(field)));
    expectAcceptedByTheFaces(stored);
  });

  it.each(TYPES)('"Is not empty" on a $type column', async ({ field, label }) => {
    const { onChange } = await freshRowOn(label);
    await pickFrom(1, 'Is not empty');
    const stored = lastEmitted(onChange);
    expect(stored).toBe(JSON.stringify(isNotEmpty(field)));
    expectAcceptedByTheFaces(stored);
  });

  it.each(TYPES)('CONTROL: the seed "equals" row on a $type column is untouched', async ({ field, label }) => {
    // Green before and after: the same harness and the same faces answer
    // "accepted" for an arm this change does not touch, so a red operator row
    // above is about the operator and not about the harness.
    const { onChange } = await freshRowOn(label);
    const stored = lastEmitted(onChange);
    expect(stored).toBe(JSON.stringify({ [field]: '' }));
    expectAcceptedByTheFaces(stored);
  });
});

/** The single row the widget drew for a stored criteria, read off the DOM. */
async function expectOneRow(fieldLabel: string, operatorLabel: string) {
  await waitFor(() => {
    const triggers = screen.getAllByRole('combobox');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toHaveTextContent(fieldLabel);
    expect(triggers[1]).toHaveTextContent(operatorLabel);
  });
  // Not the raw-JSON fallback the widget drops into for a criteria it cannot draw.
  expect(screen.queryByPlaceholderText(/"type": "customer"/)).toBeNull();
}

describe('READER — every shape the pair was ever stored in opens as the same builder row (objectui#10790, objectui#10813)', () => {
  const CASES: ReadonlyArray<{ name: string; stored: unknown; operator: string }> = [
    { name: 'pre-objectui#10790 "is empty" ($in: [null, \'\'])', stored: { name: { $in: [null, ''] } }, operator: 'Is empty' },
    { name: 'pre-objectui#10790 "is not empty" ($nin: [null, \'\'])', stored: { name: { $nin: [null, ''] } }, operator: 'Is not empty' },
    { name: 'objectui#10790 "is empty" ($or)', stored: legacyIsEmpty('name'), operator: 'Is empty' },
    { name: 'objectui#10790 "is not empty" ($nin + $null)', stored: legacyIsNotEmpty('name'), operator: 'Is not empty' },
    { name: '"is empty" ($empty: true)', stored: isEmpty('name'), operator: 'Is empty' },
    { name: '"is not empty" ($empty: false)', stored: isNotEmpty('name'), operator: 'Is not empty' },
  ];

  it.each(CASES)('$name opens as one "$operator" row and is not rewritten', async ({ stored, operator }) => {
    const { onChange } = renderWidget(JSON.stringify(stored));
    await expectOneRow('Name', operator);
    // No rewrite on read alone: opening a stored rule emits nothing, so the
    // form keeps the bytes it loaded until the admin edits the criteria.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RE-SAVE — a legacy rule is written as `$empty` once it is edited (objectui#10813)', () => {
  it.each([
    { name: 'pre-objectui#10790 "is empty"', old: { name: { $in: [null, ''] } }, fresh: isEmpty('name') },
    { name: 'pre-objectui#10790 "is not empty"', old: { name: { $nin: [null, ''] } }, fresh: isNotEmpty('name') },
    { name: 'objectui#10790 "is empty"', old: legacyIsEmpty('name'), fresh: isEmpty('name') },
    { name: 'objectui#10790 "is not empty"', old: legacyIsNotEmpty('name'), fresh: isNotEmpty('name') },
  ])('a $name row is rewritten when ANOTHER row is edited', async ({ old, fresh }) => {
    const { onChange } = renderWidget(JSON.stringify({ ...old, amount: 5 }));
    const box = await screen.findByDisplayValue('5');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '6' } });
    const stored = lastEmitted(onChange);
    expect(stored).toBe(JSON.stringify({ ...fresh, amount: 6 }));
    expectAcceptedByTheFaces(stored);
  });
});

describe('GROUPS — the "is empty" row round-trips inside a group (objectui#10813)', () => {
  it('beside a field key (AND, merged): written, accepted, and read back as the two rows', async () => {
    const { onChange } = await freshRowOn('Name');
    await pickFrom(1, 'Is empty');
    await addRow();
    await pickFrom(2, 'Amount');
    const stored = lastEmitted(onChange);
    expect(stored).toBe(JSON.stringify({ ...isEmpty('name'), amount: '' }));
    expectAcceptedByTheFaces(stored);

    // What it wrote reopens as the rows it was written from.
    const triggers = screen.getAllByRole('combobox');
    expect(triggers.map((t) => t.textContent)).toEqual(['Name', 'Is empty', 'Amount', 'Equals']);
  });

  it('two "is empty" rows are two field keys of one AND object — no `$and` form needed', async () => {
    const { onChange } = await freshRowOn('Name');
    await pickFrom(1, 'Is empty');
    await addRow();
    await pickFrom(2, 'Amount');
    await pickFrom(3, 'Is empty');
    const stored = lastEmitted(onChange);
    expect(stored).toBe(JSON.stringify({ ...isEmpty('name'), ...isEmpty('amount') }));
    expectAcceptedByTheFaces(stored);
    expect(screen.getAllByRole('combobox').map((t) => t.textContent)).toEqual([
      'Name', 'Is empty', 'Amount', 'Is empty',
    ]);
  });

  it('a legacy pair of "is empty" entries (the `$and` form) still reads back as two rows', async () => {
    const stored = { $and: [legacyIsEmpty('name'), legacyIsEmpty('amount')] };
    expectAcceptedByTheFaces(JSON.stringify(stored));
    const { onChange } = renderWidget(JSON.stringify(stored));
    await waitFor(() => {
      const triggers = screen.getAllByRole('combobox');
      expect(triggers.map((t) => t.textContent)).toEqual(['Name', 'Is empty', 'Amount', 'Is empty']);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('inside an OR group: read back as an OR group of the two rows, and re-written unchanged', async () => {
    const stored = { $or: [{ amount: 5 }, isEmpty('name')] };
    expectAcceptedByTheFaces(JSON.stringify(stored));
    const { onChange } = renderWidget(JSON.stringify(stored));
    const box = await screen.findByDisplayValue('5');
    expect(screen.getAllByRole('combobox').map((t) => t.textContent)).toEqual([
      'Amount', 'Equals', 'Name', 'Is empty',
    ]);
    fireEvent.change(box, { target: { value: '6' } });
    expect(lastEmitted(onChange)).toBe(JSON.stringify({ $or: [{ amount: 6 }, isEmpty('name')] }));
  });

  it('a legacy entry inside an OR group is re-written as `$empty` once the group is edited', async () => {
    const stored = { $or: [{ amount: 5 }, legacyIsEmpty('name')] };
    const { onChange } = renderWidget(JSON.stringify(stored));
    const box = await screen.findByDisplayValue('5');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '6' } });
    expect(lastEmitted(onChange)).toBe(JSON.stringify({ $or: [{ amount: 6 }, isEmpty('name')] }));
  });

  it('CONTROL: an OR of the two legacy halves in the OTHER order stays the OR group it is', async () => {
    // Only the exact entry the builder wrote is folded into one row; the same
    // predicate spelled another way is not guessed at.
    // A select column, whose bucket offers both `is_null` and `in`.
    const stored = { $or: [{ stage: { $null: true } }, { stage: { $in: [''] } }] };
    renderWidget(JSON.stringify(stored));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox').slice(0, 4).map((t) => t.textContent)).toEqual([
        'Stage', 'Is null', 'Stage', 'In',
      ]);
    });
  });

  it('CONTROL: a non-boolean `$empty` flag is not opened as a row — the raw criteria stays as written', async () => {
    // Every evaluator refuses it (`$empty` is declared `z.boolean()`); opening
    // it as an "Is empty" row would let the next save turn it into a runnable
    // predicate the author never wrote.
    const stored = { name: { $empty: 'yes' } };
    const { onChange } = renderWidget(JSON.stringify(stored));
    // The raw-JSON editor, holding the stored bytes — the widget's fallback for
    // a criteria it cannot draw.
    const raw = await screen.findByPlaceholderText(/"type": "customer"/);
    expect(raw).toHaveValue(JSON.stringify(stored));
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
