/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `between` row is finished only when BOTH bounds are filled
 * (objectstack#8815).
 *
 * ## What was actually broken, and what was not
 *
 * The reported symptom was "「介于」only renders one input, so submitting gets
 * the view rejected". Half of that had already been fixed: objectui#3958 landed
 * the two-bound range input, and the first block below pins that render so it
 * cannot regress — a `date` column's `between` draws two `type="date"` inputs,
 * which is the exact repro the report names.
 *
 * What survived was the SUBMISSION half. Both write paths asked whether a row
 * was filled in with one shape-blind predicate — `null` / `''` / empty array —
 * and a half-filled range is `["2024-01-01", ""]`: an array of length 2, so it
 * counted as complete. The grid queried a range with an empty upper bound, the
 * server refused the whole view (`400 INVALID_FILTER`), and the saved-view fold
 * PERSISTED that same half-range so the refusal returned on every later read.
 *
 * The spec cannot stop it on the way past. Measured against
 * `ViewFilterRuleSchema` on `@objectstack/spec` 17.0.0:
 *
 *   - `['2024-01-01', '2024-03-01']` → accepted
 *   - `['2024-01-01', '']`           → ACCEPTED (two slots is all it counts)
 *   - `'2024-01-01'`                 → rejected
 *   - `['2024-01-01']`               → rejected
 *
 * So the empty bound is invisible to authoring validation and only dies at query
 * time. That makes not emitting it the producer's job, which is this component's
 * — hence `isFilterValueComplete` living beside the render that creates the
 * shape, and both consumers reading it rather than keeping copies.
 *
 * DIRECTION, predicted before running: the render block is green before and
 * after (it pins what must not change); the completeness block is RED before the
 * fix on exactly the half-filled cases and green after. The discriminating cases
 * are the falsy-but-real bounds — `0` and `false` — which a `!bound` reading
 * would drop as "unfilled", turning this guard into a new defect one column over
 * (objectui#4873).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { FilterBuilder, isFilterValueComplete } from '../custom/filter-builder';

const DATE_FIELDS = [{ value: 'declare_date', label: 'Declare date', type: 'date' }];

describe('`between` on a date column renders BOTH bounds', () => {
  it('draws two date inputs, not one', () => {
    const { container } = render(
      <FilterBuilder
        fields={DATE_FIELDS as any}
        value={{
          id: 'root',
          logic: 'and',
          conditions: [
            { id: 'c1', field: 'declare_date', operator: 'between', value: [] },
          ],
        } as any}
        onChange={vi.fn()}
      />,
    );

    const dateInputs = container.querySelectorAll('input[type="date"]');
    // The reported defect was exactly one. Two is a range; one is a query the
    // server will refuse no matter what the user types into it.
    expect(dateInputs).toHaveLength(2);
  });

  it('labels the bounds so they are distinguishable', () => {
    const { getByLabelText } = render(
      <FilterBuilder
        fields={DATE_FIELDS as any}
        value={{
          id: 'root',
          logic: 'and',
          conditions: [
            { id: 'c1', field: 'declare_date', operator: 'between', value: [] },
          ],
        } as any}
        onChange={vi.fn()}
      />,
    );

    expect(getByLabelText('From')).toBeInTheDocument();
    expect(getByLabelText('To')).toBeInTheDocument();
  });

  it('typing one bound leaves the row half-filled, and typing both completes it', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <FilterBuilder
        fields={DATE_FIELDS as any}
        value={{
          id: 'root',
          logic: 'and',
          conditions: [
            { id: 'c1', field: 'declare_date', operator: 'between', value: [] },
          ],
        } as any}
        onChange={onChange}
      />,
    );

    fireEvent.change(getByLabelText('From'), { target: { value: '2024-01-01' } });

    const afterFirst = onChange.mock.calls.at(-1)?.[0];
    const halfFilled = afterFirst.conditions[0].value;
    // The shape the old predicate read as complete — this is the value that
    // reached the server and got the view refused.
    expect(halfFilled).toEqual(['2024-01-01', '']);
    expect(isFilterValueComplete('between', halfFilled)).toBe(false);

    // Both bounds present → a real range.
    expect(isFilterValueComplete('between', ['2024-01-01', '2024-03-01'])).toBe(true);
  });
});

describe('isFilterValueComplete', () => {
  it.each([
    ['both bounds', ['2024-01-01', '2024-03-01'], true],
    ['upper bound missing', ['2024-01-01', ''], false],
    ['lower bound missing', ['', '2024-03-01'], false],
    ['both bounds missing', ['', ''], false],
    ['nothing filled in', [], false],
    ['a bare scalar', '2024-01-01', false],
    ['a one-element array', ['2024-01-01'], false],
    ['undefined', undefined, false],
    ['null', null, false],
  ])('pair — %s', (_name, value, expected) => {
    expect(isFilterValueComplete('between', value as any)).toBe(expected);
  });

  it.each([
    ['zero as a bound', [0, 10]],
    ['zero as the upper bound', [-5, 0]],
    ['false as a bound', [false, true]],
  ])('pair — %s is a real bound, not an empty one', (_name, value) => {
    // `!bound` would read every one of these as unfilled and silently drop a
    // filter the user can see on screen (objectui#4873, one column over).
    expect(isFilterValueComplete('between', value as any)).toBe(true);
  });

  it('answers the pair question for the canonical spelling too', () => {
    // A stored rule reaches these consumers already normalized; the arity fold
    // is what makes both spellings land on the same answer.
    expect(isFilterValueComplete('between', ['2024-01-01', ''])).toBe(false);
  });

  it.each([
    ['a value', 'acme', true],
    ['zero', 0, true],
    ['false', false, true],
    ['empty string', '', false],
    ['undefined', undefined, false],
    ['null', null, false],
  ])('scalar — %s', (_name, value, expected) => {
    expect(isFilterValueComplete('equals', value as any)).toBe(expected);
  });

  it.each([
    ['one entry', ['a'], true],
    ['several entries', ['a', 'b'], true],
    ['empty list', [], false],
  ])('list — %s', (_name, value, expected) => {
    expect(isFilterValueComplete('in', value as any)).toBe(expected);
  });

  it('leaves the non-pair families reading exactly as they did', () => {
    // The fix narrows `pair` only. If this ever goes red, the change reached
    // further than it was scoped to.
    for (const operator of ['equals', 'contains', 'greaterThan', 'before']) {
      expect(isFilterValueComplete(operator, '')).toBe(false);
      expect(isFilterValueComplete(operator, 'x')).toBe(true);
    }
  });
});
