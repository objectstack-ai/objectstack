/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35033 — the form recomputes the object's formula fields from
 * the live inputs, so a required field whose `visibleWhen` reads a formula is
 * shown (and required) exactly when the server would require it.
 *
 * Before: a create form kept the field hidden whatever was typed (or, with the
 * formula not drawn on the form, faulted on the missing key and refused every
 * submit), and an edit that moved the inputs across the condition kept judging
 * the value last read — while the server judges the value the written record
 * would serve and required the field the user could not see.
 *
 * The door is the real `form` renderer with a data source in
 * `SchemaRendererContext`, which is where it reads the object's formulas from.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererContext, PredicateScopeProvider } from '@object-ui/react';
// Module scope, not `beforeAll` — see object-ui/no-dynamic-import-in-test-hook.
import '../../../renderers';
// `react-page.tsx` (reached through `../../../renderers`) loads this dynamically: pay the load at collection.
import '@object-ui/react-runtime';

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The object as the server serves it: two chained formulas and a hop. */
const ORDER_OBJECT = {
  name: 'order',
  fields: {
    qty: { type: 'number' },
    price: { type: 'number' },
    account: { type: 'lookup', reference: 'account' },
    total: { type: 'formula', expression: { dialect: 'cel', source: 'double(record.qty) * double(record.price)' } },
    big_order: { type: 'formula', expression: 'record.total > 100.0' },
    tier: { type: 'formula', expression: 'record.account.tier' },
    discount_note: { type: 'text', required: true, visibleWhen: 'record.big_order == true' },
    vip_note: { type: 'text', required: true, visibleWhen: "record.tier == 'gold'" },
  },
};

const DISCOUNT_NOTE = {
  name: 'discount_note',
  label: 'Discount note',
  type: 'input',
  required: true,
  visibleWhen: 'record.big_order == true',
};
const VIP_NOTE = { name: 'vip_note', label: 'VIP note', type: 'input', required: true, visibleWhen: "record.tier == 'gold'" };
const INPUTS = [
  { name: 'qty', label: 'Qty', type: 'input' },
  { name: 'price', label: 'Price', type: 'input' },
];

function renderOrderForm(opts: {
  fields: unknown[];
  record?: Record<string, unknown>;
  onSubmit?: (data: any) => unknown;
}) {
  const getObjectSchema = vi.fn(async () => ORDER_OBJECT);
  const Form = ComponentRegistry.get('form')!;
  const view = render(
    <SchemaRendererContext.Provider value={{ dataSource: { getObjectSchema } } as any}>
      <Form
        schema={{
          type: 'form',
          objectName: 'order',
          showSubmit: true,
          showCancel: false,
          submitLabel: 'Save',
          defaultValues: opts.record ?? {},
          ...(opts.record ? { previousValues: opts.record } : {}),
          fields: opts.fields,
          onSubmit: opts.onSubmit ?? (() => undefined),
        }}
      />
    </SchemaRendererContext.Provider>,
  );
  return { ...view, getObjectSchema };
}

const row = (name: string) => document.querySelector(`[data-testid="field:order.${name}"]`);
const type = async (label: string | RegExp, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
/** An object whose formulas read the acting user, and an update action whose patch moves a formula input. */
const TASK_OBJECT = {
  name: 'task',
  fields: {
    owner: { type: 'text' },
    status: { type: 'text' },
    is_mine: { type: 'formula', expression: 'record.owner == current_user.id' },
    may_edit: { type: 'formula', expression: "current_user.can('task', 'edit')" },
    is_done: { type: 'formula', expression: "record.status == 'done'" },
  },
  actions: [
    { name: 'complete', label: 'Complete', operation: 'update', patch: { status: 'done' }, locations: ['record_header'] },
  ],
};
const MINE_NOTE = { name: 'mine_note', label: 'Mine note', type: 'input', required: true, visibleWhen: 'record.is_mine == true' };
const EDIT_NOTE = { name: 'edit_note', label: 'Edit note', type: 'input', required: true, visibleWhen: 'record.may_edit == true' };
const OWNER = { name: 'owner', label: 'Owner', type: 'input' };
const ACTING_USER = { current_user: { id: 'u1', name: 'Ada', positions: [] } };

function renderTaskForm(opts: { fields: unknown[]; record?: Record<string, unknown>; onSubmit?: (data: any) => unknown }) {
  const getObjectSchema = vi.fn(async () => TASK_OBJECT);
  const Form = ComponentRegistry.get('form')!;
  const view = render(
    <PredicateScopeProvider scope={ACTING_USER}>
      <SchemaRendererContext.Provider value={{ dataSource: { getObjectSchema } } as any}>
        <Form
          schema={{
            type: 'form',
            objectName: 'task',
            showSubmit: true,
            showCancel: false,
            submitLabel: 'Save',
            defaultValues: opts.record ?? {},
            ...(opts.record ? { previousValues: opts.record } : {}),
            fields: opts.fields,
            onSubmit: opts.onSubmit ?? (() => undefined),
          }}
        />
      </SchemaRendererContext.Provider>
    </PredicateScopeProvider>,
  );
  return { ...view, getObjectSchema };
}
const taskRow = (name: string) => document.querySelector(`[data-testid="field:task.${name}"]`);

const faultBanner = () => /Can't submit: the visibleWhen rule/.test(document.body.textContent ?? '');

describe('form renderer — formula fields recomputed from the live inputs (objectstack#35033)', () => {
  it('create: the required field is hidden until the inputs make the formula satisfy it, then shown and required', async () => {
    const onSubmit = vi.fn();
    const { getObjectSchema } = renderOrderForm({ fields: [...INPUTS, DISCOUNT_NOTE], onSubmit });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalledWith('order'));
    await type('Qty', '2');
    await type('Price', '10');
    expect(row('discount_note')).toBeNull();

    await type('Qty', '20');
    await waitFor(() => expect(row('discount_note')).not.toBeNull());
    expect(screen.getByLabelText(/Discount note/).getAttribute('aria-required')).toBe('true');

    await save();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(faultBanner()).toBe(false);

    await type(/Discount note/, 'volume deal');
    await save();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Computed for the rules only: a formula is never written.
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ qty: '20', price: '10', discount_note: 'volume deal' });
    expect(payload).not.toHaveProperty('total');
    expect(payload).not.toHaveProperty('big_order');
  });

  it('edit: a served value outside the condition is recomputed when the inputs cross it', async () => {
    const served = { id: 'o1', qty: '1', price: '10', total: 10, big_order: false, discount_note: null };
    const { getObjectSchema } = renderOrderForm({ fields: [...INPUTS, DISCOUNT_NOTE], record: served });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalled());
    expect(row('discount_note')).toBeNull();

    await type('Qty', '50');
    await waitFor(() => expect(row('discount_note')).not.toBeNull());
    expect(screen.getByLabelText(/Discount note/).getAttribute('aria-required')).toBe('true');
  });

  it('edit: the reverse edit hides it again', async () => {
    const served = { id: 'o1', qty: '50', price: '10', total: 500, big_order: true, discount_note: 'x' };
    renderOrderForm({ fields: [...INPUTS, DISCOUNT_NOTE], record: served });
    expect(row('discount_note')).not.toBeNull();

    await type('Qty', '1');
    await waitFor(() => expect(row('discount_note')).toBeNull());
  });

  it('a formula reading through a reference cannot be computed here: the field is shown, required, and the submit goes through once it is filled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSubmit = vi.fn();
    const { getObjectSchema } = renderOrderForm({ fields: [...INPUTS, VIP_NOTE], onSubmit });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalled());
    await waitFor(() => expect(row('vip_note')).not.toBeNull());
    expect(screen.getByLabelText(/VIP note/).getAttribute('aria-required')).toBe('true');
    expect(warn.mock.calls.some(([m]) => /visibleWhen of field 'vip_note' reads a formula the form cannot compute/.test(String(m)))).toBe(true);

    await save();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(faultBanner()).toBe(false);

    await type(/VIP note/, 'call first');
    await save();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('an empty operand is a fault a read shares: the formula reads null, the predicate is judged on it, and the submit is not refused', async () => {
    const onSubmit = vi.fn();
    const { getObjectSchema } = renderOrderForm({ fields: [...INPUTS, DISCOUNT_NOTE], onSubmit });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalled());
    await type('Qty', '20');
    expect(row('discount_note')).toBeNull();

    await save();
    expect(faultBanner()).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a formula reading current_user.id is computed for the acting user of the predicate scope, and the field is judged on it', async () => {
    const onSubmit = vi.fn();
    const { getObjectSchema } = renderTaskForm({ fields: [OWNER, MINE_NOTE], onSubmit });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalledWith('task'));
    await type('Owner', 'u2');
    // Cleanly not TRUE: hidden, and no fault refuses the submit.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(taskRow('mine_note')).toBeNull();
    await save();
    expect(faultBanner()).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await type('Owner', 'u1');
    await waitFor(() => expect(taskRow('mine_note')).not.toBeNull());
    expect(screen.getByLabelText(/Mine note/).getAttribute('aria-required')).toBe('true');
  });

  it('a formula calling current_user.can() stays unservable with a user bound: the field is shown and required', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getObjectSchema } = renderTaskForm({ fields: [OWNER, EDIT_NOTE] });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalled());
    await waitFor(() =>
      expect(warn.mock.calls.some(([m]) => /visibleWhen of field 'edit_note' reads a formula the form cannot compute/.test(String(m)))).toBe(true),
    );
    expect(taskRow('edit_note')).not.toBeNull();
    expect(screen.getByLabelText(/Edit note/).getAttribute('aria-required')).toBe('true');
  });

  it('an update action whose patch moves a formula input is judged on the formula recomputed over the patched record', async () => {
    const ISSUED_ON = { name: 'issued_on', label: 'Issued on', type: 'input', requiredWhen: 'record.is_done == true' };
    const served = { id: 't1', owner: 'u1', status: 'open', is_done: false, issued_on: null };
    renderTaskForm({ fields: [OWNER, ISSUED_ON], record: served });
    await waitFor(() =>
      expect(document.querySelector('[data-testid="field:task.issued_on"] [data-required-for-action="true"]')?.textContent).toBe(
        'Required to run “Complete”.',
      ),
    );
  });
});
