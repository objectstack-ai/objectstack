/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6714 — `LocationField` must not EMIT a coordinate pair the
 * platform's own validator refuses.
 *
 * The defect: the widget's guard tested only that a coordinate was a finite
 * number, while `@objectstack/spec`'s `LocationValueSchema` also constrains the
 * RANGE (`lat` −90..90, `lng` −180..180). Typing `999, 999` therefore emitted
 * `{ lat: 999, lng: 999 }`, which `valueSchemaFor({ type: 'location' })`
 * refuses with `too_big` at both keys — the producer direction of the
 * contract-first failure class (AGENTS.md #0.1).
 *
 * ## Why "refuse the emission" and not "emit and mark invalid"
 *
 * Triage left the disposition to the implementer and required one measurement
 * first: does anything downstream reject or repair the value before storage?
 * It was measured by driving a REAL `ObjectForm` (create mode, a
 * `type: 'location'` field, a fake `DataSource`) and typing the card's
 * `999, 999`. `dataSource.create` was called ONCE, with
 * `{ lat: 999, lng: 999 }` verbatim; `aria-invalid` on the control was
 * `"false"` and no error text was rendered. Nothing rejects it and nothing
 * repairs it — an out-of-range pair reaches storage silently. Per the ruling,
 * refusing the emission is then the only arm that prevents the dirty write, and
 * it extends a rule this widget ALREADY applies to text that isn't a coordinate
 * pair from *format* to *range*. That end-to-end reading is pinned in
 * `packages/plugin-form/src/ObjectForm.locationRange.test.tsx`.
 *
 * ## The oracle
 *
 * Every case below is judged by the SPEC's own refusal
 * (`valueSchemaFor({ type: 'location' })`), never by a range copied into this
 * file. A hand-written `-90..90` here would keep passing on the day the spec
 * moved — which is the whole failure this card is about, reintroduced in the
 * test.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { valueSchemaFor } from '@objectstack/spec/data';

import { LocationField, type LocationValue } from '../widgets/LocationField';

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

const field = { name: 'site', label: 'Site', type: 'location' } as any;

/**
 * A stored, in-range value — the "prior value" a refusal must leave standing.
 *
 * ⚠️ It must differ from every coordinate typed below. The box is a CONTROLLED
 * input showing `"lat, lng"`, so `fireEvent.change` with text equal to what is
 * already displayed fires no change event at all — the widget would read as
 * having "refused" a perfectly legal pair, for a reason that has nothing to do
 * with this card.
 */
const STORED: LocationValue = { lat: 10, lng: 20 };

/** Render with `value` stored, type `text`, return every emission it caused. */
function emissionsFor(text: string, value: unknown = STORED): unknown[] {
  cleanup();
  const onChange = vi.fn();
  render(
    <LocationField field={field} value={value as LocationValue | null} onChange={onChange} />,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  return onChange.mock.calls.map(c => c[0]);
}

/** What the spec says about a pair, as the codes it reports. */
function specIssues(pair: unknown): string[] {
  const parsed = LOCATION_SCHEMA.safeParse(pair);
  return parsed.success
    ? []
    : parsed.error.issues.map((i: any) => `${i.code}@[${i.path.join('.')}]`);
}

/* -------------------------------------------------------------------------- */
/* The card's own three cases, with the spec's verdict asserted alongside.      */
/* -------------------------------------------------------------------------- */

describe('LocationField refuses out-of-range coordinates (objectui#6714)', () => {
  it.each([
    ['999, 999', { lat: 999, lng: 999 }, ['too_big@[lat]', 'too_big@[lng]']],
    ['91, 0', { lat: 91, lng: 0 }, ['too_big@[lat]']],
    ['0, 181', { lat: 0, lng: 181 }, ['too_big@[lng]']],
    ['-91, 0', { lat: -91, lng: 0 }, ['too_small@[lat]']],
    ['0, -181', { lat: 0, lng: -181 }, ['too_small@[lng]']],
  ])('does not emit %s', (typed, wouldHaveBeen, expectedIssues) => {
    // First: this pair really is one the platform refuses — the premise the
    // refusal rests on, asserted from the spec rather than assumed.
    expect(specIssues(wouldHaveBeen)).toEqual(expectedIssues);
    // Then: the widget never hands it to `onChange`.
    expect(emissionsFor(typed)).toEqual([]);
  });

  it('leaves the previously stored value standing, exactly as a bad FORMAT does', () => {
    // The rule being extended, shown as one rule: text that is not a coordinate
    // pair and a pair the spec refuses are both simply not emitted, and neither
    // disturbs the value already stored.
    expect(emissionsFor('not a coordinate')).toEqual([]);
    expect(emissionsFor('999, 999')).toEqual([]);
  });

  it('refuses an infinite coordinate, which the finiteness gate alone let through', () => {
    // `parseFloat('Infinity')` is `Infinity` and `!isNaN(Infinity)` is `true`,
    // so the pre-existing format gate accepted it. `z.number()` does not.
    expect(specIssues({ lat: Infinity, lng: 0 })).not.toEqual([]);
    expect(emissionsFor('Infinity, 0')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The other direction: the refusal must not cost any legal coordinate.        */
/* -------------------------------------------------------------------------- */

describe('LocationField still emits every coordinate the spec accepts (objectui#6714)', () => {
  it.each([
    ['30.2741, 120.1551', { lat: 30.2741, lng: 120.1551 }],
    // The inclusive bounds themselves — the poles and the antimeridian are real
    // places, and an off-by-one in the guard would silently make them untypable.
    ['90, 180', { lat: 90, lng: 180 }],
    ['-90, -180', { lat: -90, lng: -180 }],
    ['0, 0', { lat: 0, lng: 0 }],
  ])('emits %s', (typed, expected) => {
    expect(specIssues(expected)).toEqual([]);
    expect(emissionsFor(typed)).toEqual([expected]);
  });

  it('clearing the box still emits null', () => {
    // Unrelated to range, and the one emission that is deliberately not a
    // `LocationValue` at all — pinned so the new gate cannot swallow it.
    expect(emissionsFor('')).toEqual([null]);
  });

  it('still carries the optional keys across an in-range edit (objectui#6664)', () => {
    // The gate is applied to the WHOLE emitted object, so this is the pin that
    // it did not start rejecting the keys #6664 just taught it to carry.
    expect(emissionsFor('31.2304, 121.4737', { lat: 30.2741, lng: 120.1551, altitude: 5, accuracy: 12 }))
      .toEqual([{ lat: 31.2304, lng: 121.4737, altitude: 5, accuracy: 12 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* The property the card actually asks for, stated once against the oracle.    */
/* -------------------------------------------------------------------------- */

describe('LocationField emits a value iff the spec accepts it (objectui#6714)', () => {
  it('agrees with `valueSchemaFor({ type: "location" })` on every case above', () => {
    const cases: Array<[string, { lat: number; lng: number }]> = [
      ['999, 999', { lat: 999, lng: 999 }],
      ['91, 0', { lat: 91, lng: 0 }],
      ['0, 181', { lat: 0, lng: 181 }],
      ['-91, 0', { lat: -91, lng: 0 }],
      ['0, -181', { lat: 0, lng: -181 }],
      ['90, 180', { lat: 90, lng: 180 }],
      ['-90, -180', { lat: -90, lng: -180 }],
      ['0, 0', { lat: 0, lng: 0 }],
      ['30.2741, 120.1551', { lat: 30.2741, lng: 120.1551 }],
    ];
    for (const [typed, pair] of cases) {
      const specAccepts = LOCATION_SCHEMA.safeParse(pair).success;
      const emitted = emissionsFor(typed);
      expect(
        emitted.length === 1,
        `typed "${typed}": spec ${specAccepts ? 'ACCEPTS' : 'REJECTS'} it, widget ${emitted.length ? 'emitted' : 'refused'}`,
      ).toBe(specAccepts);
    }
  });

  it('never emits anything the spec would refuse, whatever it was handed', () => {
    // The invariant in its strongest form: sweep the emissions and re-parse
    // each one. A future edit that widens the gate fails here.
    const typedTexts = [
      '999, 999', '91, 0', '0, 181', '-91, 0', '0, -181', 'Infinity, 0',
      '90, 180', '-90, -180', '0, 0', '30.2741, 120.1551', '12, 34',
    ];
    for (const typed of typedTexts) {
      for (const emitted of emissionsFor(typed)) {
        expect(LOCATION_SCHEMA.safeParse(emitted).success, `emitted for "${typed}"`).toBe(true);
      }
    }
  });
});
