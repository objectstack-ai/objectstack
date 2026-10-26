/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6664 — editing the coordinate pair must not silently drop the
 * spec's two optional keys.
 *
 * `@objectstack/spec` declares the stored shape of a `type: 'location'` value
 * as `{ lat, lng, altitude?, accuracy? }`. `LocationField` edits the pair as
 * one comma-separated text box and built its emission as a fresh `{ lat, lng }`
 * from the parsed text, so a stored `altitude` / `accuracy` vanished the moment
 * a user retyped the coordinates. Nothing warned; the two keys simply were not
 * in the emitted object.
 *
 * The drop PREDATES objectui#6272 — before that flip the widget emitted
 * `{ latitude, longitude }` and discarded the rest identically. #6272 changed
 * only the DECLARED value type (to the spec's), so the type claimed four keys
 * while the write path handled two. That mismatch is what made this visible; it
 * is not a regression #6272 introduced, and keeping it out of that card's
 * atomic fence (a bare two-sided rename, maintainer ruling 2026-08-28 「6272
 * A1」) was the right call.
 *
 * Triage measured that the platform has NO producer for either key — not in
 * objectui, not in objectstack — and queued the card anyway, because both keys
 * are registered on the authorable surface (`objectstack
 * packages/spec/authorable-surface.base.json:3438,3442`). The platform has
 * already promised customers they may author them, so the population that
 * decides this is "does a customer write it", which neither repo can measure.
 *
 * ⛔ THE FENCE. The carry is a key-by-key pick of the two spec-declared
 * optional keys, taken from a value that is ALREADY a valid `LocationValue` —
 * never a wholesale spread of the incoming value, never `Object.assign`. A
 * spread would carry a deprecated `latitude` / `longitude` key straight back
 * into the emitted object and undo #6272's rename.
 *
 * ⚠️ And the spec schema is still not that guard — for a NARROWER reason since
 * `@objectstack/spec` 17.3.0 closed the shape. It used to be a plain,
 * NON-STRICT `z.object`: it ACCEPTED `{ lat, lng, latitude, longitude }` and
 * merely stripped the two unknown keys from its parsed output, so a polluted
 * emission validated GREEN and the dialect survived silently. 17.3.0 makes the
 * same value `unrecognized_keys`, naming the retired pair and prescribing the
 * rename.
 *
 * That is a strictly better contract, and it does NOT let this fence be
 * delegated to it. The fence is about the object the widget hands to
 * `onChange`, and nothing on that path parses — a spread regression would
 * still physically carry `latitude` / `longitude` into the emitted object. What
 * changed is the CONSEQUENCE, not the exposure: the leak used to end in a
 * silent survival, and now ends in a loud refusal at whatever boundary next
 * parses the value. So every anti-dialect assertion here still reads the
 * EMITTED object's own keys rather than `safeParse`, and the last test below
 * pins the strictness itself, because that is now the fact a future reader
 * would otherwise have to re-measure.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { valueSchemaFor } from '@objectstack/spec/data';

import { LocationField, type LocationValue } from '../widgets/LocationField';

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

/**
 * The four keys the spec itself declares, read off the schema rather than
 * copied into a literal here: the anti-spread assertions below are only worth
 * anything if "outside the spec" means what the spec currently says.
 */
const SPEC_KEYS: readonly string[] = Object.keys((LOCATION_SCHEMA as any).shape);

const field = { name: 'site', label: 'Site', type: 'location' } as any;

/** Hangzhou, in the spec spelling, carrying both optional keys. */
const STORED: LocationValue = { lat: 30.2741, lng: 120.1551, altitude: 5, accuracy: 12 };
/** Shanghai — what the user retypes into the box. */
const TYPED = '31.2304, 121.4737';
const TYPED_PAIR = { lat: 31.2304, lng: 121.4737 };

/** Render with `value` stored, retype the coordinates, return what was emitted. */
function emitAfterEdit(value: unknown, text: string = TYPED): any {
  cleanup();
  const onChange = vi.fn();
  render(
    <LocationField field={field} value={value as LocationValue | null} onChange={onChange} />,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  expect(onChange).toHaveBeenCalledTimes(1);
  return onChange.mock.calls[0][0];
}

describe('LocationField carries the spec optional keys across a coordinate edit (objectui#6664)', () => {
  it('keeps altitude and accuracy when the user retypes the pair', () => {
    // The defect itself. This emitted `{ lat, lng }` alone before the fix, so a
    // customer-authored altitude/accuracy was gone after a single edit.
    expect(emitAfterEdit(STORED)).toEqual({ ...TYPED_PAIR, altitude: 5, accuracy: 12 });
  });

  it('keeps whichever of the two the record actually carries', () => {
    const altOnly = emitAfterEdit({ lat: 30.2741, lng: 120.1551, altitude: 5 });
    expect(altOnly).toEqual({ ...TYPED_PAIR, altitude: 5 });
    expect(altOnly).not.toHaveProperty('accuracy');

    const accOnly = emitAfterEdit({ lat: 30.2741, lng: 120.1551, accuracy: 12 });
    expect(accOnly).toEqual({ ...TYPED_PAIR, accuracy: 12 });
    expect(accOnly).not.toHaveProperty('altitude');
  });

  it('keeps a zero altitude, which is a real elevation and not an absent key', () => {
    // Sea level. The carry must be keyed on "the record has a usable number",
    // never on truthiness — `altitude: 0` is exactly the value a falsy test
    // would silently discard.
    expect(emitAfterEdit({ lat: 30.2741, lng: 120.1551, altitude: 0, accuracy: 0 }))
      .toEqual({ ...TYPED_PAIR, altitude: 0, accuracy: 0 });
  });

  it('emits a value the platform validator still accepts', () => {
    // The load-bearing half is the spec's own validator, not a copy of it: the
    // carry must not turn this widget into a producer of invalid values.
    const parsed = LOCATION_SCHEMA.safeParse(emitAfterEdit(STORED));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ ...TYPED_PAIR, altitude: 5, accuracy: 12 });
  });

  it('does not let one unusable optional key cost the other one', () => {
    // Measured against the spec schema: `z.number()` rejects NaN, Infinity and
    // a numeric STRING alike — all three report `invalid_type` at `[altitude]`.
    // So an unusable altitude cannot be carried without making the whole
    // emission spec-invalid, and it is dropped by the same finite-number test
    // the widget already applies to `lat`/`lng`. That is a NARROWING — it emits
    // less, never more — and it must not take a perfectly good `accuracy` with
    // it.
    for (const altitude of [NaN, Infinity, '5' as unknown as number]) {
      const emitted = emitAfterEdit({ lat: 30.2741, lng: 120.1551, altitude, accuracy: 12 });
      expect(emitted).not.toHaveProperty('altitude');
      expect(emitted).toEqual({ ...TYPED_PAIR, accuracy: 12 });
      expect(LOCATION_SCHEMA.safeParse(emitted).success).toBe(true);
    }
  });
});

describe('LocationField invents optional keys it was never given (objectui#6664)', () => {
  it('adds nothing to a record that carries neither key', () => {
    expect(Object.keys(emitAfterEdit({ lat: 30.2741, lng: 120.1551 })).sort())
      .toEqual(['lat', 'lng']);
  });

  it('adds nothing when there is no previously stored value', () => {
    expect(Object.keys(emitAfterEdit(null)).sort()).toEqual(['lat', 'lng']);
  });

  it('still emits null when the box is cleared, carrying nothing forward', () => {
    // Clearing the box means "unset", and an unset location has no altitude to
    // preserve. The carry must not resurrect the old value as a partial object.
    const onChange = vi.fn();
    render(<LocationField field={field} value={STORED} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

/**
 * ⚠️ NEGATIVE CONTROL — green BEFORE this fix as well as after, and that is the
 * correct reading rather than a vacuous one. Today's code emits a freshly built
 * `{ lat, lng }`, which trivially carries no dialect, so there is no red for
 * these to show. They exist to guard the FUTURE regression the fence names:
 * someone "simplifying" the key-by-key pick into `onChange({ ...value, lat,
 * lng })`. Under that rewrite the first test below goes red, because its stored
 * value carries BOTH spellings — which is exactly the guard the fence asked
 * for, and exactly what no positive pin can provide.
 */
describe('NEGATIVE CONTROL — the carry is a key-by-key pick, never a spread (objectui#6664 fence)', () => {
  it('never emits the deprecated latitude/longitude, even from a value carrying both spellings', () => {
    // The sharp control: this value IS a valid `LocationValue` (`lat`/`lng` are
    // finite), so the carry path really runs on it — and it must still leave
    // the retired spelling behind. A spread would emit all six keys and undo
    // #6272.
    const emitted = emitAfterEdit({
      lat: 30.2741,
      lng: 120.1551,
      latitude: 30.2741,
      longitude: 120.1551,
      altitude: 5,
      accuracy: 12,
    });
    expect(emitted).not.toHaveProperty('latitude');
    expect(emitted).not.toHaveProperty('longitude');
  });

  it('emits no key the spec does not declare, whatever the record carries', () => {
    // The general form of the assertion above, derived from the spec's own
    // declared key set: a spread of the incoming value would leak whatever
    // extra keys a record happens to hold, of which the retired pair is only
    // the most damaging example.
    const emitted = emitAfterEdit({
      lat: 30.2741,
      lng: 120.1551,
      latitude: 30.2741,
      longitude: 120.1551,
      provider: 'gps',
      altitude: 5,
    });
    expect(SPEC_KEYS).toEqual(['lat', 'lng', 'altitude', 'accuracy']);
    expect(Object.keys(emitted).filter((k) => !SPEC_KEYS.includes(k))).toEqual([]);
  });

  it('carries nothing at all out of a value the spec rejects outright', () => {
    // A record in the retired `{ latitude, longitude }` spelling reads as unset
    // here (ruled A1, pinned in LocationField.specShape.test.tsx). Its optional
    // keys are not salvaged either — harvesting them would be reading the
    // dialect through a side door, which the A1 ruling closed.
    expect(LOCATION_SCHEMA.safeParse({ latitude: 30.2741, longitude: 120.1551 }).success).toBe(false);
    const emitted = emitAfterEdit({
      latitude: 30.2741,
      longitude: 120.1551,
      altitude: 5,
      accuracy: 12,
    });
    expect(Object.keys(emitted).sort()).toEqual(['lat', 'lng']);
    expect(emitted).toEqual(TYPED_PAIR);
  });

  it('pins WHY those assertions read keys and not safeParse: the value never reaches a parse', () => {
    // This test used to pin the opposite fact — that `LOCATION_SCHEMA` was
    // NON-strict, so a polluted emission parsed green and the dialect survived
    // silently. `@objectstack/spec` 17.3.0 closed the shape, and the note this
    // test carried for that event ("if the spec ever turns strict, the guard
    // could then be delegated to it") is now due. Re-derived rather than
    // inverted, because the answer turns out to be NO.
    const polluted = { lat: 31.2304, lng: 121.4737, latitude: 30.2741, longitude: 120.1551 };
    const parsed = LOCATION_SCHEMA.safeParse(polluted);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    // The shape of the refusal, so "strict" is pinned as the specific fact it
    // is: the retired pair is refused BY NAME at the object root, which is also
    // what makes the message able to prescribe the rename.
    const [issue] = parsed.error.issues;
    expect(issue.code).toBe('unrecognized_keys');
    expect([...((issue as { keys?: string[] }).keys ?? [])].sort()).toEqual([
      'latitude',
      'longitude',
    ]);

    // …and the delegation the old note asked about does NOT follow. The fence
    // guards the object handed to `onChange`, and no parse stands on that path:
    // the polluted object still carries the dialect whatever the schema thinks
    // of it. Strictness changed the CONSEQUENCE of a spread regression (a loud
    // refusal at the next parsing boundary instead of a silent survival), not
    // the widget's exposure to it — so the key-level assertions above stay.
    expect(polluted).toHaveProperty('latitude');
    expect(Object.keys(polluted)).toContain('longitude');
  });
});
