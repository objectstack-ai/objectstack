/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.mobile` — the MEMBER shape this renderer reads (objectui#8071,
 * criterion from objectui#8068).
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-form'].mobile` is
 * `z.unknown().optional()`, so the protocol pins nothing at all. The one
 * statement about the members anywhere is the registration's own prose, and it
 * is an EXAMPLE rather than a vocabulary:
 *
 *     "Phone-only presentation overrides, e.g.
 *      `{ stepper: "auto", stepperMinFields: 8, fullscreenLongText: true }`."
 *
 * ⇒ FIVE members are read in `ObjectForm.tsx`, and that "e.g." names three of
 * them. `stepperFieldsPerStep` (row 4) and `stickyActions` (row 1) are read,
 * change what renders, and are named by nothing on either declared side — an
 * author has no way to discover them and no way to learn if they are dropped.
 * That asymmetry is the reason this key needed a pin rather than a description.
 *
 * WHAT EACH ROW CONSTRAINS, all through the real renderer:
 *
 *   1. `stickyActions` moves the submit/cancel bar into the sticky footer — and
 *      the wrapper's `data-mobile-form` marker reads the KEY'S PRESENCE, not
 *      any member, so an EMPTY `mobile: {}` still stamps it while changing
 *      nothing else.
 *   2. `stepper: true` re-routes the flat field list through `WizardForm`
 *      UNCONDITIONALLY — on a desktop viewport and below `stepperMinFields`,
 *      so `true` is not "auto, but keener".
 *   3. `stepper: 'auto'` is gated on BOTH halves at once: the phone viewport
 *      AND the field count reaching `stepperMinFields` (default 8). Each of the
 *      three cells is the other two's control, so the row cannot be satisfied
 *      by a renderer that reads only one half.
 *   4. ⛔ `stepperFieldsPerStep` chunks the steps and DEFAULTS TO 1. This is the
 *      row a plausible "improvement" breaks: the member is in neither the
 *      registration's example nor the spec, so collapsing
 *      `Math.max(1, mobileOpts?.stepperFieldsPerStep ?? 1)` to a bare `1` reads
 *      like deleting an undeclared key — and every other row here stays green
 *      when it happens, while an authored two-per-step form silently becomes
 *      one-per-step.
 *   5. Control: with no `mobile` key the same form renders flat, with no
 *      wizard, no sticky bar and no marker — so rows 1-4 cannot be passing on a
 *      form that ignores the key entirely.
 *
 * ⛔ SCOPE. The fifth member, `fullscreenLongText`, is deliberately NOT pinned
 * here: `ObjectForm.mobileFullscreen.test.tsx` owns it end to end (which field
 * types are stamped, and on which carrier), and splitting one member across two
 * files would make a deletion in either read as coverage.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const DESKTOP_WIDTH = 1200;
const PHONE_WIDTH = 500;
const originalWidth = window.innerWidth;

afterEach(() => {
  (window as any).innerWidth = originalWidth;
});

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/**
 * Mount a create-mode `object-form` at `width` and wait for whichever surface it
 * chose — the flat form, or the wizard's step nav.
 */
async function mount(schema: Record<string, unknown>, width = DESKTOP_WIDTH): Promise<HTMLElement> {
  (window as any).innerWidth = width;
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'invoice', mode: 'create', ...schema } as any}
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => {
    if (!container.querySelector('form, nav[aria-label="Progress"]')) throw new Error('not ready');
  });
  return container as HTMLElement;
}

/** The wizard steps this form was chunked into, or `[]` when it stayed flat. */
const steps = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('[data-testid^="wizard-step:"]')].map(
    (el) => el.getAttribute('data-testid') as string,
  );

describe('`object-form` — the member shape of `mobile`', () => {
  it('1. `stickyActions` moves the action bar; the marker reads the KEY’s presence, not a member', async () => {
    const sticky = await mount({ mobile: { stickyActions: true } });
    expect(sticky.querySelector('[data-testid="form-mobile-sticky-actions"]')).not.toBeNull();
    expect(sticky.querySelector('[data-mobile-form="true"]')).not.toBeNull();

    const empty = await mount({ mobile: {} });
    expect(
      empty.querySelector('[data-mobile-form="true"]'),
      'an empty object is still an authored `mobile`, and the wrapper says so',
    ).not.toBeNull();
    expect(
      empty.querySelector('[data-testid="form-mobile-sticky-actions"]'),
      '…while the member that moves the bar is absent, so the bar does not move',
    ).toBeNull();
  });

  it('2. `stepper: true` routes through the wizard UNCONDITIONALLY — desktop, and under the minimum', async () => {
    const c = await mount({ mobile: { stepper: true, stepperMinFields: 99 } }, DESKTOP_WIDTH);
    expect(steps(c)).toEqual(['wizard-step:step-1', 'wizard-step:step-2', 'wizard-step:step-3']);
  });

  it('3. `stepper: "auto"` needs BOTH the phone viewport and `stepperMinFields`', async () => {
    const belowDefault = await mount({ mobile: { stepper: 'auto' } }, PHONE_WIDTH);
    expect(
      steps(belowDefault),
      'three fields is under the default minimum of 8, so `auto` declines',
    ).toEqual([]);

    const met = await mount({ mobile: { stepper: 'auto', stepperMinFields: 3 } }, PHONE_WIDTH);
    expect(steps(met).length, 'the same form with the minimum lowered to the field count steps up').toBe(3);

    const desktop = await mount({ mobile: { stepper: 'auto', stepperMinFields: 3 } }, DESKTOP_WIDTH);
    expect(
      steps(desktop),
      'the identical schema on a desktop viewport stays flat — `auto` is the phone-only arm',
    ).toEqual([]);
  });

  it('4. `stepperFieldsPerStep` chunks the steps, and defaults to ONE', async () => {
    const perStepTwo = await mount({ mobile: { stepper: true, stepperFieldsPerStep: 2 } });
    expect(steps(perStepTwo), 'three fields, two per step').toEqual([
      'wizard-step:step-1',
      'wizard-step:step-2',
    ]);

    const defaulted = await mount({ mobile: { stepper: true } });
    expect(steps(defaulted).length, 'control: the same form with the member omitted is one per step').toBe(3);
  });

  it('5. control: with NO `mobile` key the form is flat, unmarked and un-stickied', async () => {
    const c = await mount({}, PHONE_WIDTH);
    expect(steps(c)).toEqual([]);
    expect(c.querySelector('[data-mobile-form="true"]')).toBeNull();
    expect(c.querySelector('[data-testid="form-mobile-sticky-actions"]')).toBeNull();
    expect([...c.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'))).toEqual([
      'customer',
      'note',
      'amount',
    ]);
  });
});
