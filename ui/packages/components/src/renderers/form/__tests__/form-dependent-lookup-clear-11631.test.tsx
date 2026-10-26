/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11631 — a lookup scoped by `dependsOn` loses its selection when the
 * parent changes or clears, and keeps it when the record merely opens.
 *
 * ## The measured defect (card body, driven live twice in the 17.7 run)
 *
 * `showcase_invoice.contact` declares `dependsOn: ['account']`. New invoice →
 * Account Northwind → Contact "Prospect 18" → switch Account to Contoso →
 * Create: the read-back held `account: <Contoso>` beside `contact: <the
 * Northwind contact>`. The picker had re-scoped its candidate query, but the
 * selection already made survived, and the server checks only that a
 * reference exists. The form's cascade clear (#2284) never saw the field: it
 * skips every type outside `CASCADE_OPTION_WIDGET_TYPES` and every field with
 * no static `options`, and a lookup fails both tests.
 *
 * ## What is pinned
 *
 * - CLEAR rows — the parent switched or emptied by the user, on both shapes
 *   that reach this renderer (the object form's stashed field metadata, and a
 *   hand-written field carrying `dependsOn` itself), a multi-value lookup, and
 *   a two-level chain. The cleared value is an explicit `null` / `[]` that
 *   survives `JSON.stringify` (objectui#10291: an absent key means "leave it
 *   unchanged" on a PATCH).
 * - KEEP rows — an existing record opened for edit, whether its values are
 *   present at mount or land after first paint; a `recordId` swap in a
 *   still-mounted form; input the reset carries across a defaults change; a
 *   `resetOnSubmit` reset; a change of an unrelated field; a lookup holding
 *   nothing (never written to); and a `dependsOn` the picker does not scope
 *   by.
 *
 * These components tests never load `@object-ui/fields`, so `field:lookup` is
 * served by a probe that renders a plain input and calls `onChange` with the
 * id typed into it — the value channel the real `LookupField` uses when a
 * record is picked (`onChange(option.value)`) or its chip removed
 * (`onChange(null)`). The rule under test reads the FIELD CONFIG and the
 * form's values; nothing else can move a value in this environment.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

interface LookupProbeProps {
  name: string;
  value?: unknown;
  onChange: (next: string | null) => void;
}

function LookupProbe(props: LookupProbeProps) {
  const value = props.value;
  return (
    <input
      data-testid={`lookup-${props.name}`}
      value={Array.isArray(value) ? value.join(',') : value == null ? '' : String(value)}
      onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}
ComponentRegistry.register('field:lookup', LookupProbe, { namespace: 'test' });

type Rec = Record<string, unknown>;

function formSchema(schema: Rec): Rec {
  return { type: 'form', showSubmit: true, submitLabel: 'Save', ...schema };
}

function renderForm(schema: Rec) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={formSchema(schema)} />);
}

/** What `fromObjectSchema` (`@object-ui/plugin-form`) builds for the fixture. */
const OBJECT_FORM_FIELDS = [
  {
    name: 'account',
    label: 'Account',
    type: 'field:lookup',
    field: { name: 'account', type: 'lookup', reference: 'showcase_account' },
  },
  {
    name: 'contact',
    label: 'Contact',
    type: 'field:lookup',
    field: {
      name: 'contact',
      type: 'lookup',
      reference: 'showcase_contact',
      dependsOn: ['account'],
    },
  },
  { name: 'status', label: 'Status', type: 'input' },
];

const pick = (field: string, id: string) =>
  fireEvent.change(screen.getByTestId(`lookup-${field}`), { target: { value: id } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));

async function payloadOf(onSubmit: ReturnType<typeof vi.fn>, call = 1) {
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(call));
  return onSubmit.mock.calls[call - 1][0] as Rec;
}

/** The key is on the wire, not merely `== null` in memory (objectui#10291). */
function wireKeys(payload: Rec): string[] {
  return Object.keys(JSON.parse(JSON.stringify(payload)));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#11631 — a dependent lookup is cleared when its parent moves', () => {
  it('CREATE: switching the parent drops the pick made under the old parent', async () => {
    const onSubmit = vi.fn();
    renderForm({ fields: OBJECT_FORM_FIELDS, onSubmit });

    pick('account', 'northwind');
    pick('contact', 'prospect-18');
    pick('account', 'contoso');

    await waitFor(() =>
      expect((screen.getByTestId('lookup-contact') as HTMLInputElement).value).toBe(''),
    );
    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.account).toBe('contoso');
    expect(payload.contact).toBeNull();
    expect(wireKeys(payload)).toContain('contact');
  });

  it('EDIT: clearing the parent of a saved pair clears the lookup with an explicit null', async () => {
    const onSubmit = vi.fn();
    const stored = { account: 'northwind', contact: 'prospect-18', status: 'draft' };
    renderForm({
      fields: OBJECT_FORM_FIELDS,
      defaultValues: stored,
      previousValues: stored,
      onSubmit,
    });

    pick('account', '');
    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.account).toBeNull();
    expect(payload.contact).toBeNull();
    expect(wireKeys(payload)).toContain('contact');
  });

  it('a hand-written field carrying `dependsOn` itself clears the same way', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'account', label: 'Account', type: 'lookup' },
        { name: 'contact', label: 'Contact', type: 'lookup', dependsOn: ['account'] },
      ],
      defaultValues: { account: 'northwind', contact: 'prospect-18' },
      onSubmit,
    });

    pick('account', 'contoso');
    save();
    expect((await payloadOf(onSubmit)).contact).toBeNull();
  });

  it('a multi-value lookup is cleared to an empty list', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        OBJECT_FORM_FIELDS[0],
        {
          name: 'cc',
          label: 'CC',
          type: 'field:lookup',
          multiple: true,
          field: {
            name: 'cc',
            type: 'lookup',
            reference: 'showcase_contact',
            multiple: true,
            dependsOn: ['account'],
          },
        },
      ],
      defaultValues: { account: 'northwind', cc: ['prospect-18', 'prospect-19'] },
      onSubmit,
    });

    pick('account', 'contoso');
    save();
    expect((await payloadOf(onSubmit)).cc).toEqual([]);
  });

  it('a two-level chain converges: clearing the middle lookup clears the one it scopes', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        ...OBJECT_FORM_FIELDS,
        {
          name: 'site',
          label: 'Site',
          type: 'field:lookup',
          field: { name: 'site', type: 'lookup', reference: 'showcase_site', dependsOn: ['contact'] },
        },
      ],
      defaultValues: { account: 'northwind', contact: 'prospect-18', site: 'hq' },
      onSubmit,
    });

    pick('account', 'contoso');
    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.contact).toBeNull();
    expect(payload.site).toBeNull();
  });

  it('two lookups naming each other never wipe the pick that started the pass', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'a', label: 'A', type: 'lookup', dependsOn: ['b'] },
        { name: 'b', label: 'B', type: 'lookup', dependsOn: ['a'] },
      ],
      defaultValues: { a: 'a1', b: 'b1' },
      onSubmit,
    });

    pick('a', 'a2');
    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.a).toBe('a2');
    expect(payload.b).toBeNull();
  });
});

describe('objectui#11631 — what does NOT clear a dependent lookup', () => {
  it('EDIT: a saved pair present at mount survives a save that changed nothing', async () => {
    const onSubmit = vi.fn();
    const stored = { account: 'northwind', contact: 'prospect-18', status: 'draft' };
    renderForm({
      fields: OBJECT_FORM_FIELDS,
      defaultValues: stored,
      previousValues: stored,
      onSubmit,
    });

    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.account).toBe('northwind');
    expect(payload.contact).toBe('prospect-18');
  });

  it('EDIT: a record that lands AFTER first paint keeps its pair, and the rule is live afterwards', async () => {
    const onSubmit = vi.fn();
    const Form = ComponentRegistry.get('form')!;
    const { rerender } = render(<Form schema={formSchema({ fields: OBJECT_FORM_FIELDS, onSubmit })} />);

    const stored = { account: 'northwind', contact: 'prospect-18', status: 'draft' };
    rerender(
      <Form
        schema={formSchema({
          fields: OBJECT_FORM_FIELDS,
          defaultValues: stored,
          previousValues: stored,
          onSubmit,
        })}
      />,
    );
    await waitFor(() =>
      expect((screen.getByTestId('lookup-contact') as HTMLInputElement).value).toBe('prospect-18'),
    );

    save();
    expect((await payloadOf(onSubmit, 1)).contact).toBe('prospect-18');

    // The same mounted form still clears on a real switch.
    pick('account', 'contoso');
    save();
    expect((await payloadOf(onSubmit, 2)).contact).toBeNull();
  });

  it('a `recordId` swap in a still-mounted form keeps the NEW record\'s pair', async () => {
    const onSubmit = vi.fn();
    const Form = ComponentRegistry.get('form')!;
    const recordA = { account: 'northwind', contact: 'prospect-18', status: 'draft' };
    const recordB = { account: 'contoso', contact: 'buyer-3', status: 'sent' };
    const { rerender } = render(
      <Form
        schema={formSchema({
          fields: OBJECT_FORM_FIELDS,
          defaultValues: recordA,
          previousValues: recordA,
          onSubmit,
        })}
      />,
    );
    rerender(
      <Form
        schema={formSchema({
          fields: OBJECT_FORM_FIELDS,
          defaultValues: recordB,
          previousValues: recordB,
          onSubmit,
        })}
      />,
    );
    await waitFor(() =>
      expect((screen.getByTestId('lookup-account') as HTMLInputElement).value).toBe('contoso'),
    );

    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.account).toBe('contoso');
    expect(payload.contact).toBe('buyer-3');
  });

  it('input the reset CARRIES across a defaults change is part of the reset, not a parent switch', async () => {
    // The wizard shape (#2982): the next step's defaults name the contact but
    // not the account the user already picked, so the reset carries the
    // account across. Re-applying it is the same operation as the reset.
    const onSubmit = vi.fn();
    const Form = ComponentRegistry.get('form')!;
    const { rerender } = render(
      <Form
        schema={formSchema({ fields: OBJECT_FORM_FIELDS, defaultValues: { status: 'draft' }, onSubmit })}
      />,
    );
    pick('account', 'northwind');
    rerender(
      <Form
        schema={formSchema({
          fields: OBJECT_FORM_FIELDS,
          defaultValues: { status: 'draft', contact: 'prospect-18' },
          onSubmit,
        })}
      />,
    );
    await waitFor(() =>
      expect((screen.getByTestId('lookup-contact') as HTMLInputElement).value).toBe('prospect-18'),
    );

    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.account).toBe('northwind');
    expect(payload.contact).toBe('prospect-18');
  });

  it('a `resetOnSubmit` reset restores the defaults instead of reading as a parent switch', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: OBJECT_FORM_FIELDS,
      defaultValues: { account: 'northwind', contact: 'prospect-18' },
      resetOnSubmit: true,
      onSubmit,
    });

    pick('account', 'contoso');
    pick('contact', 'buyer-3');
    save();
    const first = await payloadOf(onSubmit, 1);
    expect(first.account).toBe('contoso');
    expect(first.contact).toBe('buyer-3');

    // The reset moved `account` back to `northwind`. It is the form being
    // reset, not the user switching the account, so the restored contact stays.
    await waitFor(() =>
      expect((screen.getByTestId('lookup-contact') as HTMLInputElement).value).toBe('prospect-18'),
    );
    save();
    const second = await payloadOf(onSubmit, 2);
    expect(second.account).toBe('northwind');
    expect(second.contact).toBe('prospect-18');
  });

  it('a change of an unrelated field keeps the pair', async () => {
    const onSubmit = vi.fn();
    const stored = { account: 'northwind', contact: 'prospect-18', status: 'draft' };
    renderForm({
      fields: OBJECT_FORM_FIELDS,
      defaultValues: stored,
      previousValues: stored,
      onSubmit,
    });

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'sent' } });
    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.status).toBe('sent');
    expect(payload.contact).toBe('prospect-18');
  });

  it('a lookup that holds nothing is not written to when its parent moves', async () => {
    const onSubmit = vi.fn();
    renderForm({ fields: OBJECT_FORM_FIELDS, onSubmit });

    pick('account', 'northwind');
    pick('account', 'contoso');
    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.account).toBe('contoso');
    expect(payload.contact ?? undefined).toBeUndefined();
    expect(wireKeys(payload)).not.toContain('contact');
  });

  it('BOUNDARY — a bare-name `dependsOn` the picker does not scope by moves nothing', async () => {
    // `LookupField` honours only the field-level ARRAY shape; a bare parent
    // name leaves its query unscoped, so there is no scope for a parent change
    // to move and nothing to clear.
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'account', label: 'Account', type: 'lookup' },
        { name: 'contact', label: 'Contact', type: 'lookup', dependsOn: 'account' },
      ],
      defaultValues: { account: 'northwind', contact: 'prospect-18' },
      onSubmit,
    });

    pick('account', 'contoso');
    save();
    expect((await payloadOf(onSubmit)).contact).toBe('prospect-18');
  });
});
