/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6715, measured end to end: a partly-numeric coordinate must never
 * reach storage as a whole one.
 *
 * The two sibling files are the other halves of the same story —
 * `ObjectForm.locationRange.test.tsx` is objectui#6714's measurement (an
 * out-of-range pair never reaches `dataSource.create`) and
 * `ObjectForm.locationRefusal.test.tsx` is objectui#6716's (a refusal is
 * announced rather than swallowed). This file is the class NEITHER of them
 * covers, and the reason it needed its own card: a TRUNCATED pair.
 *
 * ## Why this file exists rather than a widget-only pin
 *
 * The defect is invisible to every oracle except the user's own typing.
 * `parseFloat('12abc')` is `12`, so `"12abc, 34"` produced
 * `{ lat: 12, lng: 34 }` — well-formed, in range, and something
 * `valueSchemaFor({ type: 'location' })` ACCEPTS. #6714's `999, 999` was at
 * least a value the contract refuses; a truncation is a value the contract
 * blesses. So the only place the defect is observable is HERE, at what the
 * form actually hands to `dataSource.create`. Each case below asserts that
 * premise from the spec before asserting the refusal.
 *
 * ## What this measured on the base commit (`b76ca6764`), before the fix
 *
 * Typing each text into this same form and submitting:
 *
 * ```
 * typed "12abc, 34"    create({ place: {"lat":12,"lng":34} })    aria-invalid=false
 * typed "1.2.3, 4"     create({ place: {"lat":1.2,"lng":4} })    aria-invalid=false
 * typed "12deg, 34"    create({ place: {"lat":12,"lng":34} })    aria-invalid=false
 * typed "0x10, 34"     create({ place: {"lat":0,"lng":34} })     aria-invalid=false
 * typed "12.5 N, 34 E" create({ place: {"lat":12.5,"lng":34} })  aria-invalid=false
 * ```
 *
 * The row for `"12.5 N, 34 E"` is the one worth reading twice: that is the
 * PASTE shape triage guessed the real user route to be, and the hemisphere
 * letter is silently dropped — a `12.5 S` paste would have been stored as
 * `+12.5`, on the wrong side of the equator, with nothing said.
 *
 * ## Scope, from the ruling
 *
 * ⛔ Degree/hemisphere notation is NOT parsed — the ruling declines it because
 * the paste route is unmeasured. The refusal is the whole change.
 *
 * ⛔ This card did not give `buildValidationRules` a `location` branch — the
 * last test is the pin for that. objectui#6744 later did, for the different
 * defect of a STORED out-of-range coordinate on an edit form, and the pin was
 * rewritten to assert the property that survives: a refusal means `onChange`
 * never fires, so the typed text never becomes a form value, and the host rule
 * — which adjudicates a value — is handed `undefined` (measured on #6716).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { valueSchemaFor } from '@objectstack/spec/data';

import { ObjectForm } from './ObjectForm';
import { registerAllFields, buildValidationRules } from '@object-ui/fields';

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

/** The whole rendered row for `place`, so any text the field draws is seen. */
function placeRowText(container: HTMLElement): string {
  let node: HTMLElement | null = container.querySelector('input[name="place"]');
  for (let i = 0; i < 4 && node?.parentElement; i++) node = node.parentElement;
  return (node?.textContent || '').trim();
}

function mountForm() {
  const ds = makeDS();
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'site', mode: 'create' } as any}
      dataSource={ds as any}
    />,
  );
  return { ds, container };
}

/** Type a coordinate, submit, and report what the form actually did. */
async function typeAndSubmit(typed: string) {
  const { ds, container } = mountForm();
  fireEvent.change(await waitInput(container, 'title'), { target: { value: 'HQ' } });
  fireEvent.change(await waitInput(container, 'place'), { target: { value: typed } });

  const el = container.querySelector('input[name="place"]') as HTMLInputElement;
  const observed = {
    ariaInvalid: el.getAttribute('aria-invalid'),
    domValue: el.value,
    rowText: placeRowText(container),
  };

  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalled());
  return { ...observed, stored: ds.create.mock.calls[0][1].place };
}

/** What a bare `parseFloat` WOULD have stored — the reading this card removes. */
function truncationOf(text: string): { lat: number; lng: number } {
  const parts = text.split(',').map(p => p.trim());
  return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
}

/* -------------------------------------------------------------------------- */
/* The defect, at the only place it is observable.                             */
/* -------------------------------------------------------------------------- */

describe('ObjectForm never stores a truncated coordinate (objectui#6715)', () => {
  it.each([
    ['12abc, 34'],
    ['1.2.3, 4'],
    ['12deg, 34'],
    // The wider class, all of which stored a plausible wrong place on the base
    // commit: a hex literal reading as 0, and the paste shapes that drop the
    // hemisphere.
    ['0x10, 34'],
    ['12.5 N, 34 E'],
    ['12deg, 34deg'],
  ])('%s is refused, announced, and never reaches dataSource.create', async typed => {
    // 1. The premise: the OLD reading produced a pair the platform ACCEPTS, so
    //    nothing downstream could have objected to it. This is what makes the
    //    card different from objectui#6714.
    const wouldHaveBeen = truncationOf(typed);
    expect(Number.isNaN(wouldHaveBeen.lat)).toBe(false);
    expect(LOCATION_SCHEMA.safeParse(wouldHaveBeen).success).toBe(true);

    const after = await typeAndSubmit(typed);

    // 2. Nothing was stored — not the truncation, not anything.
    expect(after.stored).toBeUndefined();
    // 3. The refusal is ANNOUNCED, through objectui#6716's machinery: the a11y
    //    state a screen reader reads, and a reason a person can read.
    expect(after.ariaInvalid).toBe('true');
    expect(after.rowText).toContain('Not saved:');
    // 4. The refused text is still in the box to be corrected.
    expect(after.domValue).toBe(typed);
  });

  it('names the half it could not read, so the message is correctable', async () => {
    const after = await typeAndSubmit('12abc, 34');
    expect(after.rowText).toContain('latitude "12abc"');
  });

  it('stores the coordinate once the residue is corrected', async () => {
    const { ds, container } = mountForm();
    fireEvent.change(await waitInput(container, 'title'), { target: { value: 'HQ' } });
    fireEvent.change(await waitInput(container, 'place'), { target: { value: '12abc, 34' } });
    expect(
      (container.querySelector('input[name="place"]') as HTMLInputElement).getAttribute('aria-invalid'),
    ).toBe('true');

    fireEvent.change(await waitInput(container, 'place'), { target: { value: '30.2741, 120.1551' } });
    const el = container.querySelector('input[name="place"]') as HTMLInputElement;
    expect(el.getAttribute('aria-invalid')).toBe('false');
    expect(placeRowText(container)).not.toContain('Not saved:');

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const stored = ds.create.mock.calls[0][1].place;
    expect(stored).toEqual({ lat: 30.2741, lng: 120.1551 });
    expect(LOCATION_SCHEMA.safeParse(stored).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The other direction: a clean pair costs nothing.                            */
/* -------------------------------------------------------------------------- */

describe('ObjectForm still stores every clean numeric pair (objectui#6715)', () => {
  it.each([
    ['30.27, 120.15', { lat: 30.27, lng: 120.15 }],
    ['-30.27, -120.15', { lat: -30.27, lng: -120.15 }],
    ['+30.27, +120.15', { lat: 30.27, lng: 120.15 }],
    ['  30.27 , 120.15  ', { lat: 30.27, lng: 120.15 }],
    ['3.027e1, 1.2015e2', { lat: 30.27, lng: 120.15 }],
  ])('%s reaches storage unchanged', async (typed, expected) => {
    const after = await typeAndSubmit(typed);
    expect(after.stored).toEqual(expected);
    expect(after.ariaInvalid).toBe('false');
    expect(after.rowText).not.toContain('Not saved:');
    expect(LOCATION_SCHEMA.safeParse(after.stored).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The scope fence objectui#6744 owns.                                         */
/* -------------------------------------------------------------------------- */

describe('the residue refusal is the widget\'s, not a host rule\'s (objectui#6715)', () => {
  it('the `location` rule objectui#6744 added is handed `undefined` by a refusal', () => {
    // This pin used to read "compiles no rules for a location field", with the
    // note that objectui#6744 owned the question. #6744 answered it: the branch
    // exists, and it validates a STORED value. So the pin now asserts what kept
    // this card's refusal widget-local in the first place.
    const rules = buildValidationRules({ type: 'location', name: 'place' });
    expect(typeof rules.validate.location).toBe('function');
    // A residue refusal emits nothing, so the host rule sees nothing.
    expect(rules.validate.location(undefined)).toBe(true);
    // A control from the same call, so the reading above cannot be an artefact
    // of a helper that answers the same way for everything.
    expect(buildValidationRules({ type: 'text', name: 'title', required: true })).toEqual({ required: true });
  });
});
