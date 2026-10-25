/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Two cards, one family: the FilterBuilder's value path used to read a value
 * LENIENTLY, and both readings produced a row whose control disagreed with what
 * the row carried.
 *
 * **objectui#4873 — a falsy value is not an empty one.** `!condition.value` and
 * `String(condition.value || "")` fold `false` and `0` in with the unfilled
 * rows. So a boolean row filtered `equals false` showed the "Select value"
 * placeholder, and a number row filtered `equals 0` showed an empty box — while
 * both rows saved, persisted and filtered by the value. Typing `0` into a
 * number column looked like the keystroke had never landed. Directly reachable
 * by any user: pick a boolean column, click **False**.
 *
 * **objectui#4875 — `parseFloat(raw) || 0` is not a reading.** It takes half of
 * `"42abc"` and `NaN` from `"acme"`, then buries both under `0`: a filter the
 * user never wrote. The three keyed numeric paths used it while the field-switch
 * path (objectui#4781) used a strict one, so one file held two answers to "is
 * this string a number".
 *
 * DIRECTION, predicted before running:
 *
 *   - every pin under "the two falsy values" is RED on `origin/main`, naming
 *     the placeholder or the blank box;
 *   - "an unfilled row still shows the placeholder" and the `true` / `'42'`
 *     controls are GREEN in both directions. They are the blast-radius guards:
 *     the cheap rewrite of objectui#4873 — mapping the boolean control through
 *     `String(value)` alone — turns `""` into the literal `"undefined"`/`""`
 *     confusion the card warned about ("换个写法就把坑挪个位置"), and any
 *     over-eager numeric fix kills the `'42'` controls;
 *   - the objectui#4875 pins are RED on `main` too — but read the note below
 *     before treating that as a statement about users.
 *
 * WHAT THIS ENVIRONMENT ACTUALLY DOES — measured against jsdom 27 / React 19,
 * because the first two drafts of this file each guessed it wrong in a
 * different direction, and the guess decides whether these pins mean anything:
 *
 *   | `input.value = x` on `<input type="number">` | jsdom keeps |
 *   | `"42"` / `"0"`                               | as typed    |
 *   | `"42abc"`                                    | `"42abc"`   |
 *   | `"acme"`                                     | `""`        |
 *
 * jsdom DOES implement the number input's value sanitisation, but its reading
 * is PREFIX-lenient — the very leniency this card is about, one layer further
 * down. So `"acme"` never reaches the component at all (blanked before React
 * sees a change, so `onChange` does not even fire), while `"42abc"` sails
 * through. Separately, React renders a non-numeric value INTO a number input as
 * `""`, which is the blank-box half PR #4876 measured from the other side.
 *
 * Two consequences, both load-bearing:
 *
 *   1. `typeAsText` flips the input to `type="text"` before typing, so all six
 *      objectui#4875 pins reach the site's own judgement by the same route
 *      instead of two of them silently depending on a jsdom quirk;
 *   2. this suite CANNOT pin the browser guard itself — an earlier draft tried
 *      ("a number input yields '' for text") and it passed only because the FIX
 *      cleared the value, a pin that could not fail for the reason it was
 *      written. What it pins instead is the CONDITION that guard rests on: all
 *      three paths are still drawn as `<input type="number">`.
 *
 * So the objectui#4875 pins drive a branch no user can reach today. That is
 * precisely why the card is an observation rather than a defect — and precisely
 * why it needs pinning: an unreachable lenient branch drifts unnoticed, and
 * these say what the site's judgement must be on the day the guard is gone.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterBuilder } from '../custom/filter-builder';

const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'is_won', label: 'Won', type: 'boolean' },
  // Option ids that are DIGITS — a severity/level column, the ordinary shape in
  // which a select's own value can be falsy once a stored row carries it as a
  // number rather than as the string the options list.
  {
    value: 'level',
    label: 'Level',
    type: 'select',
    options: [
      { value: '0', label: 'None' },
      { value: '1', label: 'High' },
    ],
  },
];

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  // Hoisted OUT of the JSX, as in the sibling filter-builder suites: the sync
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

/** What the single value input DISPLAYS — a blank box is half the symptom. */
function valueInput(): HTMLInputElement {
  const input = document.querySelector('input[placeholder="Value"]');
  expect(input, 'the row drew no single-value input').toBeTruthy();
  return input as HTMLInputElement;
}

/**
 * What the value SELECT displays — index 2 of the row's comboboxes (field,
 * operator, value). Like the operator trigger in objectui#4768, a Radix trigger
 * renders its placeholder for a value none of its items carry, so this text is
 * the whole symptom for the boolean and select columns.
 */
function valueTrigger(): HTMLElement {
  return screen.getAllByRole('combobox')[2];
}

/**
 * Type `text` into `input` with its `type` flipped to `text` first — reaching
 * the site's own judgement with a string the input would otherwise filter
 * (objectui#4875).
 *
 * The flip is doing real work, and only for some inputs: per the header's
 * measurement, jsdom's number sanitiser blanks `"acme"` before React sees a
 * change but lets `"42abc"` through. Flipping puts all six pins on the same
 * route rather than leaving half of them resting on where that sanitiser
 * happens to draw its line.
 *
 * What it reproduces is the future the card was filed about: the day one of
 * these becomes a text box (formula support, variables, a paste path), or a
 * programmatic write reaches it, the string arrives and the site's own reading
 * is all that is left. React does not fight the flip — it only patches DOM
 * attributes it sees change in its own props, and `type` did not.
 */
function typeAsText(input: HTMLInputElement, text: string) {
  input.type = 'text';
  fireEvent.change(input, { target: { value: text } });
}

describe('objectui#4873 — the two falsy values the controls used to hide', () => {
  it('shows False for a boolean row filtered `equals false`', () => {
    renderRow({ field: 'is_won', operator: 'equals', value: false });

    // The reported repro: `String(false || "")` is `""`, which is what a Radix
    // Select takes as "nothing selected", so the trigger bounced back to the
    // placeholder the moment the user picked False.
    expect(valueTrigger().textContent).toBe('False');
  });

  it('still shows the placeholder for an UNFILLED boolean row', () => {
    renderRow({ field: 'is_won', operator: 'equals', value: '' });

    // Green in both directions, and the point of the card's second warning:
    // "not picked yet" and "picked False" have to stay two states. A fix that
    // reached for `String(condition.value)` alone would render `""` for the
    // unfilled row too — same blank trigger,坑 moved rather than closed.
    expect(valueTrigger().textContent).toBe('Select value');
  });

  it('still shows True for `equals true`', () => {
    // The control: `true` was never falsy, so this is green in both directions.
    // It is here so the False pin above cannot pass by the trigger having been
    // hard-wired to one label.
    renderRow({ field: 'is_won', operator: 'equals', value: true });
    expect(valueTrigger().textContent).toBe('True');
  });

  it('picking False through the real dropdown leaves the trigger reading False', async () => {
    // The full user gesture the card describes, not just the render of a stored
    // row: open the value Select, click False, and read the trigger back.
    const { onChange } = renderRow({ field: 'is_won', operator: 'equals', value: '' });

    fireEvent.keyDown(valueTrigger(), { key: 'ArrowDown' });
    const option = screen.getAllByRole('option').find((o) => o.textContent === 'False');
    expect(option, 'no False option in the value dropdown').toBeTruthy();
    fireEvent.click(option!);

    // The row was always right; it was the control that lied about it.
    expect(lastRow(onChange).value).toBe(false);
    expect(valueTrigger().textContent).toBe('False');
  });

  it('shows 0 in the input for a number row filtered `equals 0`', () => {
    renderRow({ field: 'amount', operator: 'equals', value: 0 });

    // `!condition.value` returned `""` here, so the box was blank while the row
    // filtered `amount equals 0`.
    expect(valueInput().value).toBe('0');
  });

  it('keeps a typed 0 visible in the number input', () => {
    // The symptom as the user meets it: the keystroke lands, the row takes the
    // value, and the re-render used to wipe the box — so it read as if nothing
    // had been typed at all.
    const { onChange } = renderRow({ field: 'amount', operator: 'equals', value: '' });

    fireEvent.change(valueInput(), { target: { value: '0' } });

    const row = lastRow(onChange);
    expect(row.value).toBe(0);
    expect(typeof row.value).toBe('number');
    expect(valueInput().value).toBe('0');
  });

  it('shows a select option whose id is the number 0', () => {
    renderRow({ field: 'level', operator: 'equals', value: 0 });

    // `String(0 || "")` was `""` → placeholder. The multi-value branch of this
    // same control already compared option ids by `String()`, so it would have
    // drawn this very row as CHECKED — the single-select branch was the one
    // reading the value differently from its own sibling.
    expect(valueTrigger().textContent).toBe('None');
  });

  it('shows a 0 bound in a range', () => {
    // Green in both directions: the range inputs were the one display site that
    // already asked `=== ""` rather than `!value`. The pin is here because they
    // now read the value through the SAME helper as the other three, and a
    // shared helper is only worth having if every reader is actually pinned to
    // it.
    const { getByTestId } = renderRow({
      field: 'amount',
      operator: 'between',
      value: [0, 100],
    });

    const inputs = getByTestId('filter-range-amount').querySelectorAll('input');
    expect(inputs[0].value).toBe('0');
    expect(inputs[1].value).toBe('100');
  });
});

describe('objectui#4875 — three keyed numeric paths, one reading', () => {
  it('all three paths are still drawn as <input type="number"> — the condition that makes them dormant', () => {
    // Green in both directions, deliberately, and it is the honest half of what
    // the first draft tried to pin. A real browser keeps these three branches
    // unreachable because their inputs are number inputs; this environment
    // cannot observe that refusal (header note), but it CAN observe the
    // condition it rests on. The day one of these becomes a text box — formula
    // support, variables, a paste path — this pin goes red, and that is the day
    // the strict reading below stops being insurance and becomes the only thing
    // holding the line.
    const { getByTestId, rerender } = renderRow({ field: 'amount', operator: 'equals', value: '' });
    expect(valueInput().type).toBe('number');

    const withOperator = (operator: string) => {
      rerender(
        <FilterBuilder
          fields={FIELDS as any}
          value={
            {
              id: 'root',
              logic: 'and',
              conditions: [{ id: 'c1', field: 'amount', operator, value: [] }],
            } as any
          }
          onChange={() => {}}
        />,
      );
    };

    withOperator('between');
    const bounds = getByTestId('filter-range-amount').querySelectorAll('input');
    expect([bounds[0].type, bounds[1].type]).toEqual(['number', 'number']);

    withOperator('in');
    expect(getByTestId('filter-multi-value-amount').querySelector('input')!.type).toBe('number');
  });

  describe('the single value input', () => {
    it('reads a half-number as UNFILLED, not as its first digits', () => {
      const { onChange } = renderRow({ field: 'amount', operator: 'equals', value: '' });
      typeAsText(valueInput(), '42abc');

      // `parseFloat("42abc")` is 42 — a filter on a number the user never
      // finished typing.
      expect(lastRow(onChange).value).toBe('');
    });

    it('reads a non-number as UNFILLED, not as 0', () => {
      const { onChange } = renderRow({ field: 'amount', operator: 'equals', value: '' });
      typeAsText(valueInput(), 'acme');

      // `parseFloat("acme") || 0` is 0 — `amount equals 0`, invented whole.
      expect(lastRow(onChange).value).toBe('');
    });

    it('still reads a clean number', () => {
      // Green in both directions — the blast-radius guard for the strict
      // reading: refusing junk must not start refusing numbers.
      const { onChange } = renderRow({ field: 'amount', operator: 'equals', value: '' });
      typeAsText(valueInput(), '42');

      expect(lastRow(onChange).value).toBe(42);
      expect(typeof lastRow(onChange).value).toBe('number');
    });
  });

  describe('a range bound', () => {
    // `between` is not in the number column's operator bucket, so this row is
    // not reachable through the dropdowns — it is the shape an external `value`
    // prop hands in (a rule stored by another surface, read back into the
    // panel). That second layer of dormancy is worth stating precisely: the
    // card says the number INPUT hides these branches, and for the range and
    // token inputs the operator bucket hides them one layer earlier still.
    it('reads a half-number as an unfilled bound, not as its first digits', () => {
      const { onChange, getByTestId } = renderRow({
        field: 'amount',
        operator: 'between',
        value: [10, 20],
      });
      typeAsText(getByTestId('filter-range-amount').querySelectorAll('input')[0], '42abc');

      // Silently narrowing a RANGE is the worst of the three: `[42, 20]` is an
      // empty range that looks filled in.
      expect(lastRow(onChange).value).toEqual(['', 20]);
    });

    it('reads a non-number as an unfilled bound, not as 0', () => {
      const { onChange, getByTestId } = renderRow({
        field: 'amount',
        operator: 'between',
        value: [10, 20],
      });
      typeAsText(getByTestId('filter-range-amount').querySelectorAll('input')[0], 'acme');

      expect(lastRow(onChange).value).toEqual(['', 20]);
    });

    it('still reads a clean number, and still collapses when both bounds go', () => {
      // Green in both directions, twice over: the strict reading must keep
      // taking numbers, and it must not disturb the "nothing filled in yet"
      // shape the write path drops.
      const { onChange, getByTestId } = renderRow({
        field: 'amount',
        operator: 'between',
        value: [10, 20],
      });
      const bounds = () => getByTestId('filter-range-amount').querySelectorAll('input');

      fireEvent.change(bounds()[0], { target: { value: '42' } });
      expect(lastRow(onChange).value).toEqual([42, 20]);

      // And emptying both bounds still collapses to the "nothing filled in yet"
      // shape — `convertScalarToFamily("", "number")` returns `""` rather than
      // `undefined`, which is what lets the old `raw !== ""` guard be dropped
      // instead of reproduced. If it cleared to `undefined` the row would keep
      // `["", ""]` here and the write path would persist an empty range.
      fireEvent.change(bounds()[0], { target: { value: '' } });
      expect(lastRow(onChange).value).toEqual(['', 20]);
      fireEvent.change(bounds()[1], { target: { value: '' } });
      expect(lastRow(onChange).value).toEqual([]);
    });
  });

  describe('the token input', () => {
    // Same two-layer dormancy as the range: `in` is not in the number column's
    // bucket either, so a numeric token list arrives only from a stored rule.
    it('declines a half-number instead of committing its first digits', () => {
      const { onChange, getByTestId } = renderRow({
        field: 'amount',
        operator: 'in',
        value: [],
      });
      const input = getByTestId('filter-multi-value-amount').querySelector('input')!;
      typeAsText(input, '42abc');
      fireEvent.keyDown(input, { key: 'Enter' });

      // Nothing committed — and, unlike the other two paths, the text is not
      // thrown away either. A token list has no "unfilled" slot to clear to, so
      // clearing would DESTROY the input rather than decline it; the draft
      // stays in the box where the user can see and fix it.
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('42abc');
    });

    it('declines a non-number instead of committing 0', () => {
      const { onChange, getByTestId } = renderRow({
        field: 'amount',
        operator: 'in',
        value: [],
      });
      const input = getByTestId('filter-multi-value-amount').querySelector('input')!;
      typeAsText(input, 'acme');
      fireEvent.keyDown(input, { key: 'Enter' });

      // `parseFloat("acme") || 0` committed the token 0, which is then
      // indistinguishable from a 0 the user meant.
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('acme');
    });

    it('still commits a clean number, and still clears the draft', () => {
      // Green in both directions — the blast-radius guard.
      const { onChange, getByTestId } = renderRow({
        field: 'amount',
        operator: 'in',
        value: [],
      });
      const input = getByTestId('filter-multi-value-amount').querySelector('input')!;
      typeAsText(input, '42');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(lastRow(onChange).value).toEqual([42]);
      expect(input.value).toBe('');
    });
  });
});
