/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.initialValues` and `object-form.initialData` — the MEMBER shape
 * this renderer reads (objectui#8071, criterion from objectui#8068).
 *
 * Both are registered `{ type: 'object' }` with prose only — "Values to prefill
 * in `create` mode" and "Alternate spelling of `initialValues` that the
 * drawer/modal presentations read FIRST". `ObjectFormSchema` types them
 * `Record<string, any>`, so EVERY object parses on both sides and nothing
 * declared says what a member is or what happens when both keys are authored.
 * That is the population objectui#8068 refuses to leave unwatched.
 *
 * WHAT THE RENDERER READS, measured at `ObjectForm.tsx` — the two sites that
 * seed `initialData` state, the inline-fields effect and the create branch of
 * `fetchInitialData`, both spelled:
 *
 *     setInitialData(resolveInitialRecord(schema));
 *
 *   1. a MEMBER is a FIELD NAME, and its value is that control's opening value;
 *   2. the two keys are MERGED PER MEMBER, `initialData` winning member by
 *      member — which is what the registration's "alternate spelling …
 *      read FIRST" states, read as the precedence claim it is.
 *
 * ⭐ ROWS 3 AND 4 WERE FLIPPED BY objectui#9760, ⛔ not deleted, and the reason
 * is worth keeping in view because the rows read as the OPPOSITE fact now.
 * They were written by objectui#8071 to record the whole-object `||` the
 * renderer then spelled — `schema.initialData || schema.initialValues` — and
 * that card was pins-only, so it recorded the behaviour and handed the defect
 * back rather than repairing it. Maintainer ruling on objectui#9760 (batch #166
 * item 3, letter 甲) chose the merge, so what these two rows assert changed and
 * what they are FOR did not: row 3 is still the row a plausible edit breaks
 * (collapsing the helper back to either key alone, or to a `||`, turns it red),
 * and row 4 is still the same read at its sharp edge.
 *
 * Row 3: with both authored, an `initialValues` member that `initialData` says
 * nothing about SURVIVES. The pre-ruling behaviour dropped it — an author who
 * prefilled three fields through `initialValues` and added a one-member
 * `initialData` lost the other two, with no warning and no empty state.
 *
 * Row 4: an EMPTY `initialData` no longer shadows anything. `||` tested the
 * OBJECT's truthiness and `{}` is truthy, so the empty object a producer hands
 * over when it has nothing to contribute blanked a populated `initialValues`
 * completely; the merge contributes nothing instead, which is the whole of
 * objectui#9760.
 *
 * Row 5 is the non-vacuity control: with neither key authored the same controls
 * render EMPTY, so rows 1-4 cannot be passing on a form that ignores both keys.
 */

import { describe, it, expect, vi } from 'vitest';
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
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/** Render a create-mode `object-form` and read back both controls' values. */
async function openingValues(
  schema: Record<string, unknown>,
): Promise<{ customer: string | null; note: string | null }> {
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'invoice', mode: 'create', ...schema } as any}
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => {
    if (!container.querySelector('input[name="customer"]')) throw new Error('form not ready');
  });
  const read = (name: string) =>
    (container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? null;
  return { customer: read('customer'), note: read('note') };
}

describe('`object-form` — the member shape of `initialValues` / `initialData`', () => {
  it('1. an `initialValues` member is a FIELD NAME, and its value opens that control', async () => {
    expect(await openingValues({ initialValues: { customer: 'Alpha', note: 'from initialValues' } })).toEqual({
      customer: 'Alpha',
      note: 'from initialValues',
    });
  });

  it('2. `initialData` carries the same member vocabulary, and a field it omits opens empty', async () => {
    expect(await openingValues({ initialData: { customer: 'Beta' } })).toEqual({
      customer: 'Beta',
      note: '',
    });
  });

  it('3. with BOTH authored the merge is PER MEMBER — `initialData` wins where it speaks, `initialValues` supplies the rest', async () => {
    expect(
      await openingValues({
        initialData: { customer: 'Beta' },
        initialValues: { customer: 'Alpha', note: 'from initialValues' },
      }),
      'a whole-object choice would blank `note`; the merge leaves the member `initialData` says nothing about seeded',
    ).toEqual({ customer: 'Beta', note: 'from initialValues' });
  });

  it('4. an EMPTY `initialData` contributes NOTHING — it no longer shadows a populated `initialValues`', async () => {
    expect(
      await openingValues({ initialData: {}, initialValues: { customer: 'Alpha', note: 'from initialValues' } }),
      'the empty object a `?? {}` producer hands over must not blank the form beside it',
    ).toEqual({ customer: 'Alpha', note: 'from initialValues' });
  });

  it('5. control: with neither key authored the same controls open EMPTY', async () => {
    expect(await openingValues({})).toEqual({ customer: '', note: '' });
  });
});
