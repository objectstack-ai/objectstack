/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28382 — an EDIT form names the fields a visible update action's
 * static `patch` would make required, before the action is pressed.
 *
 * The reported case, from the showcase: a draft invoice's "Issued On" carries
 * `requiredWhen: record.status in ['sent', 'paid']`, and "Submit for Sign-off"
 * is `operation: 'update'` + `patch: { status: 'sent' }`. The server runs the
 * rule over the record the patch leaves, so the first press was refused with
 * "Issued On is required", while the form — judging `status: 'draft'` — drew
 * nothing on the field.
 *
 * The door is the real `form` renderer with a data source in
 * `SchemaRendererContext`, which is where it reads the object's actions from.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
// Module scope, not `beforeAll` — see object-ui/no-dynamic-import-in-test-hook.
import '../../../renderers';
import { patchingUpdateActions } from '../actionRequirements';

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SUBMIT_SIGNOFF = {
  name: 'showcase_submit_signoff',
  label: 'Submit for Sign-off',
  operation: 'update',
  patch: { status: 'sent' },
  visible: { dialect: 'cel', source: "has(record.status) && record.status != 'sent'" },
  locations: ['list_item', 'record_header'],
};

const FIELDS = [
  { name: 'name', label: 'Invoice Number', type: 'input' },
  { name: 'status', label: 'Status', type: 'input' },
  {
    name: 'issued_on',
    label: 'Issued On',
    type: 'input',
    requiredWhen: { dialect: 'cel', source: "record.status in ['sent', 'paid']" },
  },
];

const DRAFT = { id: 'inv1', name: 'INV-1004', status: 'draft', issued_on: null };

const NOTE = 'Required to run “Submit for Sign-off”.';

function renderInvoiceForm(opts: {
  actions?: unknown[];
  record?: Record<string, unknown>;
  edit?: boolean;
  onSubmit?: (data: any) => unknown;
}) {
  const record = opts.record ?? DRAFT;
  const getObjectSchema = vi.fn(async () => ({ name: 'showcase_invoice', actions: opts.actions ?? [SUBMIT_SIGNOFF] }));
  const Form = ComponentRegistry.get('form')!;
  const view = render(
    <SchemaRendererContext.Provider value={{ dataSource: { getObjectSchema } } as any}>
      <Form
        schema={{
          type: 'form',
          objectName: 'showcase_invoice',
          showSubmit: true,
          showCancel: false,
          submitLabel: 'Save',
          defaultValues: record,
          ...(opts.edit === false ? {} : { previousValues: record }),
          fields: FIELDS,
          onSubmit: opts.onSubmit ?? (() => undefined),
        }}
      />
    </SchemaRendererContext.Provider>,
  );
  return { ...view, getObjectSchema };
}

const issuedOnInput = () => screen.getByLabelText(/Issued On/) as HTMLInputElement;
const noteOnIssuedOn = () =>
  document.querySelector('[data-testid="field:showcase_invoice.issued_on"] [data-required-for-action="true"]');

describe('form renderer — fields an update action would require (objectstack#28382)', () => {
  it('notes the action under the empty field its patch makes required, on an edit form', async () => {
    const { getObjectSchema } = renderInvoiceForm({});

    await waitFor(() => expect(noteOnIssuedOn()?.textContent).toBe(NOTE));
    expect(getObjectSchema).toHaveBeenCalledWith('showcase_invoice');
    // It is announced with the field: the note sits inside the description the
    // control's `aria-describedby` names.
    const describedBy = issuedOnInput().getAttribute('aria-describedby') ?? '';
    const described = describedBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain(NOTE);
    // Required for the action, not for Save: no asterisk state on the control.
    expect(issuedOnInput().getAttribute('aria-required')).toBeNull();
    // Only the field the rule names: the other fields carry no note.
    expect(document.querySelectorAll('[data-required-for-action="true"]')).toHaveLength(1);
  });

  it('never blocks Save: the record is written with the field still empty', async () => {
    const onSubmit = vi.fn();
    renderInvoiceForm({ onSubmit });
    await waitFor(() => expect(noteOnIssuedOn()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ status: 'draft' });
  });

  it('drops the note once the field holds a value', async () => {
    renderInvoiceForm({});
    await waitFor(() => expect(noteOnIssuedOn()).not.toBeNull());

    fireEvent.change(issuedOnInput(), { target: { value: '2026-10-31' } });

    await waitFor(() => expect(noteOnIssuedOn()).toBeNull());
  });

  it('gives way to the asterisk when the record as it stands already requires the field', async () => {
    renderInvoiceForm({});
    await waitFor(() => expect(noteOnIssuedOn()).not.toBeNull());

    // Typing the status the rule names makes the field required for Save
    // itself, and hides the action (its `visible` no longer holds).
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: 'paid' } });

    await waitFor(() => expect(issuedOnInput().getAttribute('aria-required')).toBe('true'));
    expect(noteOnIssuedOn()).toBeNull();
  });

  it('does not read or note anything on a create form', async () => {
    const { getObjectSchema } = renderInvoiceForm({ edit: false });
    // Let any effect settle before reading the absence.
    await new Promise((r) => setTimeout(r, 20));
    expect(getObjectSchema).not.toHaveBeenCalled();
    expect(noteOnIssuedOn()).toBeNull();
  });

  it('skips an action whose `visible` does not hold over the record', async () => {
    const { getObjectSchema } = renderInvoiceForm({
      actions: [{ ...SUBMIT_SIGNOFF, visible: { dialect: 'cel', source: "record.status == 'approved'" } }],
    });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(noteOnIssuedOn()).toBeNull();
  });

  it('skips an action that collects params', async () => {
    const { getObjectSchema } = renderInvoiceForm({
      actions: [{ ...SUBMIT_SIGNOFF, params: [{ name: 'note', type: 'text' }] }],
    });
    await waitFor(() => expect(getObjectSchema).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(noteOnIssuedOn()).toBeNull();
  });

  it('names every action that would require the field, one line each', async () => {
    renderInvoiceForm({
      actions: [
        SUBMIT_SIGNOFF,
        { name: 'mark_paid', label: 'Mark Paid', operation: 'update', patch: { status: 'paid' }, locations: ['record_header'] },
        // Writes a status the rule does not name: no line.
        { name: 'void_it', label: 'Void', operation: 'update', patch: { status: 'void' }, locations: ['record_header'] },
      ],
    });

    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll('[data-required-for-action="true"]')).map((n) => n.textContent),
      ).toEqual([NOTE, 'Required to run “Mark Paid”.']),
    );
  });
});

describe('patchingUpdateActions — which declared actions write only their patch', () => {
  it('keeps a placed `operation: update` action with a static patch and no params', () => {
    expect(patchingUpdateActions([SUBMIT_SIGNOFF]).map((a) => [a.name, a.label, a.patch])).toEqual([
      ['showcase_submit_signoff', 'Submit for Sign-off', { status: 'sent' }],
    ]);
  });

  it('leaves out every action whose write is not known before it runs', () => {
    expect(
      patchingUpdateActions([
        { ...SUBMIT_SIGNOFF, name: 'a', operation: undefined },
        { ...SUBMIT_SIGNOFF, name: 'b', type: 'api', operation: undefined, patch: undefined, target: '/x' },
        { ...SUBMIT_SIGNOFF, name: 'c', patch: {} },
        { ...SUBMIT_SIGNOFF, name: 'd', params: [{ name: 'p' }] },
        { ...SUBMIT_SIGNOFF, name: 'e', locations: [] },
        { ...SUBMIT_SIGNOFF, name: 'f', locations: undefined },
        null,
        'showcase_submit_signoff',
      ]),
    ).toEqual([]);
  });

  it('keeps an empty params list, falls back to the name for a label, and de-duplicates by name', () => {
    const found = patchingUpdateActions([
      { ...SUBMIT_SIGNOFF, params: [], label: undefined },
      SUBMIT_SIGNOFF,
    ]);
    expect(found.map((a) => a.label)).toEqual(['showcase_submit_signoff']);
  });

  it('answers none for anything that is not a list', () => {
    expect(patchingUpdateActions(undefined)).toEqual([]);
    expect(patchingUpdateActions({ actions: [SUBMIT_SIGNOFF] })).toEqual([]);
  });
});
