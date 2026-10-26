/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A half-typed `between` range SHOWS itself as incomplete instead of being
 * dropped with no signal at all (objectui#10061 — ruling batch #146 item 5
 * letter A on objectstack#18012, maintainer 「146 同意」).
 *
 * ## The two halves of the ruling, and which one this file pins
 *
 * The ruling: while one bound of a `between` pair is blank the condition is
 * incomplete — **not emitted, and shown as incomplete in the UI**.
 *
 *   - 「not emitted」 has been true since objectui#5025 and is pinned by
 *     `filter-builder-pair-completeness.test.tsx`: `isFilterValueComplete` is
 *     arity-aware, and every write path asks it rather than keeping a copy.
 *   - 「shown as incomplete」 is what this file pins. Before it, the file
 *     carried zero `aria-invalid` (the lit control being its four `aria-label`
 *     hits), so an author who typed one bound saw their value on screen while
 *     every write path silently discarded the whole row.
 *
 * ⭐ The two are pinned in two files ON PURPOSE, so an ablation can tell them
 * apart: deleting the completeness rule reds the other file and leaves this one
 * green, and deleting the marker reds this one and leaves the other green. A
 * single file asserting both would go red either way and prove neither.
 *
 * ## Incomplete is a UI STATE, not a refusal
 *
 * Nothing here blocks anything: no save gate in this tree reads `aria-invalid`
 * (the only non-test reader of the attribute is a CSS `has-[]` selector in
 * `plugin-chatbot`), the completeness rule is unchanged, and the other rows of
 * the group keep applying. The marker is a diagnostic on one input.
 *
 * ## The distinction this fix is most likely to get wrong
 *
 * ⚠️ A blank bound is not a zero bound. `0` on a number column is a legitimate
 * lower bound, `''` is an unfilled one, and `undefined` is a bound the row does
 * not have yet. `!bound` reads all three as missing, which would tell an author
 * to fill in the `0` they can see they already typed and would leave the truly
 * blank side unmarked. The `[0, '']` / `[0, 10]` cases below are that pin, and
 * they are the cases that discriminate a truthiness reading from
 * `isValueUnset`'s (objectui#4873).
 *
 * DIRECTION, predicted before running: every assertion in this file is RED
 * before the change (the attribute and the description do not exist at all) and
 * green after. The 「no marker」 assertions are the exception — they pass in both
 * trees, which is what makes the positive ones worth having beside them.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { FilterBuilder } from '../custom/filter-builder';

const DATE_FIELDS = [{ value: 'declare_date', label: 'Declare date', type: 'date' }];
const NUMBER_FIELDS = [{ value: 'amount', label: 'Amount', type: 'number' }];

function renderRange(
  fields: unknown[],
  field: string,
  value: unknown,
  operator = 'between',
) {
  const onChange = vi.fn();
  const utils = render(
    <FilterBuilder
      fields={fields as any}
      value={{
        id: 'root',
        logic: 'and',
        conditions: [{ id: 'c1', field, operator, value }],
      } as any}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

/** The description the blank bound points `aria-describedby` at, if any. */
function describedText(input: HTMLElement): string | null {
  const id = input.getAttribute('aria-describedby');
  if (!id) return null;
  return document.getElementById(id)?.textContent ?? null;
}

describe('a half-filled range marks the bound that is missing', () => {
  it('marks the empty upper bound, and only it', () => {
    const { getByLabelText } = renderRange(DATE_FIELDS, 'declare_date', ['2024-01-01', '']);

    expect(getByLabelText('To').getAttribute('aria-invalid')).toBe('true');
    // The bound the author DID fill is not the problem and must not be marked —
    // a marker on both inputs would read as "this range is wrong" rather than
    // "this range is half-written".
    expect(getByLabelText('From').getAttribute('aria-invalid')).toBeNull();
  });

  it('marks the empty lower bound, and only it', () => {
    const { getByLabelText } = renderRange(DATE_FIELDS, 'declare_date', ['', '2024-03-01']);

    expect(getByLabelText('From').getAttribute('aria-invalid')).toBe('true');
    expect(getByLabelText('To').getAttribute('aria-invalid')).toBeNull();
  });

  it('describes the marked bound by NAME, on the input itself', () => {
    const { getByLabelText } = renderRange(DATE_FIELDS, 'declare_date', ['2024-01-01', '']);

    // Announced as that input's description, not as loose text somewhere near
    // it: an author using a screen reader hears which side is missing.
    expect(describedText(getByLabelText('To'))).toBe('To is required');
    expect(getByLabelText('From').getAttribute('aria-describedby')).toBeNull();
  });

  it('names the other side when the other side is the missing one', () => {
    const { getByLabelText } = renderRange(DATE_FIELDS, 'declare_date', ['', '2024-03-01']);

    expect(describedText(getByLabelText('From'))).toBe('From is required');
  });

  it('appears as the author types the first bound of an empty row', () => {
    // The live gesture the card is about: the row is untouched, the author
    // types one bound, and today nothing at all happens on screen while every
    // write path starts discarding the row.
    const { getByLabelText, rerender, onChange } = renderRange(
      DATE_FIELDS,
      'declare_date',
      [],
    );

    expect(getByLabelText('From').getAttribute('aria-invalid')).toBeNull();
    expect(getByLabelText('To').getAttribute('aria-invalid')).toBeNull();

    fireEvent.change(getByLabelText('From'), { target: { value: '2024-01-01' } });

    // `FilterBuilder` is controlled here, so feed its own answer back — the
    // padded pair the render path produces and the write paths refuse.
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.conditions[0].value).toEqual(['2024-01-01', '']);
    rerender(
      <FilterBuilder fields={DATE_FIELDS as any} value={next} onChange={onChange} />,
    );

    expect(getByLabelText('To').getAttribute('aria-invalid')).toBe('true');
    expect(describedText(getByLabelText('To'))).toBe('To is required');
  });
});

describe('a range that is NOT half-filled carries no marker', () => {
  it('a complete pair is unmarked and undescribed', () => {
    const { getByLabelText } = renderRange(DATE_FIELDS, 'declare_date', [
      '2024-01-01',
      '2024-03-01',
    ]);

    for (const label of ['From', 'To']) {
      expect(getByLabelText(label).getAttribute('aria-invalid')).toBeNull();
      expect(getByLabelText(label).getAttribute('aria-describedby')).toBeNull();
    }
  });

  it('an untouched row — BOTH bounds blank — is unmarked', () => {
    // `Add filter` draws the row this way. Nothing has been typed, so there is
    // no half-written range to report; marking it on sight is the "invalid
    // while the user is still typing" anti-pattern, and every other operator
    // starts from its own unfilled shape unmarked too.
    const { getByLabelText } = renderRange(DATE_FIELDS, 'declare_date', []);

    expect(getByLabelText('From').getAttribute('aria-invalid')).toBeNull();
    expect(getByLabelText('To').getAttribute('aria-invalid')).toBeNull();
  });

  it('a non-pair operator never renders the marker', () => {
    const { container, queryByText } = renderRange(
      DATE_FIELDS,
      'declare_date',
      '',
      'equals',
    );

    // An `equals` row with no value is just as unfinished and just as dropped,
    // and it is NOT what the ruling is about: the marker belongs to the pair
    // whose halves can disagree.
    expect(container.querySelectorAll('[aria-invalid]')).toHaveLength(0);
    expect(queryByText('To is required')).toBeNull();
    expect(queryByText('From is required')).toBeNull();
  });
});

describe('a blank bound is not a zero bound (objectui#4873)', () => {
  it('`0` as the lower bound leaves a blank upper bound the missing one', () => {
    const { getByLabelText } = renderRange(NUMBER_FIELDS, 'amount', [0, '']);

    // A truthiness reading marks `From` here — the bound the author typed —
    // and leaves the blank `To` clean, i.e. exactly backwards.
    expect(getByLabelText('From').getAttribute('aria-invalid')).toBeNull();
    expect(getByLabelText('From')).toHaveValue(0);
    expect(getByLabelText('To').getAttribute('aria-invalid')).toBe('true');
    expect(describedText(getByLabelText('To'))).toBe('To is required');
  });

  it('`0` as the upper bound leaves a blank lower bound the missing one', () => {
    const { getByLabelText } = renderRange(NUMBER_FIELDS, 'amount', ['', 0]);

    expect(getByLabelText('From').getAttribute('aria-invalid')).toBe('true');
    expect(getByLabelText('To').getAttribute('aria-invalid')).toBeNull();
    expect(getByLabelText('To')).toHaveValue(0);
  });

  it('a range that starts at `0` is complete and carries nothing', () => {
    const { getByLabelText, queryByText } = renderRange(NUMBER_FIELDS, 'amount', [0, 10]);

    expect(getByLabelText('From').getAttribute('aria-invalid')).toBeNull();
    expect(getByLabelText('To').getAttribute('aria-invalid')).toBeNull();
    expect(queryByText('From is required')).toBeNull();
    expect(queryByText('To is required')).toBeNull();
  });
});
