/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `VALUELESS_FILTER_BUILDER_OPERATORS` states a fact about this component:
 * these are the operator ids for which it renders no value input, so a row
 * carrying one is COMPLETE with no value (objectui#4744).
 *
 * Two other packages act on that fact — `plugin-list`'s
 * `convertFilterGroupToAST` decides whether to QUERY such a row, `app-shell`'s
 * `foldFilterGroupToSpecRules` decides whether to PERSIST it — and both now
 * import the set rather than restating it. That import makes them agree with
 * the set; it does not make the set true. This file is what makes it true: it
 * drives the real render for every member and asserts the value input is
 * actually absent.
 *
 * Why that matters and is not ceremony: the previous parity check for this
 * lived in `app-shell` and read `filter-builder.tsx` as TEXT, regex-scraping
 * the literal out of `needsValueInput`. It could only ever see what the list
 * SAID. A `needsValueInput` that grew a second condition — a field type that
 * suppresses the input, an early return — would have left the scrape green and
 * the set wrong, and the consumers would have kept a row the user has no way
 * to fill in.
 *
 * DIRECTION, predicted before running: green on the fix, and green before it
 * too — this pins what must NOT change about the component. Its discriminating
 * power is the control case below (an operator NOT in the set must render an
 * input), which is what stops the sweep from passing on a builder that renders
 * no value input for anything.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  FilterBuilder,
  VALUELESS_FILTER_BUILDER_OPERATORS,
  FILTER_BUILDER_OPERATORS,
} from '../custom/filter-builder';

const FIELDS = [{ value: 'title', label: 'Title', type: 'text' }];

/** One row, one operator — the shape the panel holds while the user edits. */
function renderRow(operator: string) {
  return render(
    <FilterBuilder
      fields={FIELDS as any}
      value={{
        id: 'root',
        logic: 'and',
        // `value: ''` deliberately: the seed `addCondition` writes, and what a
        // row still carries after the operator dropdown is changed (it updates
        // `operator` alone). This is the exact state that was being discarded.
        conditions: [{ id: 'c1', field: 'title', operator, value: '' }],
      } as any}
      onChange={vi.fn()}
    />,
  );
}

/**
 * The value input is the only `<input>` the row draws — the field and operator
 * pickers are Radix selects, i.e. buttons. Counting elements rather than
 * matching a placeholder keeps this independent of the active locale.
 */
const valueInputCount = (container: HTMLElement) =>
  container.querySelectorAll('input').length;

describe('VALUELESS_FILTER_BUILDER_OPERATORS is what the builder actually draws', () => {
  it('names a non-empty set of ids the builder can draw', () => {
    // Guards the sweep below against passing on an empty set, and the set
    // against drifting off the vocabulary entirely.
    expect(VALUELESS_FILTER_BUILDER_OPERATORS.size).toBeGreaterThan(0);
    for (const operator of VALUELESS_FILTER_BUILDER_OPERATORS) {
      expect(
        FILTER_BUILDER_OPERATORS,
        `"${operator}" is in the value-less set but is not an id this builder can draw`,
      ).toContain(operator);
    }
  });

  it.each([...VALUELESS_FILTER_BUILDER_OPERATORS])(
    'renders no value input for %s',
    (operator) => {
      const { container } = renderRow(operator);
      expect(
        valueInputCount(container),
        `the builder drew a value input for "${operator}", so it is NOT value-less. `
          + 'Consumers reading VALUELESS_FILTER_BUILDER_OPERATORS will keep a row the '
          + 'user was given a field to fill in and left empty — an unfinished row '
          + 'treated as finished',
      ).toBe(0);
    },
  );

  // The control. Without it the sweep above is satisfied by a builder that
  // renders no value input at all, for any operator.
  it('renders exactly one value input for an operator that takes a value', () => {
    expect(VALUELESS_FILTER_BUILDER_OPERATORS.has('equals')).toBe(false);
    const { container } = renderRow('equals');
    expect(valueInputCount(container)).toBe(1);
  });
});
