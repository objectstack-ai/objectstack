/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One `sections` block, one layout, on every `object-form` arm (objectui#10475,
 * with objectui#10476 folded in).
 *
 * The `drawer`, `modal`, `tabbed`, `wizard` and `split` arms build a section
 * through `buildSectionFields`: the entries in the section's AUTHORED order,
 * each spec `FormFieldSchema` entry (`{ field, … }`) applying its full
 * override set (`label`, `required`, `readonly`, `helpText`, `visibleWhen`, …)
 * through `normalizeSectionField`. The default arm (`SimpleObjectForm`)
 * resolved a section with its own name filter over its field pool instead, so
 * the same block drew its members in POOL order there, and every entry
 * override but `visibleOn` / `colSpan` / `span` was dropped — an authored
 * `required: true` was not enforced. The default arm now calls the same
 * builder, handed its pool (`SectionFieldsContext.pool`).
 *
 * The triage execution notes this file pins, verbatim: 「Pins, on all six
 * arms: a two-member section in reverse pool order renders in the section's
 * order; `label`, `required` and `visibleWhen` on a section entry take
 * effect.」 On a tree where the default arm keeps its own filter, the `simple`
 * rows of ORDER, LABEL, REQUIRED and VISIBLEWHEN are red and the other five
 * arms' rows are green.
 *
 * The last block is the default arm only, and pins the half that did NOT move
 * (「values, create defaults and the submitted set stay pool-driven」): the
 * pooled field stays the BASE an entry's overrides are written onto, and
 * field-level permissions still gate every member after the switch.
 *
 * Every row mounts the real `ObjectForm` with the arm's `formType`, the path
 * an author reaches. Every schema has ONE section, so the wizard's rendered
 * step is the section under test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(cleanup);

/** Declared in this order, so the POOL order is customer, note, amount. */
const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = (objectSchema: Record<string, unknown> = OBJECT_SCHEMA) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
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

/**
 * The editable control of a rendered field, if it has one. A field the caller
 * may not edit renders a read-only value display rather than a disabled input,
 * so "is it editable" is asked as "did it keep a control".
 */
const controlOf = (name: string): HTMLInputElement | HTMLTextAreaElement | null =>
  document.body.querySelector(`[data-field="${name}"] input, [data-field="${name}"] textarea`);

/** An enabled editable control of a rendered field, if it has one. */
const enabledControlOf = (name: string): Element | null =>
  document.body.querySelector(
    `[data-field="${name}"] input:not([disabled]), [data-field="${name}"] textarea:not([disabled])`,
  );

const MAIN_SECTION = (fields: Array<string | Record<string, unknown>>) => [
  { name: 'main', label: 'Main', fields },
];

async function mount(
  arm: Arm,
  schema: Record<string, unknown>,
  { objectSchema, wrap }: { objectSchema?: Record<string, unknown>; wrap?: (node: React.ReactElement) => React.ReactElement } = {},
) {
  const adapter = makeDataSource(objectSchema);
  const node = (
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: (objectSchema?.name as string | undefined) ?? 'invoice',
          mode: 'create',
          ...(arm === 'simple' ? {} : { formType: arm, open: true }),
          ...schema,
        } as any
      }
      dataSource={adapter}
    />
  );
  const utils = render(wrap ? wrap(node) : node);
  await waitFor(() => {
    if (!document.body.querySelector('form [data-field]')) throw new Error('form not ready');
  });
  return { ...utils, adapter };
}

describe.each(ARMS)('`object-form` `formType: %s` — a section entry is drawn by the one section builder', (arm) => {
  it('ORDER — a two-member section in reverse pool order renders in the section’s order', async () => {
    await mount(arm, { sections: MAIN_SECTION(['note', 'customer']) });
    expect(drawnFields(), 'the section lists `note` first; the object declares `customer` first').toEqual([
      'note',
      'customer',
    ]);
  });

  it('LABEL — a section entry’s `label` replaces the object’s', async () => {
    await mount(arm, {
      sections: MAIN_SECTION(['customer', { field: 'note', label: 'SECTION LABEL' }]),
    });
    expect(labelOf('note')).toBe('SECTION LABEL');
    expect(labelOf('customer'), 'the live control: an entry with no override keeps the object’s label').toBe(
      'Customer',
    );
  });

  it('REQUIRED — a section entry’s `required` refuses an empty submit and lets a filled one through', async () => {
    const { adapter } = await mount(arm, {
      sections: MAIN_SECTION(['customer', { field: 'note', label: 'SECTION LABEL', required: true }]),
    });
    expect(labelOf('note'), 'the marker is drawn').toBe('SECTION LABEL*');
    expect(controlOf('note')?.getAttribute('aria-required')).toBe('true');
    expect(controlOf('customer')?.getAttribute('aria-required'), 'the object does not require customer').toBeNull();

    // ⭐ The half an asterisk alone cannot show: validation refuses the submit.
    const form = document.body.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(document.body.textContent).toContain('SECTION LABEL is required'));
    expect(adapter.create, 'the entry’s `required` refused the empty submit').not.toHaveBeenCalled();

    fireEvent.change(controlOf('note') as HTMLInputElement, { target: { value: 'filled' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('invoice', expect.objectContaining({ note: 'filled' })),
    );
  });

  it('VISIBLEWHEN — a section entry’s `visibleWhen` hides the member until the record satisfies it', async () => {
    await mount(arm, {
      initialValues: { customer: 'hide' },
      sections: MAIN_SECTION(['customer', { field: 'note', visibleWhen: "record.customer == 'show'" }]),
    });
    expect(drawnFields(), 'the predicate is false for the opening record').toEqual(['customer']);

    // The live control: the SAME predicate turns true, and the member appears —
    // so the absence above is a predicate that evaluates, not a member dropped.
    fireEvent.change(controlOf('customer') as HTMLInputElement, { target: { value: 'show' } });
    await waitFor(() => expect(drawnFields()).toEqual(['customer', 'note']));
  });
});

describe('`object-form` default arm — what stays pool-driven after the switch (objectui#10475)', () => {
  it('the POOLED field is the base: an entry override keeps a per-field fact only the pool carries', async () => {
    // The default arm's field generator writes facts the shared
    // `fromObjectSchema` never produces — here the numeric `step` derived from
    // `scale`, which the form renderer's built-in `input` control spreads
    // onto its input (the route `objectFormNumericStep-9574` pins; until
    // objectui#12110 an unregistered `widget` name reached the same spread,
    // and now degrades to the registered widget instead). So the step
    // survives an entry override only if the override is written onto the
    // pooled field. This row used the ADR-0092 D4 managed-object lock until
    // objectui#10612 moved that lock out of the generator into
    // `gateFormFields`, which every arm applies after the builder: a lock
    // every arm draws can no longer tell a pooled base from any other.
    const STEPPED = {
      ...OBJECT_SCHEMA,
      fields: {
        ...OBJECT_SCHEMA.fields,
        qty: { type: 'number', label: 'Qty', scale: 2, widget: 'input' },
      },
    };
    const sections = MAIN_SECTION([{ field: 'qty', label: 'SECTION LABEL' }, 'customer']);
    await mount('simple', { sections }, { objectSchema: STEPPED });
    expect(drawnFields()).toEqual(['qty', 'customer']);
    expect(labelOf('qty'), 'the override applies').toBe('SECTION LABEL');
    expect(controlOf('qty')?.getAttribute('step'), '…and the pooled step stays').toBe('0.01');

    // The control: the same section on an arm with no pool, whose base is
    // `fromObjectSchema`, draws the same built-in input with no step — so the
    // `0.01` above is the pool's fact and not the renderer's.
    cleanup();
    await mount('drawer', { sections }, { objectSchema: STEPPED });
    expect(labelOf('qty')).toBe('SECTION LABEL');
    expect(controlOf('qty')).not.toBeNull();
    expect(controlOf('qty')?.getAttribute('step')).toBeNull();
  });

  it('field-level permissions still gate every member: a read-denied member is not drawn, a write-denied one is locked', async () => {
    const principal = (fields: Record<string, unknown>): any => ({
      authenticated: true,
      userId: 'u1',
      tenantId: null,
      roles: ['clerk'],
      permissionSets: ['clerk'],
      objects: { invoice: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
      fields,
    });
    const DENYING = principal({
      'invoice.amount': { readable: false, editable: false },
      'invoice.note': { readable: true, editable: false },
    });
    const sections = MAIN_SECTION(['amount', { field: 'note', label: 'SECTION LABEL', readonly: false }, 'customer']);

    await mount('simple', { sections }, {
      wrap: (node) => <MePermissionsProvider initialPermissions={DENYING}>{node}</MePermissionsProvider>,
    });
    expect(drawnFields(), '`amount` may not be read, so it is not drawn').toEqual(['note', 'customer']);
    expect(labelOf('note'), 'the entry override still applies to a gated member').toBe('SECTION LABEL');
    expect(enabledControlOf('note'), '`readonly: false` on the entry does not re-open a field the caller may not edit').toBeNull();
    expect(enabledControlOf('customer'), 'the live control: an ungated member keeps its control').not.toBeNull();

    // The absence control: the same principal with no field-level restriction
    // draws all three, in the section's order, and `note` editable.
    cleanup();
    await mount('simple', { sections }, {
      wrap: (node) => <MePermissionsProvider initialPermissions={principal({})}>{node}</MePermissionsProvider>,
    });
    expect(drawnFields()).toEqual(['amount', 'note', 'customer']);
    expect(enabledControlOf('note')).not.toBeNull();
  });
});
