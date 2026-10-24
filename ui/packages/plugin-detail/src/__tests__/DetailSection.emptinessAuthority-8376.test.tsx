/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DetailSection` has ONE definition of emptiness, and it TRIMS (objectui#8376).
 *
 * ## The defect
 *
 * The file decided emptiness three times — `isEmptyValue` (the row filter behind
 * `emptyCount`, the toggle and the auto-hide heuristic), the `isEmpty` branch of
 * `displayValue` (the em-dash `No value` affordance) and `canCopy` — each with a
 * raw `null | undefined | ''` test. None trimmed, while `@object-ui/core`'s
 * `recordDisplayValueAt` (the page H1's definition, and since objectui#8350 the
 * `record:details` dedupe ladder's) does. So a whitespace-only value was FILLED
 * here and EMPTY everywhere else in the same render path.
 *
 * Three consequences, pinned below in order of how far they reach:
 *   1. the row painted a visually blank cell instead of the affordance the
 *      em-dash exists to provide;
 *   2. it escaped `emptyCount`, so the toggle read one too low AND revealing the
 *      empty rows did not reveal it (it was never hidden — never counted);
 *   3. ⭐ `shouldAutoHideEmpty` only needs `filledCount > 0`, so ONE such value
 *      suppressed the all-empty skeleton and hid EVERY genuinely empty row in
 *      its section — on a page a reader would describe as blank.
 *
 * ## Why the fix delegates for scalars and does NOT for objects
 *
 * `recordDisplayValueAt` answers "does this resolve to a NAME": an object value
 * goes through the Salesforce-style `displayNameOfEmbeddedObject` chain and is
 * EMPTY when that yields nothing. Right for a title; wrong for a CELL, where an
 * object is handed to a type-aware cell renderer that knows how to draw it.
 * `NON-REGRESSION — object-valued cells` is that measurement: those two rows are
 * populated on screen and carry no name-ish key, so they are exactly what a
 * wholesale delegation would have turned into `No value`. That case is RED for a
 * fix that delegates the object half, and it is why the fix delegates the scalar
 * half only.
 *
 * ## Controls
 *
 * "The affordance is absent" and "the row is not on screen" are both trivially
 * true of a document that rendered nothing, so every case asserts the section
 * heading plus at least one row BY VALUE. `NON-REGRESSION — a real value is
 * still a value` is the case that goes red for an emptiness test answering EMPTY
 * for everything (i.e. for deleting the feature), which every other case here
 * would otherwise accept.
 *
 * ## Reading the affordance
 *
 * `DetailSection`'s placeholder carries BOTH `aria-label` and `title`; the
 * `EmptyValue` that field cell renderers draw carries `aria-label` only. So the
 * count below is by TITLE — the same instrument
 * `record-details.emptySectionDefault.test.tsx` uses — and it cannot pick up a
 * cell renderer's own placeholder by accident.
 *
 * ## Interaction with objectui#8350's landed pin
 *
 * `record-details.dedupeEmptinessTrims-8350.test.tsx` deliberately keeps every
 * fixture at ≤3 rendered rows so auto-hide CANNOT fire and confound it. These
 * fixtures do the opposite on purpose (case 3 and case 4 run 4-row sections to
 * drive `shouldAutoHideEmpty`), which is why they live in a separate file with
 * their own thresholds asserted: nothing here changes the row count of any
 * fixture there.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { recordDisplayValueAt } from '@object-ui/core';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * Desktop thresholds — `AUTO_HIDE_MIN_FIELDS` 4 and `AUTO_HIDE_RATIO` 0.25.
 * Pinned explicitly rather than inherited from happy-dom's default width,
 * because the mobile variant (3 / 0.2) would change which fixtures below can
 * fire auto-hide at all.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(cleanup);

/** The placeholder `DetailSection` itself draws — by TITLE, see the docblock. */
const affordances = () => screen.queryAllByTitle('No value');

/** The row `<div>` a field label sits in (label div → row div). */
const rowOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;

/**
 * Presence as a VALUE rather than as a `getByText` throw.
 *
 * `getByText` raises `TestingLibraryElementError` before `expect` runs, so its
 * one-line CI summary reads "Unable to find an element with the text: stage" and
 * carries none of the reason. Measured on this file's own ablation: the ⭐
 * amplification case reddened with exactly that line and said nothing about the
 * skeleton. Read through `expect` instead and the summary is the message below.
 */
const shown = (text: string) => screen.queryByText(text) !== null;

const objectSchema = {
  fields: {
    industry: { type: 'text', label: 'Industry' },
    stage: { type: 'text', label: 'Stage' },
    notes: { type: 'text', label: 'Notes' },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'text', label: 'Close Date' },
    office_location: { type: 'location', label: 'Office Location' },
    tags: {
      type: 'multiselect',
      label: 'Tags',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
    },
  },
};

const sectionOf = (fields: string[]): DetailViewSection =>
  ({ title: 'Details', fields: fields.map((name) => ({ name })) }) as DetailViewSection;

const renderSection = (fields: string[], data: Record<string, unknown>) =>
  render(<DetailSection section={sectionOf(fields)} data={data} objectSchema={objectSchema} />);

describe('DetailSection — one definition of emptiness, and it trims (#8376)', () => {
  it('AFFORDANCE — a whitespace-only value draws the `No value` em-dash, not a blank cell', () => {
    // 3 fields: below `AUTO_HIDE_MIN_FIELDS` (4), so nothing is hidden and the
    // whitespace row is unambiguously ON SCREEN — an absence here could not be
    // explained away by auto-hide.
    const { container } = renderSection(['industry', 'notes', 'amount'], {
      industry: 'Manufacturing',
      notes: '   ',
      amount: 42,
    });

    // CONTROLS — the section rendered, and both ordinary rows rendered by value.
    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: the filled text row rendered').toBe(true);
    expect(shown('42'), 'CONTROL: the filled number row rendered').toBe(true);
    // CONTROL — the whitespace row itself is present, so the assertion below is
    // about what that row DRAWS and not about whether it exists.
    expect(shown('notes'), 'CONTROL: the whitespace-only row is on screen at all').toBe(true);

    expect(
      rowOf('notes').querySelector('[title="No value"]'),
      'the `notes` row must draw the `No value` affordance, not a blank cell',
    ).not.toBeNull();
    expect(affordances(), 'exactly the `notes` row is empty').toHaveLength(1);
    // The blank cell the affordance exists to prevent: before the fix this row
    // took the cell-renderer path and printed the raw spaces.
    expect(
      container.textContent,
      'the raw whitespace must not reach the DOM as a rendered value',
    ).not.toMatch(/ {3}/);
  });

  it('COPY AFFORDANCE — the row that says `No value` does not also offer to copy it', () => {
    // `canCopy` was the THIRD raw spelling in this file. Fixing only the
    // affordance would have put a copy button next to an em-dash whose click
    // copies three spaces to the clipboard.
    renderSection(['industry', 'notes', 'amount'], {
      industry: 'Manufacturing',
      notes: '   ',
      amount: 42,
    });

    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    // CONTROL — a genuinely filled row DOES offer the copy affordance, so the
    // absence below is a decision about this value and not about the feature.
    expect(
      rowOf('industry').querySelector('[role="button"]'),
      'a filled row still offers click-to-copy (control)',
    ).not.toBeNull();

    expect(
      rowOf('notes').querySelector('[role="button"]'),
      'the whitespace-only row must not offer click-to-copy',
    ).toBeNull();
  });

  it('COUNTER — the whitespace-only row is counted among the empty fields, and revealing them reveals IT', () => {
    // 4 fields, 2 of them empty once whitespace counts: `close_date` (absent)
    // and `notes` ('   '). At/above both thresholds, so auto-hide fires and the
    // toggle appears.
    renderSection(['industry', 'stage', 'notes', 'close_date'], {
      industry: 'Manufacturing',
      stage: 'Won',
      notes: '   ',
    });

    // CONTROLS — the section rendered and kept its filled rows.
    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: filled row 1 rendered').toBe(true);
    expect(shown('Won'), 'CONTROL: filled row 2 rendered').toBe(true);

    const toggle = screen.getByRole('button', { name: /empty fields/i });
    expect(
      toggle.textContent,
      'the toggle must count the whitespace-only field: 2 empty fields, not 1',
    ).toContain('Show 2 empty fields');

    // It was hidden BECAUSE it was counted…
    expect(
      shown('notes'),
      'the whitespace-only row is hidden along with the other empty rows',
    ).toBe(false);

    // …and revealing the empty fields brings it back, with the affordance.
    fireEvent.click(toggle);
    expect(shown('notes'), 'revealing the empty fields reveals the whitespace-only row').toBe(true);
    expect(shown('close_date'), 'revealing the empty fields reveals the absent row').toBe(true);
    expect(affordances(), 'both revealed rows draw the affordance').toHaveLength(2);
  });

  it('⭐ AMPLIFICATION — one whitespace-only value must not suppress the all-empty skeleton', () => {
    // The consequence that reaches furthest. 4 fields, every one of them empty
    // except `notes`, which holds only spaces. Under the raw test that was
    // `filledCount === 1`, which is all `shouldAutoHideEmpty` needs: the section
    // auto-hid its three genuinely empty rows and rendered a single blank cell.
    renderSection(['notes', 'stage', 'amount', 'close_date'], { notes: '   ' });

    // CONTROL — the section rendered at all (the early return for an all-empty
    // section with nothing visible would have dropped it entirely).
    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);

    // The skeleton the heuristic reserves for an all-empty section: every label
    // keeps its row, so the record reads as a structure waiting to be filled.
    for (const label of ['notes', 'stage', 'amount', 'close_date']) {
      expect(
        shown(label),
        `row \`${label}\` must survive the all-empty skeleton — one whitespace-only value must not arm auto-hide and bury the genuinely empty rows`,
      ).toBe(true);
    }
    expect(affordances(), 'all four rows draw the `No value` affordance').toHaveLength(4);

    // Nothing was hidden, so there is nothing to offer to reveal.
    expect(
      screen.queryByRole('button', { name: /empty fields/i }),
      'no rows were hidden, so no show-empty toggle is offered',
    ).toBeNull();
  });

  it('NON-REGRESSION — object-valued cells are still FILLED (the half that must NOT delegate)', () => {
    // `recordDisplayValueAt` calls both of these EMPTY — neither carries a
    // name-ish key for `displayNameOfEmbeddedObject` — yet both render real
    // content through their type-aware cell renderer. Delegating the object half
    // would replace them with `No value`, drop them out of `filledCount` and let
    // auto-hide bury them. This case is that measurement, on the DOM.
    const { container } = renderSection(['office_location', 'tags', 'industry'], {
      office_location: { latitude: 30.2741, longitude: 120.1551 },
      tags: ['alpha', 'beta'],
      industry: 'Manufacturing',
    });

    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: the ordinary filled row rendered').toBe(true);

    expect(
      container.textContent,
      'a geolocation object renders as coordinates, not as `No value`',
    ).toContain('30.2741, 120.1551');
    expect(shown('Alpha'), 'a multiselect array renders its options, not `No value`').toBe(true);
    expect(shown('Beta'), 'a multiselect array renders its options, not `No value`').toBe(true);

    expect(
      affordances(),
      'NO row here is empty — an object value is a value on this surface',
    ).toHaveLength(0);
  });

  it('NON-REGRESSION — a real value is still a value (`0`, `false`, and a plain string)', () => {
    // The case that is RED for an emptiness test answering EMPTY for everything.
    // Every other case in this file is satisfied by deleting the feature; this
    // one is not, and `0` / `false` are the two the raw test got right and a
    // careless rewrite (`!value`) would get wrong.
    renderSection(['industry', 'amount', 'stage', 'close_date'], {
      industry: 'Manufacturing',
      amount: 0,
      stage: false,
    });

    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'a plain string is a value').toBe(true);

    // 4 fields with exactly ONE empty row (`close_date`), so auto-hide fires and
    // hides it: `0` and `false` are on the FILLED side of the count.
    // `detail.showEmptyFields` is a count family since objectui#11445, so ONE
    // empty row reads the singular — the `$` anchor keeps the plural out.
    const toggle = screen.getByRole('button', { name: /empty fields?$/i });
    expect(
      toggle.textContent,
      '`0` and `false` are values: exactly one field (`close_date`) is empty',
    ).toMatch(/Show 1 empty field$/);
    expect(affordances(), 'no visible row draws the affordance').toHaveLength(0);
    expect(shown('amount'), '`0` keeps its row and is not hidden as empty').toBe(true);
    expect(shown('stage'), '`false` keeps its row and is not hidden as empty').toBe(true);
  });

  /**
   * The measurement behind the split, asserted rather than cited.
   *
   * This is an ADDITION to the DOM cases above, never a substitute — on its own
   * it is a predicate test, and the card is explicit that the pin has to assert
   * the rendered outcome. It is green on `origin/main` with the defect fully
   * present, because it measures `@object-ui/core`, not this component.
   */
  it('MEASUREMENT — the authority answers the cell\'s question for scalars and a DIFFERENT one for objects', () => {
    // Scalars — exactly what this surface wants, which is why it delegates.
    expect(recordDisplayValueAt({ value: '   ' }, 'value'), 'whitespace-only is EMPTY').toBeUndefined();
    expect(recordDisplayValueAt({ value: '' }, 'value'), 'empty string is EMPTY').toBeUndefined();
    expect(recordDisplayValueAt({ value: null }, 'value'), 'null is EMPTY').toBeUndefined();
    expect(recordDisplayValueAt({ value: 0 }, 'value'), '`0` is a value').toBe('0');
    expect(recordDisplayValueAt({ value: false }, 'value'), '`false` is a value').toBe('false');

    // Objects — the authority answers "does this resolve to a NAME", so both of
    // the populated fixtures used above come back EMPTY. That is correct for a
    // title and wrong for a cell; it is the whole reason the object half is not
    // delegated.
    expect(
      recordDisplayValueAt({ value: { latitude: 30.2741, longitude: 120.1551 } }, 'value'),
      'a geolocation object has no display NAME — the authority calls it empty',
    ).toBeUndefined();
    expect(
      recordDisplayValueAt({ value: ['alpha', 'beta'] }, 'value'),
      'an option array has no display NAME — the authority calls it empty',
    ).toBeUndefined();
  });
});
