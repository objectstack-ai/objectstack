/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6744, measured end to end: a STORED out-of-range coordinate must not
 * survive an edit.
 *
 * ## The defect
 *
 * `buildValidationRules` is the producer of the host-side `error` prop every
 * field widget's published objectui#3222 slot reads, and it had no branch for
 * `location`. So a coordinate ALREADY IN THE RECORD that violates the spec's
 * range was never validated on an edit form: the control rendered it, nothing
 * marked it invalid, and submitting re-wrote it unchanged.
 *
 * ⚠️ A different defect from objectui#6714/#6716, which are about a refusal at
 * INPUT time. A refusal never becomes a form value, so the rule pinned here is
 * handed `undefined` in both of those arms. The create-mode cases at the bottom
 * are the pin that says so: #6714's refusal is unchanged and is still the
 * widget's, not this rule's.
 *
 * ## The ruling this file executes
 *
 * The maintainer ruling of 2026-08-29 (director session batch #4) adopted "add
 * the `location` branch + a hard precondition": count stored out-of-range
 * coordinates across everything measurable FIRST, land the cheap guard only on
 * a zero reading, and stop and report a non-zero one instead of shipping a hard
 * block on top of it.
 *
 * The reading taken for this branch, with the platform's own validator rather
 * than a hand-written range: 28 stored location values across every measurable
 * dataset — the app-showcase seed (`showcase_account.hq` x14,
 * `showcase_task.location` x10, `showcase_field_zoo.f_location` x1), the qa
 * dogfood field-zoo matrix, and the objectui schema-catalog location schemas —
 * adjudicated by `valueSchemaFor({ type: 'location' }, 'stored')`. 28 accepted,
 * 0 refused, with `{ lat: 999, lng: 999 }` refused by the same call as a
 * positive control.
 *
 * ⚠️ That zero means "zero within measurable scope", never "does not exist".
 * Customer deployments are not measurable from a development container, and
 * nothing here is evidence about them.
 *
 * ## Why the whole value goes to the spec
 *
 * ⛔ The bounds are not restated here or in the rule. `valueSchemaFor` is the
 * same schema the engine's record validator checks a stored `location` against
 * (ADR-0104 D1), so the form now surfaces the platform's own verdict instead of
 * inventing one — and the expected message below is BUILT from the schema's
 * issues rather than typed out, so a bound that moves in the spec cannot leave
 * a stale literal passing in here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { valueSchemaFor } from '@objectstack/spec/data';

import { ObjectForm } from './ObjectForm';
import { registerAllFields, buildValidationRules } from '@object-ui/fields';

registerAllFields();

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

/** The message the rule must produce, derived from the spec — never typed out. */
const expectedMessage = (value: unknown): string => {
  const parsed = LOCATION_SCHEMA.safeParse(value);
  if (parsed.success) throw new Error('expectedMessage called with a value the spec accepts');
  const detail = parsed.error.issues
    .map((i: any) => `${i.path.join('.') || 'value'}: ${i.message}`)
    .join('; ');
  return `Invalid location: ${detail}`;
};

const siteSchema = {
  name: 'site',
  fields: {
    title: { type: 'text', label: 'Title' },
    place: { type: 'location', label: 'Place' },
  },
};

const makeDS = (stored: Record<string, unknown>) => ({
  getObjectSchema: vi.fn().mockResolvedValue(siteSchema),
  findOne: vi.fn().mockResolvedValue({ id: 'r1', title: 'HQ', ...stored }),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r2', ...d })),
  update: vi.fn(async (_o: string, _id: string, d: any) => ({ id: 'r1', ...d })),
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

/**
 * Open a real EDIT form on a record that already holds `place`, submit it
 * without touching the location box, and report what the form did.
 *
 * Nothing is typed into the coordinate box on purpose: the whole defect is
 * about a value the user never touched being written back.
 */
async function submitStored(place: unknown) {
  const ds = makeDS(place === undefined ? {} : { place });
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'site', mode: 'edit', recordId: 'r1' } as any}
      dataSource={ds as any}
    />,
  );
  const input = await waitInput(container, 'place');
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  // Let the submit settle either way: a blocked submit never calls `update`, so
  // waiting on `update` would be waiting on the thing under test.
  await waitFor(() => {
    if (!ds.update.mock.calls.length && container.querySelector('[aria-invalid="true"]') === null) {
      throw new Error('form has neither written nor refused yet');
    }
  });
  return { ds, container, input, rowText: input.closest('div')?.parentElement?.textContent ?? '' };
}

/* -------------------------------------------------------------------------- */
/* Direction 1 — an out-of-range STORED value is blocked on edit.              */
/* -------------------------------------------------------------------------- */

describe('a stored out-of-range location blocks the edit (objectui#6744)', () => {
  it('marks the control invalid, says why, and writes nothing', async () => {
    // The exact value the card measured, and the exact reason it matters.
    const refused = LOCATION_SCHEMA.safeParse({ lat: 999, lng: 999 });
    expect(refused.success).toBe(false);
    expect(
      refused.success ? [] : refused.error.issues.map((i: any) => `${i.code}@[${i.path.join('.')}]`),
    ).toEqual(['too_big@[lat]', 'too_big@[lng]']);

    const { ds, input, rowText } = await submitStored({ lat: 999, lng: 999 });

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(rowText).toContain(expectedMessage({ lat: 999, lng: 999 }));
    expect(ds.update).toHaveBeenCalledTimes(0);
  });

  it('blocks every out-of-range pair the spec refuses, on each bound', async () => {
    for (const stored of [
      { lat: 999, lng: 999 },
      { lat: 91, lng: 0 },
      { lat: -91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 0, lng: -181 },
    ]) {
      expect(LOCATION_SCHEMA.safeParse(stored).success, `spec verdict on ${JSON.stringify(stored)}`)
        .toBe(false);
      const { ds, input } = await submitStored(stored);
      expect(input.getAttribute('aria-invalid'), `aria-invalid for ${JSON.stringify(stored)}`)
        .toBe('true');
      expect(ds.update, `update for ${JSON.stringify(stored)}`).toHaveBeenCalledTimes(0);
    }
  });

  it('the widget still RENDERS the bad coordinate, so its only fixer can see it', async () => {
    // objectui#6272's read guard is deliberately not wired to the range: a
    // record holding an out-of-range pair keeps rendering. Blanking it would
    // hide the dirty data from the person who can correct it, and this rule
    // does not change that — it only stops the value being written back.
    const { input } = await submitStored({ lat: 999, lng: 999 });
    expect(input.value).toBe('999, 999');
  });
});

/* -------------------------------------------------------------------------- */
/* Direction 2 — a legal stored value is untouched.                            */
/* -------------------------------------------------------------------------- */

describe('a legal stored location is unaffected (objectui#6744)', () => {
  it('saves it back unchanged, with nothing marked invalid', async () => {
    const stored = { lat: 30.2741, lng: 120.1551 };
    expect(LOCATION_SCHEMA.safeParse(stored).success).toBe(true);

    const { ds, input, rowText } = await submitStored(stored);

    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(rowText).not.toContain('Invalid location:');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toMatchObject({ place: stored });
  });

  it('carries the spec optional keys through without complaint', async () => {
    // `altitude`/`accuracy` are declared by `LocationValueSchema` and a customer
    // may write them, so the rule must not read a fuller value as a worse one.
    const stored = { lat: 30.2741, lng: 120.1551, altitude: 12, accuracy: 5 };
    expect(LOCATION_SCHEMA.safeParse(stored).success).toBe(true);
    const { ds, input } = await submitStored(stored);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toMatchObject({ place: stored });
  });

  it('an ABSENT location does not block the edit', async () => {
    // The spec's schema refuses `null` and `undefined` outright — it describes a
    // PRESENT value and leaves presence to the caller. Deciding it here would be
    // a second definition of "empty" competing with `required`'s, so the rule
    // asks core's `isMissingForRequired` instead. This is that pin.
    const { ds, input } = await submitStored(undefined);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2].place).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Direction 3 — the CREATE form's behaviour is unchanged.                     */
/* -------------------------------------------------------------------------- */

async function submitCreate(coordinateText?: string) {
  const ds = makeDS({});
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'site', mode: 'create' } as any}
      dataSource={ds as any}
    />,
  );
  fireEvent.change(await waitInput(container, 'title'), { target: { value: 'HQ' } });
  if (coordinateText !== undefined) {
    fireEvent.change(await waitInput(container, 'place'), { target: { value: coordinateText } });
  }
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalled());
  return { ds, container, payload: ds.create.mock.calls[0][1] as Record<string, unknown> };
}

describe('the create form behaves exactly as before (objectui#6744)', () => {
  it('an untouched location field still creates', async () => {
    const { payload } = await submitCreate();
    expect(payload).toMatchObject({ title: 'HQ' });
    expect(payload.place).toBeUndefined();
  });

  it('a legal typed coordinate is still stored', async () => {
    const { payload } = await submitCreate('30.2741, 120.1551');
    expect(payload.place).toEqual({ lat: 30.2741, lng: 120.1551 });
  });

  it('an out-of-range typed coordinate is still refused by the WIDGET, not by this rule', async () => {
    // objectui#6714 unchanged: the widget never emits it, so the value never
    // becomes a form value and this rule is handed `undefined`. The create
    // payload carries no `place` — the same reading `ObjectForm.locationRange`
    // pins — and the create still goes through, which is what proves the
    // refusal happened upstream of the rule rather than in it.
    const { payload } = await submitCreate('999, 999');
    expect(payload.place).toBeUndefined();
    expect(payload).toMatchObject({ title: 'HQ' });
  });
});

/* -------------------------------------------------------------------------- */
/* The rule itself, at the seam objectui#6744 actually changed.                */
/* -------------------------------------------------------------------------- */

describe('buildValidationRules now compiles a `location` branch (objectui#6744)', () => {
  it('emits a `validate.location` entry for a location field', () => {
    const rules = buildValidationRules({ type: 'location', name: 'place' });
    expect(rules).toBeDefined();
    expect(typeof rules.validate.location).toBe('function');
  });

  it('the entry passes a legal value and an absent one, and refuses what the spec refuses', () => {
    const validate = buildValidationRules({ type: 'location', name: 'place' }).validate.location;
    expect(validate({ lat: 30.2741, lng: 120.1551 })).toBe(true);
    expect(validate(undefined)).toBe(true);
    expect(validate(null)).toBe(true);
    expect(validate('')).toBe(true);
    expect(validate({ lat: 999, lng: 999 })).toBe(expectedMessage({ lat: 999, lng: 999 }));
    expect(validate({ lat: 91, lng: 0 })).toBe(expectedMessage({ lat: 91, lng: 0 }));
  });

  it('is the only validator in the object form: a field-level `validate` is not compiled (objectui#12242)', () => {
    // The object form is react-hook-form's own way of holding several named
    // validators, and it is the shape the form renderer normalises to when it
    // adds `required`. A field-level `validate` used to ride in beside the
    // location entry; the spec refuses that key by name, so it is no longer
    // read, and the entry stands alone.
    const authored = () => 'authored says no';
    const rules = buildValidationRules({ type: 'location', name: 'place', validate: authored });
    expect(Object.keys(rules.validate)).toEqual(['location']);
    expect(typeof rules.validate.location).toBe('function');
  });

  it('no other field type grows a location rule', () => {
    // A control from the same call, so the readings above cannot be an artefact
    // of a helper that answers the same way for everything.
    expect(buildValidationRules({ type: 'text', name: 'title', required: true }))
      .toEqual({ required: true });
    expect(buildValidationRules({ type: 'text', name: 'title' })).toBeUndefined();
  });
});
