/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An EMPTY ARRAY is not a cell value (objectui#8474).
 *
 * ## The defect
 *
 * `hasCellValue` — THE definition of emptiness for the record page
 * (objectui#8376, widened to the package by objectui#8394, extracted to
 * `../emptiness` by objectui#8457) — opened with
 * `if (value !== null && typeof value === 'object') return true;`. `typeof []`
 * is `'object'`, so an empty array was a VALUE and nothing further was asked of
 * it.
 *
 * Its docblock's reasoning for the object half is sound and stays: an object
 * value is handed to a TYPE-AWARE renderer that knows how to draw it. But every
 * example it reasons about is a POPULATED object, and for `[]` the renderer has
 * nothing to draw. `SelectCellRenderer` tests `value == null || value === ''`,
 * which `[]` passes, and then maps it over zero entries — measured on
 * `origin/main` at `c90395b20`, the cell is
 * `<div class="flex flex-wrap gap-1"></div>`: a visually blank cell, produced by
 * the very function that exists to prevent one.
 *
 * ## The three consequences are the objectui#8376 triple, unchanged
 *
 * All three of `DetailSection`'s reads share this one function, so `[]`
 * reproduced the whole escalation. Measured before / after on the fixtures
 * below:
 *
 *   1. the row painted a blank cell — `"…tags"`, ZERO em-dashes → `"…tags—"`;
 *   2. it escaped `emptyCount` — `Show 1 empty fields` → `Show 2 empty fields`,
 *      and revealing the empty rows did not reveal it (it was never hidden);
 *   3. ⭐ `shouldAutoHideEmpty` needs only `filledCount > 0`, so a section whose
 *      ONLY non-null value was `[]` armed auto-hide by itself and buried every
 *      genuinely empty row around it: `"Detailstags" + "Show 3 empty fields"`,
 *      one label over a blank, three rows hidden → the four-row all-empty
 *      skeleton with four affordances and no toggle.
 *
 * ## Why `{}` is NOT swept in — this file measures it rather than assuming
 *
 * `THE BOUNDARY` below is the measurement, on the DOM: `{}` on a `json`, an
 * `object` and a `location` field all draw the literal `{}` through
 * `JsonCellRenderer`. That is terse, but it is DRAWN — there is no blank cell,
 * so there is no defect of the kind above, and the fix does not move it. The
 * shape that would have swept it in is separately unsafe:
 * `Object.keys(value).length === 0` is also true of a `Date`, a populated `Map`,
 * a populated `Set` and a getter-backed class instance (`MEASUREMENT` below),
 * which would be a false-empty on values that render.
 *
 * ## Would an implementation strictly worse than the bug pass?
 *
 * No, and that is the reason for three of the seven cases. A predicate
 * answering EMPTY for everything satisfies every "the `[]` row draws the
 * em-dash" assertion here, and so does one answering EMPTY for every array.
 * `NON-REGRESSION — a POPULATED array` refuses the second, `NON-REGRESSION —
 * `0` and `false`` and `THE BOUNDARY` refuse the first, and every negative
 * carries a control that rendered BY VALUE ("the affordance is absent" is
 * trivially true of a document that rendered nothing).
 *
 * ## ⛔ Direction of travel
 *
 * `RelatedList.isValueEmpty` has spelled `(Array.isArray(v) && v.length === 0)`
 * for some time; objectui#8459 / PR #8476 measured it as the better-shaped
 * answer for a grid and deliberately declined to delegate to `hasCellValue`
 * BECAUSE of this hole. The two now agree — because the SHARED authority moved
 * toward the local predicate. ⛔ Never the reverse, and `RelatedList` is not
 * touched by this card.
 *
 * ## Reading the affordance
 *
 * `DetailSection`'s placeholder carries BOTH `aria-label` and `title`; the
 * `EmptyValue` a field cell renderer draws carries `aria-label` only. The count
 * below is by TITLE — the instrument objectui#8376's pin uses — so it cannot
 * pick up a cell renderer's own placeholder by accident.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { hasCellValue } from '../emptiness';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * Desktop thresholds — `AUTO_HIDE_MIN_FIELDS` 4 and `AUTO_HIDE_RATIO` 0.25.
 * Pinned explicitly rather than inherited from happy-dom's default width: the
 * mobile variant (3 / 0.2) would change which fixtures here can fire auto-hide
 * at all, and a landed pin was once green only because of an unpinned desktop
 * default (objectui#8399).
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
 * Presence as a VALUE rather than as a `getByText` throw. `getByText` raises
 * before `expect` runs, so the explicit message never reaches the CI summary.
 */
const shown = (text: string) => screen.queryByText(text) !== null;

const objectSchema = {
  fields: {
    industry: { type: 'text', label: 'Industry' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'text', label: 'Close Date' },
    office_location: { type: 'location', label: 'Office Location' },
    payload: { type: 'json', label: 'Payload' },
    profile: { type: 'object', label: 'Profile' },
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

describe('DetailSection — an empty array is not a cell value (#8474)', () => {
  it('AFFORDANCE — an empty array draws the `No value` em-dash, not a blank cell', () => {
    // 3 fields: below `AUTO_HIDE_MIN_FIELDS` (4), so nothing is hidden and the
    // `[]` row is unambiguously ON SCREEN — an absence here could not be
    // explained away by auto-hide.
    const { container } = renderSection(['industry', 'tags', 'amount'], {
      industry: 'Manufacturing',
      tags: [],
      amount: 42,
    });

    // CONTROLS — the section rendered, and both ordinary rows rendered BY VALUE.
    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: the filled text row rendered').toBe(true);
    expect(shown('42'), 'CONTROL: the filled number row rendered').toBe(true);
    // CONTROL — the `[]` row itself is present, so the assertion below is about
    // what that row DRAWS and not about whether it exists.
    expect(shown('tags'), 'CONTROL: the empty-array row is on screen at all').toBe(true);

    expect(
      rowOf('tags').querySelector('[title="No value"]'),
      'the `tags` row must draw the `No value` affordance, not the blank `<div class="flex flex-wrap gap-1">` SelectCellRenderer produces for `[]`',
    ).not.toBeNull();
    expect(affordances(), 'exactly the `tags` row is empty').toHaveLength(1);
    expect(
      container.textContent,
      'the em-dash reached the DOM (before the fix this row rendered zero em-dashes)',
    ).toContain('—');
  });

  it('COPY AFFORDANCE — the row that says `No value` does not also offer to copy it', () => {
    // `canCopy` is `hasCellValue(value)` by design (objectui#8376): a row that
    // says `No value` must not offer to copy it. Before the fix this row carried
    // a copy button whose click wrote `[]` to the clipboard.
    renderSection(['industry', 'tags', 'amount'], {
      industry: 'Manufacturing',
      tags: [],
      amount: 42,
    });

    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    // CONTROL — a genuinely filled row DOES offer the copy affordance, so the
    // absence below is a decision about this value, not about the feature.
    expect(
      rowOf('industry').querySelector('[role="button"]'),
      'a filled row still offers click-to-copy (control)',
    ).not.toBeNull();

    expect(
      rowOf('tags').querySelector('[role="button"]'),
      'the empty-array row must not offer click-to-copy',
    ).toBeNull();
  });

  it('COUNTER — the empty-array row is counted among the empty fields, and revealing them reveals IT', () => {
    // 4 fields, 2 of them empty once `[]` counts: `tags` (`[]`) and
    // `close_date` (absent). At/above both thresholds, so auto-hide fires and
    // the toggle appears. Before the fix this read `Show 1 empty fields`.
    renderSection(['industry', 'stage', 'tags', 'close_date'], {
      industry: 'Manufacturing',
      stage: 'Won',
      tags: [],
    });

    // CONTROLS — the section rendered and kept its filled rows.
    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: filled row 1 rendered').toBe(true);
    expect(shown('Won'), 'CONTROL: filled row 2 rendered').toBe(true);

    const toggle = screen.getByRole('button', { name: /empty fields/i });
    expect(
      toggle.textContent,
      'the toggle must count the empty-array field: 2 empty fields, not 1',
    ).toContain('Show 2 empty fields');

    // It was hidden BECAUSE it was counted…
    expect(shown('tags'), 'the empty-array row is hidden along with the other empty rows').toBe(false);

    // …and revealing the empty fields brings it back, with the affordance.
    fireEvent.click(toggle);
    expect(shown('tags'), 'revealing the empty fields reveals the empty-array row').toBe(true);
    expect(shown('close_date'), 'revealing the empty fields reveals the absent row').toBe(true);
    expect(affordances(), 'both revealed rows draw the affordance').toHaveLength(2);
  });

  it('⭐ AMPLIFICATION — one empty array must not suppress the all-empty skeleton', () => {
    // The consequence that reaches furthest, and the one a single-row fixture
    // misses. 4 fields, every one of them empty except `tags`, which holds `[]`.
    // Before the fix that was `filledCount === 1`, all `shouldAutoHideEmpty`
    // needs: the section auto-hid its three genuinely empty rows and rendered
    // `"Detailstags"` + `Show 3 empty fields` — a lone label over a blank.
    renderSection(['tags', 'stage', 'amount', 'close_date'], { tags: [] });

    // CONTROL — the section rendered at all.
    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);

    // The skeleton the heuristic reserves for an all-empty section: every label
    // keeps its row, so the record reads as a structure waiting to be filled.
    for (const label of ['tags', 'stage', 'amount', 'close_date']) {
      expect(
        shown(label),
        `row \`${label}\` must survive the all-empty skeleton — one empty array must not arm auto-hide and bury the genuinely empty rows`,
      ).toBe(true);
    }
    expect(affordances(), 'all four rows draw the `No value` affordance').toHaveLength(4);

    // Nothing was hidden, so there is nothing to offer to reveal.
    expect(
      screen.queryByRole('button', { name: /empty fields/i }),
      'no rows were hidden, so no show-empty toggle is offered',
    ).toBeNull();
  });

  it('NON-REGRESSION — a POPULATED array is still a value, and so is a populated object', () => {
    // The axis that refuses `Array.isArray(value) => EMPTY` — an over-correction
    // that would satisfy every case above while deleting select badges from the
    // page. The geolocation row is the objectui#8376 / objectui#8394 axis,
    // still red for a wholesale delegation to the display-name authority.
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
    expect(shown('Alpha'), 'a POPULATED array renders its option badges, not `No value`').toBe(true);
    expect(shown('Beta'), 'a POPULATED array renders its option badges, not `No value`').toBe(true);

    expect(
      affordances(),
      'NO row here is empty — only the EMPTY array moved, not the object half',
    ).toHaveLength(0);
  });

  it('NON-REGRESSION — `0` and `false` are still values', () => {
    // The axis that refuses an emptiness test answering EMPTY for everything —
    // an implementation strictly worse than the bug, which every case above
    // would otherwise accept.
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

  it('THE BOUNDARY — `{}` is a VALUE: it DRAWS, so it did not move', () => {
    // Measured, not assumed. `{}` on `json`, `object` and `location` fields all
    // reach `JsonCellRenderer` (`location` falls back to it when the lat/lng
    // chain yields nothing) and draw the literal `{}` — terse, but drawn. No
    // blank cell, so no defect of the kind this card fixes. This case is also
    // RED for an emptiness test answering EMPTY for everything.
    const { container } = renderSection(
      ['industry', 'payload', 'profile', 'office_location'],
      { industry: 'Manufacturing', payload: {}, profile: {}, office_location: {} },
    );

    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: the ordinary filled row rendered').toBe(true);

    for (const label of ['payload', 'profile', 'office_location']) {
      expect(shown(label), `CONTROL: the \`${label}\` row is on screen`).toBe(true);
      expect(
        rowOf(label).querySelector('[title="No value"]'),
        `\`{}\` on \`${label}\` DRAWS, so it must not take the affordance branch`,
      ).toBeNull();
    }
    expect(
      (container.textContent || '').split('{}').length - 1,
      'all three `{}` cells rendered their JSON text',
    ).toBe(3);
    expect(affordances(), 'no row here is empty — `{}` is a value on this surface').toHaveLength(0);
  });

  it('DECLARED COST — a `json` field holding `[]` now draws the placeholder instead of the literal `[]`', () => {
    // The one behaviour change a reviewer should see stated rather than
    // discover. `JsonCellRenderer` DID draw `[]` for an empty array, so unlike
    // the select family this cell was never blank — it printed two characters of
    // punctuation. `No value` is the better answer for "no items", and one
    // predicate cannot tell the two field families apart by value alone. Pinned
    // so the trade is deliberate.
    const { container } = renderSection(['industry', 'payload'], {
      industry: 'Manufacturing',
      payload: [],
    });

    expect(shown('Details'), 'CONTROL: the section heading rendered').toBe(true);
    expect(shown('Manufacturing'), 'CONTROL: the ordinary filled row rendered').toBe(true);
    expect(shown('payload'), 'CONTROL: the `[]` row is on screen at all').toBe(true);

    expect(
      rowOf('payload').querySelector('[title="No value"]'),
      'a `json` field holding `[]` draws the `No value` affordance',
    ).not.toBeNull();
    expect(
      container.textContent,
      'the literal `[]` no longer reaches the DOM as a rendered value',
    ).not.toContain('[]');
  });

  /**
   * The predicate-level boundary, asserted rather than cited. An ADDITION to
   * the DOM cases above, never a substitute — the pin has to assert the
   * rendered outcome, and it does, seven times.
   */
  it('MEASUREMENT — the arm is `Array.isArray && length === 0`, and the wider shape it rejects is unsafe', () => {
    expect(hasCellValue([]), 'an EMPTY array is EMPTY').toBe(false);
    expect(hasCellValue(['alpha']), 'a POPULATED array is a value').toBe(true);
    expect(hasCellValue({}), '`{}` is a value — it draws (see THE BOUNDARY)').toBe(true);
    expect(hasCellValue({ latitude: 1, longitude: 2 }), 'a populated object is a value').toBe(true);
    expect(hasCellValue(new Date(0)), 'a Date is a value').toBe(true);
    expect(hasCellValue(0), '`0` is a value').toBe(true);
    expect(hasCellValue(false), '`false` is a value').toBe(true);

    // ⛔ Why the arm is NOT `Object.keys(value).length === 0`: that shape is
    // true of four things that render, so it would answer EMPTY for values the
    // page draws — strictly worse than the bug it set out to fix.
    class GetterBacked {
      #n = 'Ada';
      get name() { return this.#n; }
    }
    expect(Object.keys(new Date(0)), 'a Date has no OWN enumerable keys').toHaveLength(0);
    expect(Object.keys(new Map([[1, 2]])), 'a populated Map has no OWN enumerable keys').toHaveLength(0);
    expect(Object.keys(new Set([1])), 'a populated Set has no OWN enumerable keys').toHaveLength(0);
    expect(Object.keys(new GetterBacked()), 'a getter-backed instance has no OWN enumerable keys').toHaveLength(0);
    // …and all four are values here, which is the point of not using it.
    expect(hasCellValue(new Map([[1, 2]])), 'a populated Map is a value').toBe(true);
    expect(hasCellValue(new Set([1])), 'a populated Set is a value').toBe(true);
    expect(hasCellValue(new GetterBacked()), 'a getter-backed instance is a value').toBe(true);
  });
});
