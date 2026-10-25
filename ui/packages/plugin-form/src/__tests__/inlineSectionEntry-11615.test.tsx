/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A self-describing inline section entry is drawn on EVERY `object-form` arm,
 * the default one included (objectui#11615).
 *
 * A section's `fields` takes three entry shapes: a field name, the form view's
 * `{ field, … }` entry, and an inline runtime `FormField` keyed by `name`. The
 * `tabbed`, `wizard`, `split`, `drawer` and `modal` arms build a section with no
 * field pool, so they draw an inline entry as it stands. The default arm
 * (`SimpleObjectForm`) hands `buildSectionFields` its parent field POOL
 * (objectui#10475), and the pooled branch dropped every entry the pool did not
 * hold — the inline one too. So the same section drew its inline member on five
 * arms and skipped it on the sixth, with the objectui#9884 intersection warning
 * the only trace when the object happened to declare the name.
 *
 * Triage's ruling (comment `5980751840`): the intersection catches a NAME-ONLY
 * entry the pool does not hold — a typo, a stale name, a field top-level
 * `fields` leaves out — and an entry that declares itself names nothing to
 * resolve, so skipping it guarded nothing. The pooled branch now draws such an
 * entry; the named shapes keep the intersection and its warning.
 *
 * "Self-describing" is `isInlineFieldDef` (`submitTarget.ts`): an object whose
 * `field` is not a string and whose `name` is — the one predicate the
 * submit-target rule already read. It does NOT require `type`: the spec's
 * inline arm keys by `name` and leaves `type` optional, and the pool-less
 * arms draw a typeless entry as the default input. The typeless row below pins
 * that the default arm agrees.
 *
 * Every row mounts the real `ObjectForm` against an adapter, which is the page
 * block's route. The data-source-free half lives in `submitTargetRefusal.test.tsx`
 * block 3.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(cleanup);

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(async (_object: string, data: Record<string, unknown>) => ({ id: 'r1', ...data })),
    update: vi.fn(),
  }) as any;

const ARMS = ['simple', 'drawer', 'modal', 'tabbed', 'wizard', 'split'] as const;
type Arm = (typeof ARMS)[number];

/** The drawer and modal portal their content, so every read is off `document.body`. */
const drawnFields = (): string[] =>
  [...document.body.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

const labelOf = (name: string): string | null =>
  document.body.querySelector(`[data-field="${name}"] label`)?.textContent ?? null;

const controlOf = (name: string): Element | null =>
  document.body.querySelector(`[data-field="${name}"] input, [data-field="${name}"] textarea`);

/** An inline field no object declares, and one with no `type` at all. */
const MEMO = { name: 'memo', type: 'text', label: 'Memo' };
const TYPELESS = { name: 'typeless', label: 'Typeless' };

async function mount(arm: Arm, schema: Record<string, unknown>) {
  const adapter = makeDataSource();
  render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: 'invoice',
          mode: 'create',
          ...(arm === 'simple' ? {} : { formType: arm, open: true }),
          ...schema,
        } as any
      }
      dataSource={adapter}
    />,
  );
  await waitFor(() => {
    if (!document.body.querySelector('form [data-field]')) throw new Error('form not ready');
  });
  return adapter;
}

describe.each(ARMS)('`object-form` `formType: %s` — a self-describing inline section entry (objectui#11615)', (arm) => {
  it('is drawn in the section’s order, typed or not, though nothing declares its name', async () => {
    await mount(arm, {
      sections: [{ name: 'main', label: 'Main', fields: ['customer', MEMO, TYPELESS] }],
    });
    // On the tree before objectui#11615 the `simple` row read `['customer']`:
    // the pooled branch dropped both inline entries. The other five were green.
    expect(drawnFields()).toEqual(['customer', 'memo', 'typeless']);
    expect(labelOf('memo')).toBe('Memo');
    expect(controlOf('memo'), 'drawn as a working control, not a bare heading').not.toBeNull();
    expect(controlOf('typeless'), 'a typeless entry draws the default input').not.toBeNull();
  });
});

describe('`object-form` default arm — the intersection stays, for NAMED entries only (objectui#9884, objectui#11615)', () => {
  it('top-level `fields` still drops a named member it does not list, and warns; the inline member beside them is drawn and not warned about', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mount('simple', {
        fields: ['customer'],
        sections: [
          {
            name: 'main',
            label: 'Main',
            fields: ['customer', 'note', { field: 'amount', label: 'AMOUNT OVERRIDE' }, MEMO],
          },
        ],
      });
      expect(
        drawnFields(),
        '`note` (a name) and `amount` (a `{ field }` entry) are declared and left out of `fields`; `memo` names nothing to resolve',
      ).toEqual(['customer', 'memo']);

      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(said.some((m) => m.includes("names 'note'")), 'the named loss is still reported').toBe(true);
      expect(said.some((m) => m.includes("names 'amount'")), 'so is the `{ field }` loss').toBe(true);
      expect(
        said.some((m) => m.includes("names 'memo'")),
        'the drawn inline member is not reported as dropped',
      ).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('an inline entry naming a declared field that `fields` leaves out is drawn as ITS OWN definition, with no warning', async () => {
    // The case the old pooled branch treated as a NAME: the object declares
    // `amount`, top-level `fields` does not list it, and the section supplies a
    // whole definition under that name. It is drawn as authored — the label it
    // carries, not the object's — exactly as the five pool-less arms draw it.
    // Its own section name: the warning is deduped per (object, section,
    // member), and the row above already reported `amount` under `main`.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mount('simple', {
        fields: ['customer'],
        sections: [
          {
            name: 'second',
            label: 'Second',
            fields: ['customer', { name: 'amount', type: 'text', label: 'INLINE AMOUNT' }],
          },
        ],
      });
      expect(drawnFields()).toEqual(['customer', 'amount']);
      expect(labelOf('amount')).toBe('INLINE AMOUNT');
      expect(warn.mock.calls.map((call) => String(call[0])).some((m) => m.includes("names 'amount'"))).toBe(false);

      // The control: the same arm, the same object, `amount` named by NAME —
      // dropped and warned, so the drawing above is the entry's shape at work.
      cleanup();
      warn.mockClear();
      await mount('simple', {
        fields: ['customer'],
        sections: [{ name: 'second', label: 'Second', fields: ['customer', 'amount'] }],
      });
      expect(drawnFields()).toEqual(['customer']);
      expect(warn.mock.calls.map((call) => String(call[0])).some((m) => m.includes("names 'amount'"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
