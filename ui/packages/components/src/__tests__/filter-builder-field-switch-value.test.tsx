/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Changing a row's FIELD must leave the row's value inside what the new field's
 * type can hold (objectui#4781).
 *
 * PR #4779 (objectui#4768) settled the row's OPERATOR on a field switch, and
 * re-shaped the value only when the operator's family changed — scalar to
 * scalar has no shape question, so `"acme"` was carried through deliberately.
 * But the field's TYPE changed too, and the value input is redrawn from it: a
 * browser renders a non-numeric value in `<input type="number">` as BLANK. So a
 * `text` row filtered `equals "acme"`, pointed at a number column, showed an
 * empty box while the row went on carrying `"acme"` —
 * `foldFilterGroupToSpecRules` persisted it and the live grid queried
 * `amount equals "acme"`. The same invisible-value shape as objectui#4768, one
 * column over.
 *
 * Ruled on the card (2026-08-16, option B): convert when convertible, clear
 * otherwise. `"42"` on a number column becomes `42`; `"acme"` clears to the
 * family's empty shape (scalar `''`, list `[]`).
 *
 * DIRECTION, predicted before running:
 *
 *   - every pin under "cleared when the new column cannot hold it" and
 *     "converted when the new column can" is RED on `origin/main`, where the
 *     scalar is carried through verbatim — `"acme"` stays `"acme"`, `"42"`
 *     stays the STRING `"42"`;
 *   - "a value the new column CAN already hold is left alone" is GREEN in both
 *     directions by design. It is the blast-radius guard: a fix that cleared on
 *     every field switch — option A, the one the maintainer ruled against —
 *     turns all of it red;
 *   - the `retypeFilterValue` matrix does not COMPILE on `main` (the helper
 *     does not exist there): those are pins on the new helper's contract, the
 *     same status PR #4779's `reconcileOperatorForField` block had;
 *   - the input-type derivation block is GREEN in both directions too. It
 *     guards a refactor that must not change behaviour: `getInputType` now
 *     reads the same family table the conversion does, so the type a value is
 *     converted TO and the input it is edited IN cannot drift apart.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterBuilder, retypeFilterValue, operatorsForFieldType } from '../custom/filter-builder';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/core';

/**
 * One column per value family the builder can draw — and a SECOND text, numeric
 * and date column, because "the value survives a switch WITHIN one family" is
 * this fix's blast-radius guard and needs two columns of a family to be
 * expressible at all. (A Select fires nothing when re-picking the value it
 * already holds, so a same-column "switch" would assert on an event that never
 * happened.)
 */
const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'owner_note', label: 'Owner note', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'quota', label: 'Quota', type: 'currency' },
  { value: 'closed_at', label: 'Closed at', type: 'date' },
  { value: 'due_on', label: 'Due on', type: 'date' },
  { value: 'created_at', label: 'Created at', type: 'datetime' },
  { value: 'call_at', label: 'Call at', type: 'time' },
  { value: 'is_won', label: 'Won', type: 'boolean' },
  { value: 'stage', label: 'Stage', type: 'select' },
];

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted OUT of the JSX, as in PR #4762's and PR #4779's suites: the sync
  // effect re-seeds internal state whenever the `value` PROP's identity
  // changes, which would undo the interaction under test on the next render.
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

/** Drive the REAL field dropdown — index 0 of the row's comboboxes. */
async function pickField(label: string) {
  const triggers = screen.getAllByRole('combobox');
  fireEvent.keyDown(triggers[0], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" option in the field dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/** What the single value input DISPLAYS — blank is the symptom this card is about. */
function valueInput(): HTMLInputElement {
  const input = document.querySelector('input[placeholder="Value"]');
  expect(input, 'the row drew no single-value input').toBeTruthy();
  return input as HTMLInputElement;
}

/**
 * Whether a browser's `<input type>` would SHOW `value` as the row stores it,
 * rather than blanking it (the value sanitisation algorithm) or showing only
 * part of it.
 *
 * The rule is asserted directly instead of by reading `input.value`, and that
 * is not a shortcut — it is what this environment can honestly observe. jsdom
 * blanks a non-numeric value on an input CREATED as `type="number"` (pinned
 * just below), but it does not re-run the sanitisation when an existing input's
 * `type` is flipped in place, which is exactly what a field switch does: after
 * the switch it hands back the pre-switch string a browser would have cleared.
 * Measured, not assumed — with this card's fix disconnected, an
 * `expect(input.value).toBe(String(row.value))` written over the switch stayed
 * GREEN while the row carried `"acme"` and a browser showed an empty box. A pin
 * that cannot fail for the reason it was written is worse than no pin, so the
 * criterion it was reaching for is stated here instead.
 *
 * `date` is included because the disagreement need not be a blank box: the
 * builder formats a timestamp for a date input by cutting it at the `T`, so the
 * box would show `2024-03-05` while the row stored `2024-03-05T14:30` — shown
 * and stored still differ, which is the same defect one notch quieter.
 */
function inputShowsExactly(inputType: string, value: unknown): boolean {
  const shown = String(value);
  if (shown === '') return true;
  switch (inputType) {
    case 'number':
      return shown.trim() !== '' && Number.isFinite(Number(shown));
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(shown);
    case 'datetime-local':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(shown);
    case 'time':
      return /^\d{2}:\d{2}(:\d{2})?$/.test(shown);
    default:
      return true;
  }
}

describe('the reported repro: a text value pointed at a number column', () => {
  it('clears the value the number input cannot show, instead of hiding it in the row', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickField('Amount');

    const row = lastRow(onChange);
    expect(row.field).toBe('amount');
    // The row used to keep `"acme"` here — persisted by the fold, queried by
    // the grid as `amount equals "acme"`, and invisible in the panel.
    expect(row.value).toBe('');
  });

  it('redraws the row with the number input, and shows nothing in it', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickField('Amount');

    const input = valueInput();
    expect(input.type).toBe('number');
    // Empty box, empty row — after the fix the two agree on nothing being
    // there, which is the honest state. Before it, the box was equally empty
    // and the row was not.
    expect(input.value).toBe('');
    expect(lastRow(onChange).value).toBe('');
  });
});

describe('what the row stores is what its input can show', () => {
  it('a number column shows NOTHING for a non-numeric value — the symptom itself', () => {
    // Green in both directions on purpose: it states the browser behaviour the
    // card is about, not this fix. It is here because every clearing rule below
    // rests on it, and it fails the day the value input stops being an
    // `<input type="number">` — at which point the clearing rules need
    // rethinking rather than silently guarding nothing.
    const value = {
      id: 'root',
      logic: 'and',
      conditions: [{ id: 'c1', field: 'amount', operator: 'equals', value: 'acme' }],
    };
    render(
      <FilterBuilder
        fields={[{ value: 'amount', label: 'Amount', type: 'number' }] as any}
        value={value as any}
        onChange={() => {}}
      />,
    );

    expect(valueInput().type).toBe('number');
    expect(valueInput().value).toBe('');
  });

  const SWITCHES: Array<[string, Record<string, unknown>, string]> = [
    ['a word onto a number column', { field: 'title', value: 'acme' }, 'Amount'],
    ['a word onto a date column', { field: 'title', value: 'acme' }, 'Closed at'],
    ['a date onto a datetime column', { field: 'closed_at', value: '2024-03-05' }, 'Created at'],
    [
      'a timestamp onto a date column',
      { field: 'created_at', value: '2024-03-05T14:30' },
      'Closed at',
    ],
    // Already renderable before the switch, so it is the control: it stays
    // green whatever `changeField` does, and is here to show the invariant is
    // not passing merely because everything was cleared.
    ['a numeric string onto a number column', { field: 'title', value: '42' }, 'Amount'],
  ];

  it.each(SWITCHES)('after moving %s, the row holds only what the input shows', async (
    _name,
    condition,
    target,
  ) => {
    const { onChange } = renderRow({ operator: 'equals', ...condition });
    await pickField(target);

    const row = lastRow(onChange);
    expect(
      inputShowsExactly(valueInput().type, row.value),
      `${valueInput().type} input cannot show ${JSON.stringify(row.value)}`,
    ).toBe(true);
  });
});

describe('converted when the new column can read it', () => {
  it('a numeric string becomes a NUMBER on a number column', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: '42' });
    await pickField('Amount');

    const row = lastRow(onChange);
    expect(row.value).toBe(42);
    // The type matters as much as the digits: the string survived on `main`,
    // and a stored `"42"` is a different rule from a stored `42` to every
    // consumer that compares strictly.
    expect(typeof row.value).toBe('number');
    expect(valueInput().value).toBe('42');
  });

  it('a number becomes its STRING on a text column', async () => {
    const { onChange } = renderRow({ field: 'amount', operator: 'equals', value: 42 });
    await pickField('Title');

    expect(lastRow(onChange).value).toBe('42');
  });

  it('“true” becomes the BOOLEAN on a boolean column, and the picker shows it', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'true' });
    await pickField('Won');

    expect(lastRow(onChange).value).toBe(true);
    // Index 2 is the value control; a boolean column draws a two-item Select,
    // which — like the operator trigger in objectui#4768 — renders BLANK for a
    // value none of its items carry.
    expect(screen.getAllByRole('combobox')[2].textContent).toBe('True');
  });

  it('a boolean becomes “true” on a text column — the round trip closes', async () => {
    const { onChange } = renderRow({ field: 'is_won', operator: 'equals', value: true });
    await pickField('Title');

    expect(lastRow(onChange).value).toBe('true');
  });

  it('a zoneless timestamp keeps its DATE on a date column', async () => {
    const { onChange } = renderRow({
      field: 'created_at',
      operator: 'equals',
      value: '2024-03-05T14:30',
    });
    await pickField('Closed at');

    // The one truncation that loses nothing a `<input type="date">` could have
    // shown: it already displayed `2024-03-05` while the row carried the time,
    // so this is the same disagreement closed from the value's side.
    expect(lastRow(onChange).value).toBe('2024-03-05');
    expect(valueInput().value).toBe('2024-03-05');
  });
});

describe('cleared when the new column cannot hold it', () => {
  it('clears a word on a date column', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickField('Closed at');

    expect(lastRow(onChange).value).toBe('');
    expect(valueInput().value).toBe('');
  });

  it('clears a bare date on a DATETIME column rather than inventing midnight', async () => {
    const { onChange } = renderRow({
      field: 'closed_at',
      operator: 'equals',
      value: '2024-03-05',
    });
    await pickField('Created at');

    // `equals 2024-03-05T00:00` would be a filter the user never wrote and one
    // that matches almost nothing — worse than an empty input, because it
    // looks answered.
    expect(lastRow(onChange).value).toBe('');
  });

  it('clears a word on a boolean column, leaving the picker at its placeholder', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: 'acme' });
    await pickField('Won');

    expect(lastRow(onChange).value).toBe('');
    expect(screen.getAllByRole('combobox')[2].textContent).toBe('Select value');
  });

  it('clears both bounds of a range the new column cannot read, back to `[]`', async () => {
    // `between` is offered by every date-like column, so the OPERATOR survives
    // this switch untouched and only the type judgement runs — the case
    // PR #4779's shape-only reconcile could not reach at all.
    const { onChange } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', '2024-12-31'],
    });
    await pickField('Created at');

    const row = lastRow(onChange);
    expect(row.operator).toBe('between');
    // `[]` and not `['', '']`: the "not filled in yet" shape
    // `reshapeFilterValue` also produces, which the write path drops.
    expect(row.value).toEqual([]);
  });
});

describe('a value the new column CAN already hold is left alone', () => {
  // Green in both directions by design — the guard on this fix's blast radius.
  // Option A (clear on every field switch) was ruled against precisely because
  // it would turn this block red.
  it('keeps a typed word across two text columns', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'contains', value: 'acme' });
    await pickField('Owner note');

    expect(lastRow(onChange)).toMatchObject({ field: 'owner_note', value: 'acme' });
  });

  it('keeps a number across two numeric columns', async () => {
    const { onChange } = renderRow({ field: 'amount', operator: 'greater_than', value: 42 });
    await pickField('Quota');

    expect(lastRow(onChange)).toMatchObject({ field: 'quota', operator: 'greater_than', value: 42 });
  });

  it('keeps a date string on a text column — text holds everything', async () => {
    const { onChange } = renderRow({ field: 'closed_at', operator: 'equals', value: '2024-03-05' });
    await pickField('Title');

    expect(lastRow(onChange).value).toBe('2024-03-05');
  });

  it('keeps a range both date columns can read', async () => {
    const { onChange } = renderRow({
      field: 'closed_at',
      operator: 'between',
      value: ['2024-01-01', '2024-12-31'],
    });
    await pickField('Due on');

    expect(lastRow(onChange).value).toEqual(['2024-01-01', '2024-12-31']);
  });

  it('leaves an unfilled row unfilled — clearing `""` is not a decision', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'equals', value: '' });
    await pickField('Amount');

    expect(lastRow(onChange)).toMatchObject({ field: 'amount', operator: 'equals', value: '' });
  });

  it('leaves a value-less row alone', async () => {
    const { onChange } = renderRow({ field: 'title', operator: 'is_null', value: '' });
    await pickField('Amount');

    expect(lastRow(onChange)).toMatchObject({ operator: 'is_null', value: '' });
  });
});

describe('`retypeFilterValue` — the convertibility judgement, one family at a time', () => {
  // `type` here is the FIELD type, and the helper maps it to a family itself —
  // the same mapping the value input is drawn from.
  const scalar = (value: unknown, type: string) =>
    retypeFilterValue(value as never, type, 'equals');

  it('number: a clean numeric reading, or nothing', () => {
    expect(scalar('42', 'number')).toBe(42);
    expect(scalar(' 42 ', 'number')).toBe(42);
    expect(scalar('-3.5', 'number')).toBe(-3.5);
    expect(scalar('1e3', 'number')).toBe(1000);
    expect(scalar(7, 'currency')).toBe(7);
    // Deliberately stricter than `parseFloat`, which reads all three as a
    // number (`NaN`→0, 42, 1) and would write a filter the user never typed.
    expect(scalar('acme', 'number')).toBe('');
    expect(scalar('42abc', 'number')).toBe('');
    expect(scalar('1,000', 'number')).toBe('');
    expect(scalar('Infinity', 'number')).toBe('');
    expect(scalar(true, 'number')).toBe('');
  });

  it('boolean: the two words that round-trip, and nothing else', () => {
    expect(scalar('true', 'boolean')).toBe(true);
    expect(scalar('False', 'boolean')).toBe(false);
    expect(scalar(false, 'boolean')).toBe(false);
    // Conventions, not readings.
    expect(scalar(1, 'boolean')).toBe('');
    expect(scalar('yes', 'boolean')).toBe('');
    expect(scalar('acme', 'boolean')).toBe('');
  });

  it('date: what a date input can render, plus a zoneless timestamp’s date', () => {
    expect(scalar('2024-03-05', 'date')).toBe('2024-03-05');
    expect(scalar('2024-03-05T14:30', 'date')).toBe('2024-03-05');
    expect(scalar('2024-03-05T14:30:59.500', 'date')).toBe('2024-03-05');
    // A date that does not exist renders blank in the input too.
    expect(scalar('2024-02-31', 'date')).toBe('');
    expect(scalar('2024-13-01', 'date')).toBe('');
    expect(scalar('05/03/2024', 'date')).toBe('');
    // Zone-carrying: no input here renders it, and truncating by hand is the
    // ambiguity the ruling says to refuse (the instant can fall on either day).
    expect(scalar('2024-03-05T23:30:00Z', 'date')).toBe('');
    expect(scalar('2024-03-05T23:30:00+08:00', 'date')).toBe('');
    expect(scalar(20240305, 'date')).toBe('');
  });

  it('datetime: a zoneless local timestamp only', () => {
    expect(scalar('2024-03-05T14:30', 'datetime')).toBe('2024-03-05T14:30');
    expect(scalar('2024-03-05T14:30:15', 'datetime')).toBe('2024-03-05T14:30:15');
    expect(scalar('2024-03-05', 'datetime')).toBe('');
    expect(scalar('2024-03-05T25:00', 'datetime')).toBe('');
    expect(scalar('2024-03-05T14:30Z', 'datetime')).toBe('');
  });

  it('time: a clock reading only', () => {
    expect(scalar('14:30', 'time')).toBe('14:30');
    expect(scalar('14:30:15', 'time')).toBe('14:30:15');
    expect(scalar('29:71', 'time')).toBe('');
    // A time-of-day column asks a different question than an instant does, so
    // the timestamp is not mined for its clock half.
    expect(scalar('2024-03-05T14:30', 'time')).toBe('');
  });

  it('text-shaped families hold everything, typed as text', () => {
    // `owner` left this list with objectui#4914. It is no longer a LIVE member
    // of any family — the retirement gate refuses it ahead of every bucket
    // test — so asserting it here alongside `user` and `lookup` would have gone
    // on claiming it is live. Its own pin is the next test, and it is the
    // INVERTED one: what a retired spelling loses, and the one thing it must
    // not lose.
    for (const type of ['text', 'select', 'status', 'lookup', 'master_detail', 'user']) {
      expect(scalar('acme', type)).toBe('acme');
      expect(scalar(42, type)).toBe('42');
      expect(scalar(true, type)).toBe('true');
    }
    // An unknown type, and no type at all, fall to text rather than clearing:
    // a column this builder cannot classify must not eat the user's value.
    expect(scalar('acme', 'something_new')).toBe('acme');
    expect(retypeFilterValue('acme', undefined, 'equals')).toBe('acme');
  });

  it('a RETIRED type loses the relational bucket but never the value', () => {
    // objectui#4914, the inversion of the member that used to sit in the list
    // above. Two halves, and both matter:
    const retired = Object.keys(RETIRED_FIELD_TYPES)[0];
    resetRetiredFieldTypeReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // (1) REFUSED — it no longer answers with the lookup family's operators,
      // which is what its membership above used to imply, and it says so.
      expect(operatorsForFieldType(retired).map((op) => op.value))
        .toEqual(operatorsForFieldType('something_new').map((op) => op.value));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[retired]);

      // (2) NOT EATEN — `retypeFilterValue` is deliberately NOT gated. It
      // answers "what shape can this column hold", and a refusal that cleared
      // the row would destroy a stored filter value on the way to showing the
      // author their prescription. A refusal is loud, not destructive.
      expect(scalar('acme', retired)).toBe('acme');
      expect(scalar(42, retired)).toBe('42');
      expect(scalar(true, retired)).toBe('true');
    } finally {
      errorSpy.mockRestore();
      resetRetiredFieldTypeReports();
    }
  });

  it('the empty scalar is returned unchanged by every family', () => {
    for (const type of ['text', 'number', 'boolean', 'date', 'datetime', 'time', 'select']) {
      expect(scalar('', type), type).toBe('');
    }
  });
});

describe('`retypeFilterValue` — one shape at a time', () => {
  it('a list converts entry by entry, keeping the ones that carry', () => {
    // Pinned on the helper rather than through the dropdown, and honestly so:
    // the only buckets offering `in`/`not_in` today are `select` and `lookup`,
    // both text-family, so no field switch can currently drive a list into a
    // number column. The helper answers for the family the operator lands in,
    // not for today's buckets, and this is where that answer is fixed.
    expect(retypeFilterValue(['42', 'acme', '7'], 'number', 'in')).toEqual([42, 7]);
    expect(retypeFilterValue(['won', 'lost'], 'number', 'in')).toEqual([]);
    expect(retypeFilterValue(['won', 'lost'], 'select', 'in')).toEqual(['won', 'lost']);
    expect(retypeFilterValue([], 'number', 'not_in')).toEqual([]);
    // A scalar reaching a list operator is normalised, not wrapped blindly.
    expect(retypeFilterValue('42', 'number', 'in')).toEqual([42]);
    expect(retypeFilterValue('', 'number', 'in')).toEqual([]);
  });

  it('a pair keeps its two slots, and collapses to `[]` only when both go', () => {
    expect(retypeFilterValue(['1', '9'], 'number', 'between')).toEqual([1, 9]);
    // One bound unreadable: the other still means something, and the range
    // keeps the shape `between` requires rather than shrinking to one entry.
    expect(retypeFilterValue(['1', 'acme'], 'number', 'between')).toEqual([1, '']);
    expect(retypeFilterValue(['acme', 'globex'], 'number', 'between')).toEqual([]);
    expect(retypeFilterValue([], 'number', 'between')).toEqual([]);
  });

  it('every family only ever yields its own type or its empty shape', () => {
    // The invariant behind all of the above: whatever arrives, what comes out
    // is something the new column's input can render. A conversion that
    // "mostly" works — `parseFloat`'s partial reads, an invented midnight —
    // fails this.
    const CORPUS = [
      'acme', '42', ' 42 ', '42abc', '', 'true', 'False', '2024-03-05',
      '2024-03-05T14:30', '2024-03-05T14:30:00Z', '14:30', '2024-02-31',
      0, 42, -3.5, true, false,
    ];
    const EXPECTED: Record<string, (v: unknown) => boolean> = {
      number: (v) => v === '' || typeof v === 'number',
      boolean: (v) => v === '' || typeof v === 'boolean',
      date: (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v)),
      datetime: (v) => v === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(v)),
      time: (v) => v === '' || /^\d{2}:\d{2}(:\d{2})?$/.test(String(v)),
      text: (v) => typeof v === 'string',
    };
    for (const [type, holds] of Object.entries(EXPECTED)) {
      for (const value of CORPUS) {
        const out = retypeFilterValue(value as never, type, 'equals');
        expect(holds(out), `${type} left ${JSON.stringify(value)} as ${JSON.stringify(out)}`).toBe(
          true,
        );
      }
    }
  });
});

describe('the value input each field type draws is unchanged by the refactor', () => {
  // `getInputType` now reads the family table instead of its own branch ladder.
  // Behaviour-preserving, and pinned type by type so it stays that way.
  const EXPECTED_INPUT_TYPE: Array<[string, string]> = [
    ['text', 'text'],
    ['number', 'number'],
    ['currency', 'number'],
    ['percent', 'number'],
    ['rating', 'number'],
    ['date', 'date'],
    ['datetime', 'datetime-local'],
    ['time', 'time'],
    ['select', 'text'],
    ['lookup', 'text'],
    ['something_new', 'text'],
  ];

  it.each(EXPECTED_INPUT_TYPE)('a %s column draws <input type="%s">', (type, inputType) => {
    const value = {
      id: 'root',
      logic: 'and',
      conditions: [{ id: 'c1', field: 'probe', operator: 'equals', value: '' }],
    };
    const { unmount } = render(
      <FilterBuilder
        fields={[{ value: 'probe', label: 'Probe', type }] as any}
        value={value as any}
        onChange={() => {}}
      />,
    );
    expect(valueInput().type).toBe(inputType);
    unmount();
  });
});
