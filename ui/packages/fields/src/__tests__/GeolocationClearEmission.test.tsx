/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6848 — an emptied coordinate box emits `null`, and that emission
 * SURVIVES serialization.
 *
 * ## What this file pins, and why the second half is the point
 *
 * `GeolocationField` used to emit `{ [coordinate]: undefined }` where
 * `CurrencyField`, `PercentField` and `NumberField` all emit `null` for the
 * identical user action. Asserting `=== null` alone would under-pin the fix:
 * the defect was never about which sentinel sat in memory, it was that
 * `undefined` STOPS EXISTING the moment the value is serialized. So every
 * emission here is also driven through `JSON.stringify` and the key is asserted
 * to still be there — the assertion the old code actually failed.
 *
 * ## The write-path measurement (objectui#6848 step 1) — recorded, NOT re-pinned
 *
 * The card carried a reasoned escalation: `undefined` keys vanish from
 * `JSON.stringify`, so a cleared coordinate reaches the server as an ABSENT
 * key, which on a PATCH conventionally means "leave it alone" ⇒ the old
 * coordinate silently survives the save. That was measured before this fix was
 * chosen. Both halves of the answer:
 *
 *  1. **Absent really is not null on the write path.** `@objectstack/client`
 *     17.2.0 `data.update` sends `method: 'PATCH'`, `body: JSON.stringify(data)`;
 *     `driver-memory`'s `update()` merges `{ ...stored, ...data }` and
 *     `driver-sql`'s issues `SET` for the keys present — so an absent key keeps
 *     the stored value and an explicit `null` overwrites it. The platform states
 *     the same contract in prose: *"To clear the stored X, write null; to leave
 *     it unchanged, omit the field."*
 *
 *  2. **But that hazard does not reach THIS widget**, which is why the card is
 *     not the silent-data-loss defect it was filed as. The dropped key is
 *     nested one level below the key the write path merges on: the payload is
 *     `{ <field>: { longitude: … } }`, the composite's OWN key is present,
 *     `location` is a single JSON column, and nothing on the path deep-merges.
 *     The whole value is replaced, so the cleared coordinate does not come
 *     back. Measured end to end: emission → `sanitizeFormData` → the client's
 *     `JSON.stringify` → the drivers' shallow merge.
 *
 * That second half is deliberately NOT asserted here. It is a fact about
 * `@objectstack/client` and the platform's drivers, and a hand-rolled model of
 * them living in this package would pin this file's own guess rather than their
 * behaviour — green forever, including on the day they change. What this
 * package owns is the emission, and that is what is pinned below.
 *
 * ⛔ Does not re-measure the browser table — Chromium 141 via Playwright,
 * provenance in the PR for objectui#6793. `''` is taken from that table as a
 * value a real browser delivers when a box is emptied.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { FieldMetadata } from '@object-ui/types';
import { CurrencyField } from '../widgets/CurrencyField';
import { PercentField } from '../widgets/PercentField';
import { NumberField } from '../widgets/NumberField';
import { GeolocationField, type GeolocationValue } from '../widgets/GeolocationField';

const field = (name: string, type: string): FieldMetadata =>
  ({ name, label: name, type } as unknown as FieldMetadata);

/** The composite as a form would hold it, put through what the write path does to it. */
const roundTrip = (emitted: unknown) =>
  JSON.parse(JSON.stringify({ geo: emitted })) as { geo: Record<string, unknown> };

/** Drive the FIRST `type="number"` box of a rendered widget to `next`. */
function driveFirstNumberBox(next: string): void {
  const box = document.querySelectorAll('input[type="number"]')[0] as HTMLInputElement;
  fireEvent.change(box, { target: { value: next } });
}

describe('objectui#6848 — clearing a GeolocationField coordinate', () => {
  const seeded = { latitude: 30.2741, longitude: 120.1551 } as GeolocationValue;

  it('emits null for the cleared coordinate and keeps the other one', () => {
    const onChange = vi.fn();
    render(<GeolocationField value={seeded} onChange={onChange} field={field('geo', 'location')} />);

    driveFirstNumberBox('');

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as GeolocationValue;
    expect(emitted.latitude).toBeNull();
    expect(emitted.longitude).toBe(120.1551);
    cleanup();
  });

  it('⭐ the cleared coordinate SURVIVES JSON.stringify as an explicit null', () => {
    const onChange = vi.fn();
    render(<GeolocationField value={seeded} onChange={onChange} field={field('geo', 'location')} />);

    driveFirstNumberBox('');
    const wire = roundTrip(onChange.mock.calls[0][0]);

    // The whole point of the card: `undefined` did not get this far. The key
    // was gone from the serialized body, so the emission no longer said
    // "cleared" by the time anything downstream could read it.
    expect(Object.keys(wire.geo)).toContain('latitude');
    expect(wire.geo.latitude).toBeNull();
    expect(JSON.stringify(wire.geo)).toContain('"latitude":null');
    cleanup();
  });

  it('clearing the LONGITUDE box behaves identically (both coordinates, one rule)', () => {
    const onChange = vi.fn();
    render(<GeolocationField value={seeded} onChange={onChange} field={field('geo', 'location')} />);

    const lng = document.querySelectorAll('input[type="number"]')[1] as HTMLInputElement;
    fireEvent.change(lng, { target: { value: '' } });

    const wire = roundTrip(onChange.mock.calls[0][0]);
    expect(wire.geo.longitude).toBeNull();
    expect(wire.geo.latitude).toBe(30.2741);
    cleanup();
  });

  /**
   * The falsy-guard question the dispatch asked to MEASURE rather than assume:
   * `fieldValue ? … : null` tests the raw `.value` STRING, not the parsed
   * number. `'0'` is a non-empty string, so a legitimate zero coordinate — the
   * equator, the prime meridian — takes the value branch, not the clear branch.
   * The trap is not live at this emission site, and this pin is what keeps a
   * future "simplify" from moving the guard onto the parsed number, where it
   * WOULD be live.
   */
  it('a legitimate 0 coordinate emits 0, not null', () => {
    const onChange = vi.fn();
    render(<GeolocationField value={seeded} onChange={onChange} field={field('geo', 'location')} />);

    driveFirstNumberBox('0');

    const emitted = onChange.mock.calls[0][0] as GeolocationValue;
    expect(emitted.latitude).toBe(0);
    expect(typeof emitted.latitude).toBe('number');
    expect(roundTrip(emitted).geo.latitude).toBe(0);
    cleanup();
  });
});

describe('objectui#6848 — the four `type="number"` widgets now agree on "cleared"', () => {
  /**
   * One rule for the class: emptying the box emits `null`, and that `null`
   * reaches the wire. The three scalar widgets already did this; the composite
   * was the outlier the card names.
   */
  it.each([
    ['currency', (onChange: (v: unknown) => void) =>
      <CurrencyField value={42} onChange={onChange} field={field('amount', 'currency')} />],
    ['percent', (onChange: (v: unknown) => void) =>
      <PercentField value={42} onChange={onChange} field={field('rate', 'percent')} />],
    ['number', (onChange: (v: unknown) => void) =>
      <NumberField value={42} onChange={onChange} field={field('count', 'number')} />],
  ])('%s emits null when the box goes empty', (_name, renderWidget) => {
    const onChange = vi.fn();
    render(renderWidget(onChange) as React.ReactElement);

    driveFirstNumberBox('');

    expect(onChange.mock.calls[0][0]).toBeNull();
    cleanup();
  });

  it('geolocation now joins them — its cleared coordinate is null too', () => {
    const onChange = vi.fn();
    render(
      <GeolocationField
        value={{ latitude: 42, longitude: 7 } as GeolocationValue}
        onChange={onChange}
        field={field('geo', 'location')}
      />,
    );

    driveFirstNumberBox('');

    expect((onChange.mock.calls[0][0] as GeolocationValue).latitude).toBeNull();
    cleanup();
  });
});
