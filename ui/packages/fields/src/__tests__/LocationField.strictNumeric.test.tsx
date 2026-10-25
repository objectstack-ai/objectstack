/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6715 — `LocationField` must not INVENT a coordinate out of text
 * that is only partly a number.
 *
 * The defect: the widget read each half of the typed pair with a bare
 * `parseFloat`, which stops at the first character it cannot read and returns
 * what it got. So `"12abc, 34"` emitted `{ lat: 12, lng: 34 }` — a coordinate
 * nobody typed.
 *
 * ## Why the platform validator cannot be the oracle here
 *
 * This is what separates the card from objectui#6714, and it is asserted
 * rather than asserted-by-comment below: every one of those truncated
 * emissions is a pair `valueSchemaFor({ type: 'location' })` ACCEPTS. #6714's
 * `999, 999` was at least a value the contract refuses, so something
 * downstream could in principle have caught it; a truncation is well-formed,
 * in range, and WRONG. Nothing downstream can ever object, which is why the
 * refusal has to happen at the point of typing.
 *
 * ## What was measured on the base commit (`b76ca6764`), before the fix
 *
 * Driving a real `ObjectForm` (create mode, a `type: 'location'` field, a fake
 * `DataSource`) and typing each text, then submitting:
 *
 * ```
 * typed "12abc, 34"    stored {"lat":12,"lng":34}    aria-invalid=false
 * typed "1.2.3, 4"     stored {"lat":1.2,"lng":4}    aria-invalid=false
 * typed "12deg, 34"    stored {"lat":12,"lng":34}    aria-invalid=false
 * typed "0x10, 34"     stored {"lat":0,"lng":34}     aria-invalid=false
 * typed "12.5 N, 34 E" stored {"lat":12.5,"lng":34}  aria-invalid=false
 * ```
 *
 * The last two are the ones that show the size of the class. `0x10` truncates
 * to `0` — objectui#6272's `|| 0` in the Gulf of Guinea, arriving through a
 * different door — and `"12.5 N, 34 E"`, the PASTE shape triage guessed the
 * real user route to be, drops the hemisphere, so a southern coordinate would
 * be stored as a northern one. That end-to-end reading is pinned in
 * `packages/plugin-form/src/ObjectForm.locationResidue.test.tsx`.
 *
 * ## The ruling this implements, and its fence
 *
 * The maintainer ruling of 2026-08-29 adopts REFUSAL: text carrying
 * non-numeric residue is a non-coordinate and is refused loudly, never
 * silently truncated. It applies objectui#6272's precedent — "a field that
 * renders a plausible wrong place is worse than one that renders nothing".
 *
 * ⛔ Degree/hemisphere notation parsing (`12°N, 34°E`) is deliberately NOT
 * ruled and NOT built: the paste route is unmeasured, and it becomes its own
 * feature card if real demand arrives. The last describe block is the pin that
 * it was not smuggled in.
 *
 * ## Where the refusal is announced
 *
 * Through the SAME `refusalError` machinery objectui#6716 landed minutes
 * earlier, not a new one — that sequencing is why this card was held. A third
 * silent refusal would have re-opened the defect #6716 had just closed, on a
 * third input class. The pre-existing arms are pinned here as UNDISTURBED.
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
 * ⚠️ It must differ from every coordinate typed below: the box is a CONTROLLED
 * input, so `fireEvent.change` with text equal to what is already displayed
 * fires no change event at all.
 */
const STORED: LocationValue = { lat: 10, lng: 20 };

function box(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

/** The widget's own refusal line, or `null` when it is announcing nothing. */
function diagnostic(container: HTMLElement): string | null {
  const p = container.querySelector('p');
  return p ? p.textContent : null;
}

function typeInto(text: string, value: unknown = STORED) {
  cleanup();
  const onChange = vi.fn();
  const { container } = render(
    <LocationField field={field} value={value as LocationValue | null} onChange={onChange} />,
  );
  fireEvent.change(box(), { target: { value: text } });
  return {
    container,
    emissions: onChange.mock.calls.map(c => c[0]),
    ariaInvalid: box().getAttribute('aria-invalid'),
    domValue: box().value,
    message: diagnostic(container),
  };
}

/** The exact sentence the pre-existing FORMAT arm draws (objectui#6716). */
const FORMAT_MESSAGE = 'Not saved: enter a latitude, longitude pair (example: 30.2741, 120.1551).';

/**
 * What the SPEC says about a pair, rendered the way the RANGE arm renders it.
 *
 * ⛔ Never typed out with `90` / `180` in it — a bound copied into this file is
 * a second contract that keeps passing on the day the schema moves.
 */
function expectedRangeMessage(pair: unknown): string {
  const parsed = LOCATION_SCHEMA.safeParse(pair);
  if (parsed.success) throw new Error('expectedRangeMessage called on a pair the spec ACCEPTS');
  const detail = parsed.error.issues
    .map((i: any) => `${i.path.join('.') || 'value'}: ${i.message}`)
    .join('; ');
  return `Not saved: ${detail}`;
}

/** What a bare `parseFloat` WOULD have made of this text — the old reading. */
function truncationOf(text: string): { lat: number; lng: number } {
  const parts = text.split(',').map(p => p.trim());
  return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
}

/* -------------------------------------------------------------------------- */
/* 1. The card's own three: residue is refused, and announced.                 */
/* -------------------------------------------------------------------------- */

describe('LocationField refuses a partly-numeric coordinate (objectui#6715)', () => {
  it.each([
    ['12abc, 34', 'latitude', '12abc'],
    ['1.2.3, 4', 'latitude', '1.2.3'],
    ['12deg, 34', 'latitude', '12deg'],
  ])('%s emits nothing and says which half it could not read', (typed, label, half) => {
    // The premise the whole card rests on, asserted rather than assumed: the
    // value the OLD reading would have emitted is one the platform ACCEPTS, so
    // no downstream check could ever have caught it.
    expect(LOCATION_SCHEMA.safeParse(truncationOf(typed)).success).toBe(true);

    const r = typeInto(typed);
    expect(r.emissions).toEqual([]);
    expect(r.ariaInvalid).toBe('true');
    expect(r.message).toContain(`${label} "${half}"`);
    expect(r.message).toContain('Not saved:');
    // The refused text stays in the box, so the message has something to point
    // at — objectui#6716's shape, inherited rather than reinvented.
    expect(r.domValue).toBe(typed);
  });

  it('names BOTH halves when both carry residue', () => {
    const r = typeInto('12abc, 34xyz');
    expect(r.emissions).toEqual([]);
    expect(r.message).toBe(
      'Not saved: latitude "12abc" and longitude "34xyz" are not numbers. ' +
        'Enter plain decimals (example: 30.2741, 120.1551).',
    );
  });

  it('names only the offending half when the other one is fine', () => {
    const r = typeInto('30.27, 120abc');
    expect(r.message).toBe(
      'Not saved: longitude "120abc" is not a number. Enter plain decimals (example: 30.2741, 120.1551).',
    );
    expect(r.message).not.toContain('latitude');
  });

  it('does not disturb the value already stored', () => {
    const r = typeInto('12abc, 34');
    expect(r.emissions).toEqual([]);
    // Nothing was emitted, so nothing replaced STORED — the same rule the
    // format and range arms follow.
    expect(LOCATION_SCHEMA.safeParse(STORED).success).toBe(true);
  });

  it('clears the announcement once the residue is corrected, and then emits', () => {
    cleanup();
    const onChange = vi.fn();
    const { container } = render(
      <LocationField field={field} value={STORED} onChange={onChange} />,
    );
    fireEvent.change(box(), { target: { value: '12abc, 34' } });
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(diagnostic(container)).not.toBeNull();

    fireEvent.change(box(), { target: { value: '30.2741, 120.1551' } });
    expect(box()).toHaveAttribute('aria-invalid', 'false');
    expect(diagnostic(container)).toBeNull();
    expect(onChange.mock.calls.map(c => c[0])).toEqual([{ lat: 30.2741, lng: 120.1551 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The residue class is wider than the three the card names.                */
/* -------------------------------------------------------------------------- */

describe('LocationField refuses every truncation, not just the obvious junk (objectui#6715)', () => {
  it.each([
    // A hex literal: `parseFloat('0x10')` is 0 — objectui#6272's `|| 0`, and a
    // real place in the Gulf of Guinea, reached through a different door.
    ['0x10, 34'],
    ['0b11, 34'],
    // Digit-grouping and a half-typed exponent.
    ['1_000, 34'],
    ['1e, 2'],
    // Two numbers where one was expected.
    ['12 34, 56'],
    // The PASTE shapes triage guessed the real user route to be. Today these
    // silently DROP the hemisphere — `12.5 S` would store as `+12.5`.
    ['12deg, 34deg'],
    ['12.5 N, 34 E'],
  ])('%s is refused instead of truncated', typed => {
    // Same premise as above: the old reading produced a pair the spec accepts.
    const wouldHaveBeen = truncationOf(typed);
    expect(Number.isNaN(wouldHaveBeen.lat) || Number.isNaN(wouldHaveBeen.lng)).toBe(false);
    expect(LOCATION_SCHEMA.safeParse(wouldHaveBeen).success).toBe(true);

    const r = typeInto(typed);
    expect(r.emissions).toEqual([]);
    expect(r.ariaInvalid).toBe('true');
    expect(r.message).toContain('Not saved:');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The other direction — the boundary, stated explicitly.                   */
/* -------------------------------------------------------------------------- */

describe('LocationField still accepts every WHOLE-STRING number (objectui#6715)', () => {
  it.each([
    ['30.27, 120.15', { lat: 30.27, lng: 120.15 }],
    // The pin the card asks for by name: this is what catches an over-strict
    // parse, and it is the emission that must be byte-for-byte what it is today.
    ['30.2741, 120.1551', { lat: 30.2741, lng: 120.1551 }],
    // Negatives — the southern and western hemispheres.
    ['-30.27, -120.15', { lat: -30.27, lng: -120.15 }],
    // A leading `+`, which `parseFloat` reads today.
    ['+30.27, +120.15', { lat: 30.27, lng: 120.15 }],
    // Leading and trailing whitespace, around each half and around the pair.
    ['   30.27 ,  120.15   ', { lat: 30.27, lng: 120.15 }],
    // Exponent form, in both spellings, since `parseFloat` accepts it today.
    ['3.027e1, 1.2015e2', { lat: 30.27, lng: 120.15 }],
    ['3.027E1, -1.2015E2', { lat: 30.27, lng: -120.15 }],
    ['1.5e-3, 4', { lat: 0.0015, lng: 4 }],
    // A bare decimal point on either side of the digits — both are numbers
    // JS reads whole, and both occur mid-typing.
    ['.5, .25', { lat: 0.5, lng: 0.25 }],
    ['-.5, +.25', { lat: -0.5, lng: 0.25 }],
    ['30., 120.', { lat: 30, lng: 120 }],
    // Integers, the plainest form of all.
    ['0, 0', { lat: 0, lng: 0 }],
    ['90, 180', { lat: 90, lng: 180 }],
    ['-90, -180', { lat: -90, lng: -180 }],
  ])('%s still emits exactly what it emits today', (typed, expected) => {
    const r = typeInto(typed, null);
    expect(r.emissions).toEqual([expected]);
    expect(r.message).toBeNull();
    expect(r.ariaInvalid).toBe('false');
  });

  /**
   * The property behind that table, so a future widening of the grammar cannot
   * pass by adding a row: for every half this widget calls a number, JS's own
   * whole-string reading (`Number`) must agree with `parseFloat`'s.
   *
   * That is the ONE-DIRECTIONAL check that matters here — it fails the moment
   * the gate starts accepting residue (`Number('12abc')` is `NaN`, while
   * `parseFloat('12abc')` is `12`). It is deliberately not the definition:
   * `Number` also reads `'0x10'` as `16` and `''` as `0`, which is why the
   * widget does not use it as the test.
   */
  it('every accepted half is a number JS reads whole', () => {
    // Every half is within the LATITUDE range, so the only thing that can
    // refuse it is the numeric gate under test — not objectui#6714's range arm.
    const accepted = [
      '30.27', '-30.27', '+30.27', '3.027e1', '8.5E1', '1.5e-3',
      '.5', '-.5', '+.25', '30.', '0', '90', '-90',
    ];
    for (const half of accepted) {
      const r = typeInto(`${half}, 0`, null);
      expect(r.emissions.length, `half "${half}" was refused`).toBe(1);
      expect(Number(half), `half "${half}"`).toBe(parseFloat(half));
    }
  });

  it('clearing the box still emits null', () => {
    const r = typeInto('');
    expect(r.emissions).toEqual([null]);
    expect(r.message).toBeNull();
  });

  it('still carries the optional keys across a clean edit (objectui#6664)', () => {
    const r = typeInto('31.2304, 121.4737', { lat: 30.2741, lng: 120.1551, altitude: 5, accuracy: 12 });
    expect(r.emissions).toEqual([{ lat: 31.2304, lng: 121.4737, altitude: 5, accuracy: 12 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The objectui#6716 arms are NOT disturbed.                                */
/* -------------------------------------------------------------------------- */

describe('LocationField leaves the pre-existing refusal arms exactly as they were (objectui#6716)', () => {
  it('text with no number in it at all still gets the FORMAT sentence', () => {
    // `parseFloat` reads NOTHING here, so this never reaches the new gate. The
    // split is deliberate: "no number at the front" and "a number with text
    // after it" are different mistakes and get different advice.
    for (const typed of ['not a coordinate', 'here, there', '--1, 2', '(12), 34']) {
      const r = typeInto(typed);
      expect(r.emissions, typed).toEqual([]);
      expect(r.message, typed).toBe(FORMAT_MESSAGE);
      expect(r.ariaInvalid, typed).toBe('true');
    }
  });

  it('a non-pair still gets the FORMAT sentence', () => {
    for (const typed of ['30.27', '30.27, 120.15, 5']) {
      const r = typeInto(typed);
      expect(r.emissions, typed).toEqual([]);
      expect(r.message, typed).toBe(FORMAT_MESSAGE);
    }
  });

  it.each([
    ['999, 999', { lat: 999, lng: 999 }],
    ['91, 0', { lat: 91, lng: 0 }],
    ['0, 181', { lat: 0, lng: 181 }],
    ['-91, 0', { lat: -91, lng: 0 }],
    ['0, -181', { lat: 0, lng: -181 }],
  ])('%s still gets the RANGE sentence, built from the spec', (typed, pair) => {
    const r = typeInto(typed);
    expect(r.emissions).toEqual([]);
    expect(r.message).toBe(expectedRangeMessage(pair));
  });

  /**
   * The one boundary decision inside this card that could have moved an
   * existing arm, made deliberately and pinned so it cannot drift.
   *
   * `Infinity` carries NO residue — `parseFloat` reads the whole word — so the
   * new gate has nothing to say about it and it goes on to the RANGE arm,
   * which is where objectui#6714 put it and what that card's docblock in
   * `LocationField.tsx` still describes. A strictness that swallowed it here
   * would have silently invalidated a minutes-old explanation while keeping
   * every "no emission" pin green.
   */
  it('an infinite coordinate is still refused by the RANGE arm, not the new one', () => {
    const r = typeInto('Infinity, 0');
    expect(r.emissions).toEqual([]);
    expect(r.message).toBe(expectedRangeMessage({ lat: Infinity, lng: 0 }));
    expect(r.message).not.toContain('is not a number');
  });

  it('a HOST-produced error is still the host\'s alone (objectui#3222)', () => {
    cleanup();
    const { container } = render(
      <LocationField
        field={field}
        value={STORED}
        onChange={vi.fn()}
        {...({ error: 'Host says this field is required' } as any)}
      />,
    );
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(container.textContent).not.toContain('Host says this field is required');
    expect(diagnostic(container)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 5. The ruling's fence: no degree/hemisphere parsing was smuggled in.        */
/* -------------------------------------------------------------------------- */

describe('LocationField does NOT parse degree or hemisphere notation (objectui#6715 ruling)', () => {
  it.each([
    ['12°N, 34°E'],
    ['12.5 N, 34 E'],
    ['12° 30\' N, 34° 15\' E'],
    ['12 N, 34 E'],
  ])('%s is refused, not converted', typed => {
    const r = typeInto(typed);
    // Nothing emitted: the notation was not learned, which is the ruling.
    expect(r.emissions).toEqual([]);
    expect(r.ariaInvalid).toBe('true');
  });

  it('advises plain decimals rather than the notation it refuses', () => {
    const r = typeInto('12\u00b0N, 34\u00b0E');
    // Nothing emitted: the notation was not learned, which is the ruling.
    expect(r.emissions).toEqual([]);
    // The ADVICE names the form this widget does read. Degree symbols do appear
    // in the sentence, but only as the echo of what was typed — the guidance
    // itself must never point at a route this widget refuses, or it would
    // promise the very parse the ruling declined.
    expect(r.message).toContain('Enter plain decimals (example: 30.2741, 120.1551).');
    const advice = r.message!.slice(r.message!.indexOf('Enter plain decimals'));
    expect(advice).not.toContain('\u00b0');
  });
});
