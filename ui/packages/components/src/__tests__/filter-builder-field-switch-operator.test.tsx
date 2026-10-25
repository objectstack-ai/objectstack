/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Changing a row's FIELD must leave the row's operator inside the new field's
 * bucket (objectui#4768).
 *
 * The buckets are per field type and they do not nest: `select` offers
 * `in` / `notIn`, `text` does not, `date` offers `between` and nobody else
 * does. Changing the field used to write `{ field }` alone, so a row built on a
 * `select` column with `in` kept `in` after being pointed at a `text` column —
 * an operator that column's dropdown does not list. Radix's `SelectValue`
 * matches against the `SelectItem`s actually mounted, so the trigger rendered
 * BLANK while the row went on filtering by an operator the user could neither
 * see nor reach.
 *
 * This is the field-side half of the family objectui#3958 / PR #4762 opened on
 * the operator side: there, changing the operator had to re-shape the value;
 * here, changing the field has to settle the operator AND then the value, for
 * the same reason — a row's field, operator and value shape are one edit.
 *
 * DIRECTION, predicted before running: every pin in the first three `describe`
 * blocks is RED on `origin/main` (the field switch keeps the stale operator
 * there) and green after. The two exceptions are stated where they sit:
 * "leaves an operator the new bucket still offers alone" is green in BOTH
 * directions — it is the guard that stops the fix from over-reaching into
 * discarding valid user choices, and a fix that reset unconditionally would
 * turn it red. The `describe` on the canonical fold is likewise green in both
 * directions on `main`: `reconcileOperatorForField` does not exist there, so
 * those cases do not compile rather than fail — they are pins on the NEW
 * helper's contract, not on the old behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { normalizeFilterOperator } from '@objectstack/spec/ui';
import {
  FilterBuilder,
  FILTER_BUILDER_OPERATORS,
  operatorsForFieldType,
  reconcileOperatorForField,
} from '../custom/filter-builder';

/**
 * One column per bucket this builder draws, plus a SECOND text column: the
 * within-one-bucket switch is the case that must NOT reset, and it needs two
 * fields of the same type to be expressible at all.
 */
const FIELDS = [
  { value: 'stage', label: 'Stage', type: 'select' },
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'owner_note', label: 'Owner note', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'closed_at', label: 'Closed at', type: 'date' },
  { value: 'is_won', label: 'Won', type: 'boolean' },
];

/** The operator ids the dropdown offers for a field of `type`, ungranted. */
function offeredFor(type: string): string[] {
  return operatorsForFieldType(type).map((op) => op.value);
}

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted OUT of the JSX for the same reason PR #4762's suite hoists it:
  // `FilterBuilder`'s sync effect re-seeds its internal state whenever the
  // `value` PROP's identity changes, so an inline literal would undo the
  // interaction under test on the next render.
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
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
 * Drive a REAL dropdown. The row's controls are Radix comboboxes in
 * field / operator / value order, so index 0 is the field and 1 the operator.
 */
async function pick(triggerIndex: 0 | 1, label: string) {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[triggerIndex], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/** What the operator trigger DISPLAYS — blank is the symptom this card is about. */
function operatorTriggerText() {
  return screen.getAllByRole('combobox')[1].textContent;
}

describe('switching the field settles the operator into the new bucket', () => {
  it('resets `in` when the new column has no set operator, and shows a label again', async () => {
    // The exact row from the report: a `select` column filtered with `in`,
    // pointed at a `text` column whose bucket has no `in` at all.
    const { onChange } = renderRow({ field: 'stage', operator: 'in', value: ['won', 'lost'] });
    await pick(0, 'Title');

    const row = lastRow(onChange);
    expect(row.field).toBe('title');
    expect(row.operator).toBe('equals');
    expect(offeredFor('text')).toContain(row.operator);
    // The visible symptom, pinned directly: the trigger showed nothing at all
    // because `in` was not among the items the text bucket mounts.
    expect(operatorTriggerText()).toBe('Equals');
  });

  it('resets `between` when the new column is not a date one', async () => {
    const { onChange } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', '2024-12-31'],
    });
    await pick(0, 'Title');

    const row = lastRow(onChange);
    expect(row.operator).toBe('equals');
    expect(offeredFor('text')).toContain(row.operator);
  });

  it('resets a text-only operator when the new column is numeric', async () => {
    // The reverse direction of the same fact: `contains` is a text operator and
    // the number bucket does not carry it.
    const { onChange } = renderRow({ field: 'title', operator: 'contains', value: 'ac' });
    await pick(0, 'Amount');

    const row = lastRow(onChange);
    expect(row.field).toBe('amount');
    expect(row.operator).toBe('equals');
    expect(offeredFor('number')).toContain(row.operator);
  });

  it('resets down to the two operators a boolean column offers', async () => {
    // The narrowest bucket in the builder — `["equals", "not_equals"]` — so it
    // is the one most switches land outside of.
    const { onChange } = renderRow({ field: 'title', operator: 'starts_with', value: 'ac' });
    await pick(0, 'Won');

    expect(lastRow(onChange).operator).toBe('equals');
    expect(offeredFor('boolean')).toContain(lastRow(onChange).operator);
  });

  it('the reset operator is the new bucket’s FIRST entry, not a hard-coded id', () => {
    // `equals` is what every bucket happens to start with today. The rule is
    // "the first offered entry", and it is asserted as such so that reordering
    // a bucket moves the fallback with it instead of silently disagreeing.
    for (const type of ['text', 'number', 'date', 'select', 'lookup', 'boolean']) {
      const offered = operatorsForFieldType(type);
      expect(reconcileOperatorForField('nonexistentOperator', offered)).toBe(offered[0].value);
    }
  });
});

describe('the value is re-shaped for the family the operator lands in', () => {
  it('a list value collapses to its first entry when the operator becomes scalar', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'in', value: ['won', 'lost'] });
    await pick(0, 'Title');

    const row = lastRow(onChange);
    // `equals` compares against ONE value; carrying the array through would
    // leave the row in the very shape `ViewFilterRuleSchema` refuses, which is
    // the defect PR #4762 closed on the operator side.
    expect(row.value).toBe('won');
  });

  it('an untouched list row becomes the empty scalar, not `[]`', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'in', value: [] });
    await pick(0, 'Title');

    expect(lastRow(onChange)).toMatchObject({ operator: 'equals', value: '' });
  });

  it('a range keeps its lower bound when the operator becomes scalar', async () => {
    const { onChange } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', '2024-12-31'],
    });
    // Retargeted from `Amount` to `Title` by objectui#4781: the fact under test
    // is the pair → scalar collapse, and a text column forces the same operator
    // reset (its bucket has no `between`) while being able to HOLD the date
    // string the collapse produces. On a number column the collapse still
    // happens and #4781 then clears `"2024-01-01"`, which would have hidden
    // this pin behind a value judgement that is not what it is here to state.
    await pick(0, 'Title');

    expect(lastRow(onChange).value).toBe('2024-01-01');
  });

  it('a scalar the new column can hold is carried through — only the SHAPE is settled', async () => {
    // The reset answers the operator's family, and scalar-to-scalar has no
    // shape question to answer. What the user typed is theirs; a field switch
    // is not a licence to discard it.
    //
    // This case used to point at `Amount` and assert that `"acme"` survived
    // onto a NUMBER column. That is the defect objectui#4781 reported — the
    // number input renders `"acme"` blank while the row keeps filtering by it —
    // and the maintainer ruled the value must clear there. The pin's own
    // subject (the shape reset does not blank a value) is unchanged, so it is
    // asserted on a target that can still hold the value; the number target now
    // has its own, opposite pin in
    // `filter-builder-field-switch-value.test.tsx`.
    const { onChange } = renderRow({ field: 'title', operator: 'contains', value: 'acme' });
    await pick(0, 'Stage');

    expect(lastRow(onChange)).toMatchObject({ operator: 'equals', value: 'acme' });
  });
});

describe('an operator the new bucket still offers is LEFT ALONE', () => {
  // Green in both directions by design: `main` does not reset at all, so it
  // passes there too. It is the guard on the fix's blast radius — a fix that
  // reset the operator on every field change would turn all three red.
  it('keeps `contains` across two text columns, value and all', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'contains', value: 'acme' });
    await pick(0, 'Owner note');

    expect(lastRow(onChange)).toMatchObject({
      field: 'owner_note',
      operator: 'contains',
      value: 'acme',
    });
    expect(operatorTriggerText()).toBe('Contains');
  });

  it('keeps `in` and its list across select → lookup-shaped buckets', () => {
    // Driven through the pure helper rather than the dropdown: both buckets
    // offer `in`, so the operator survives and the value must not be re-shaped.
    expect(reconcileOperatorForField('in', operatorsForFieldType('lookup'))).toBe('in');
    expect(reconcileOperatorForField('in', operatorsForFieldType('select'))).toBe('in');
  });

  it('keeps a value-less operator both buckets carry', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'is_null', value: '' });
    await pick(0, 'Amount');

    expect(lastRow(onChange)).toMatchObject({ field: 'amount', operator: 'is_null' });
  });
});

describe('membership is decided through the spec’s canonical fold', () => {
  it('recognises a deprecated alias of an operator the bucket lists canonically', () => {
    // The dropdown lists the protocol id `not_in` (objectui#9306); a caller of
    // this exported helper may still hold the deprecated alias `notIn`, which
    // was the dropdown's own id before that change. They are ONE operator, so a
    // select → lookup switch must not reset the row to `equals` merely
    // because the two spellings differ — and the helper keeps the row's own
    // spelling, because a field switch is not a spelling migration (the
    // builder's READ boundary is where a spelling is migrated).
    expect(normalizeFilterOperator('notIn')).toBe('not_in');
    expect(offeredFor('lookup')).toContain('not_in');
    expect(offeredFor('lookup')).not.toContain('notIn');
    expect(reconcileOperatorForField('notIn', operatorsForFieldType('lookup'))).toBe('notIn');
  });

  it('still resets a canonical spelling the new bucket cannot express', () => {
    // The other half: `not_in` is canonically absent from the text bucket, so
    // the fold must not turn "compare canonically" into "accept anything".
    expect(reconcileOperatorForField('not_in', operatorsForFieldType('text'))).toBe('equals');
  });

  it('the fold is INJECTIVE over this builder’s vocabulary', () => {
    // What makes comparing through `normalizeFilterOperator` safe: if two
    // OFFERED ids collapsed onto one canonical operator, the check could keep
    // an operator the bucket does not actually list. They do not collapse, and
    // this pin fails the day an added operator would make them.
    const canonical = FILTER_BUILDER_OPERATORS.map((id) => normalizeFilterOperator(id));
    expect(new Set(canonical).size).toBe(FILTER_BUILDER_OPERATORS.length);
  });
});

describe('the invariant, over every field-type pair the builder can draw', () => {
  const TYPES = ['text', 'number', 'currency', 'date', 'datetime', 'select', 'lookup', 'boolean'];

  it('after any switch, the operator is one the NEW bucket offers', () => {
    for (const from of TYPES) {
      for (const to of TYPES) {
        const target = operatorsForFieldType(to);
        for (const op of offeredFor(from)) {
          const settled = reconcileOperatorForField(op, target);
          expect(
            offeredFor(to),
            `${from} → ${to} left "${op}" as "${settled}"`,
          ).toContain(settled);
        }
      }
    }
  });

  it('and it holds for the canonical spellings a stored rule can carry', () => {
    for (const to of TYPES) {
      const target = operatorsForFieldType(to);
      for (const op of FILTER_BUILDER_OPERATORS) {
        const settled = reconcileOperatorForField(normalizeFilterOperator(op), target);
        const offered = offeredFor(to);
        const ok =
          offered.includes(settled) ||
          offered.some((id) => normalizeFilterOperator(id) === normalizeFilterOperator(settled));
        expect(ok, `→ ${to} left "${op}" as "${settled}"`).toBe(true);
      }
    }
  });
});

describe('PR #4762’s operator-side behaviour is unchanged by this', () => {
  it('switching the operator after a field switch still re-shapes the value', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'won' });
    // `equals` is offered by the select bucket too, so the field switch keeps
    // it — and the value with it.
    await pick(0, 'Stage');
    expect(lastRow(onChange)).toMatchObject({ field: 'stage', operator: 'equals', value: 'won' });

    // Then the operator switch does what PR #4762 made it do.
    await pick(1, 'In');
    expect(lastRow(onChange)).toMatchObject({ operator: 'in', value: ['won'] });
  });

  it('a field switch that resets to `equals` leaves a row `in` can be re-entered from', async () => {
    const { onChange } = renderRow({ field: 'stage', operator: 'in', value: ['won'] });
    await pick(0, 'Title');
    expect(lastRow(onChange)).toMatchObject({ field: 'title', operator: 'equals', value: 'won' });
  });
});
