/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6714, measured end to end: an out-of-range coordinate must never
 * reach the data source.
 *
 * Triage required one reading before the widget-side disposition could be
 * chosen — **does anything downstream reject or repair the value before it is
 * stored?** This file is that measurement, kept as a pin.
 *
 * What it measured, on the merge-base: typing the card's `999, 999` into a real
 * `ObjectForm` called `dataSource.create` ONCE, with
 * `place: { lat: 999, lng: 999 }` verbatim — while
 * `valueSchemaFor({ type: 'location' })` refuses that same value with
 * `too_big` at both keys. `aria-invalid` on the control read `"false"` and the
 * field rendered no error text. So the answer is NEITHER: nothing on this path
 * rejects the value and nothing repairs it.
 *
 * That is what makes the widget the only place a refusal can work, and it is
 * why the widget refuses to emit rather than emitting and marking the field
 * invalid: an emission here is a write, not a warning.
 *
 * ⚠️ The pass-through assertion below is load-bearing, not decoration. The form
 * hands the widget's emission to `dataSource.create` UNCHANGED —
 * `sanitizeFormData` filters KEYS (server-managed, computed, read-only) and
 * never inspects a value.
 *
 * ⚠️ The second half of that sentence has since changed and the cases below
 * still hold, which is worth stating rather than leaving to be re-derived.
 * `buildValidationRules` DOES have a `location` branch now (objectui#6744): a
 * stored value is adjudicated against `valueSchemaFor({ type: 'location' })`
 * and an out-of-range one blocks the write. It does not touch the readings
 * here, because every case in this file TYPES its coordinate — the widget
 * refuses the out-of-range ones before they become form values, so the rule is
 * handed `undefined` and has nothing to say. The measurement this file records
 * is about the CREATE path at INPUT time; #6744's is about a value already in
 * the record. `ObjectForm.locationStoredRange.test.tsx` pins that one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { valueSchemaFor } from '@objectstack/spec/data';

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

const siteSchema = {
  name: 'site',
  fields: {
    title: { type: 'text', label: 'Title' },
    place: { type: 'location', label: 'Place' },
  },
};

const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(siteSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

/** Type a title + a coordinate string into a real create form and submit it. */
async function submitWith(coordinateText: string) {
  const ds = makeDS();
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'site', mode: 'create' } as any}
      dataSource={ds as any}
    />,
  );

  fireEvent.change(await waitInput(container, 'title'), { target: { value: 'HQ' } });
  fireEvent.change(await waitInput(container, 'place'), { target: { value: coordinateText } });
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);

  await waitFor(() => expect(ds.create).toHaveBeenCalled());
  return { payload: ds.create.mock.calls[0][1] as Record<string, unknown>, container };
}

describe('ObjectForm never stores an out-of-range location (objectui#6714)', () => {
  it('does not put `999, 999` in the create payload', async () => {
    // The exact value the card measured, and the exact reason it matters: the
    // spec refuses it, so storing it is a dirty write.
    const refused = LOCATION_SCHEMA.safeParse({ lat: 999, lng: 999 });
    expect(refused.success).toBe(false);
    expect(
      refused.success ? [] : refused.error.issues.map((i: any) => `${i.code}@[${i.path.join('.')}]`),
    ).toEqual(['too_big@[lat]', 'too_big@[lng]']);

    const { payload } = await submitWith('999, 999');
    expect(payload.place).toBeUndefined();
    expect(payload).toMatchObject({ title: 'HQ' });
  });

  it('passes an in-range coordinate through to the data source unchanged', async () => {
    // The other half, and the pass-through evidence the measurement rests on:
    // whatever the widget emits is what gets stored, byte for byte. Nothing on
    // this path would have caught the bad value — which is why the widget must.
    const { payload } = await submitWith('30.2741, 120.1551');
    expect(payload.place).toEqual({ lat: 30.2741, lng: 120.1551 });
    expect(LOCATION_SCHEMA.safeParse(payload.place).success).toBe(true);
  });

  it('stores nothing the platform validator would refuse, for either input', async () => {
    for (const typed of ['999, 999', '91, 0', '0, 181', '30.2741, 120.1551']) {
      const { payload } = await submitWith(typed);
      if (payload.place !== undefined) {
        expect(LOCATION_SCHEMA.safeParse(payload.place).success, `stored for "${typed}"`).toBe(true);
      }
    }
  });
});
