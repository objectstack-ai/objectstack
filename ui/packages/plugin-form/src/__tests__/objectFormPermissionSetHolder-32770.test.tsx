/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32770 — a permission-set grant's CREATE form writes the package
 * of the holder the user picked, beside the set's name, and nothing else
 * changes.
 *
 * The grant declares its package column `readonly`, so the outbound strip
 * drops it from every payload. The server takes it from an insert alone (a
 * named package that holds the name is kept, one that does not is refused
 * with a 409), and re-stamps it by its own rule on an update. So the record
 * form keeps exactly that one key, on that one object, on a create, when the
 * user's pick wrote it — and strips every other `readonly` key, every other
 * object's, and every edit's, exactly as before.
 *
 * Two layers: the outbound sequence itself (`formWritePayload`), and the
 * whole route through `ObjectForm` with the real `permission-ref` widget.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup, screen, act } from '@testing-library/react';
import React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';
import { PERMISSION_SET_GRANT_COLUMNS } from '@object-ui/fields';

import { ObjectForm } from '../ObjectForm';
import { formWritePayload } from '../writePayload';
import { createHolderPackagePayload, sanitizeFormData } from '../sanitize';

/** The grant's columns as plugin-security declares them, trimmed to what the form reads. */
const GRANT_SCHEMA = {
  name: 'sys_user_permission_set',
  fields: {
    permission_set: { type: 'text', label: 'Permission Set', required: true, maxLength: 100, widget: 'permission-ref' },
    permission_set_package: { type: 'text', label: 'Permission Set Package', required: false, readonly: true, maxLength: 255 },
    granted_by: { type: 'lookup', label: 'Granted By', reference: 'sys_user', required: false, readonly: true },
    note: { type: 'text', label: 'Note' },
  },
};

const CREATE = { mode: 'create', objectName: 'sys_user_permission_set' };

function save(
  values: Record<string, unknown>,
  {
    form = CREATE,
    objectSchema = GRANT_SCHEMA as any,
    createBaseline = {} as Record<string, unknown> | null,
    canEdit,
    customFields,
  }: {
    form?: { mode?: string; objectName: string; recordId?: string };
    objectSchema?: any;
    createBaseline?: Record<string, unknown> | null;
    canEdit?: (f: string) => boolean;
    customFields?: unknown[];
  } = {},
) {
  return formWritePayload(values, { ...form, customFields }, { objectSchema, canEdit, snapshot: null, createBaseline });
}

afterEach(() => cleanup());

describe('formWritePayload — the holder package on a grant create (objectstack#32770)', () => {
  it('keeps the package the pick wrote beside the name, and still strips every other readonly key', () => {
    const { payload, writePayload } = save({
      permission_set: 'sales_user',
      permission_set_package: 'com.acme.crm',
      granted_by: 'u9',
      note: 'n',
    });
    expect(writePayload).toStrictEqual({ permission_set: 'sales_user', note: 'n', permission_set_package: 'com.acme.crm' });
    expect(payload).toStrictEqual(writePayload);
  });

  it('CONTROL: a pick that wrote no package sends the name alone, as before', () => {
    expect(save({ permission_set: 'sales_user', granted_by: 'u9' }).writePayload).toStrictEqual({
      permission_set: 'sales_user',
    });
    // A cleared package (an environment pick after a package pick) is not sent:
    // the server stamps the column by its rule.
    for (const cleared of [null, undefined, '', '   ']) {
      expect(save({ permission_set: 'sales_user', permission_set_package: cleared }).writePayload).toStrictEqual({
        permission_set: 'sales_user',
      });
    }
  });

  it('an EDIT strips the package exactly as before, whatever the form holds', () => {
    const { payload, writePayload } = save(
      { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' },
      { form: { mode: 'edit', objectName: 'sys_user_permission_set', recordId: 'g1' } },
    );
    expect(payload).toStrictEqual({ permission_set: 'sales_user' });
    expect(writePayload).toStrictEqual({ permission_set: 'sales_user' });
  });

  it('CONTROL: another object with the same column names keeps its readonly strip', () => {
    const other = { ...GRANT_SCHEMA, name: 'crm_note' };
    expect(
      save(
        { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' },
        { form: { mode: 'create', objectName: 'crm_note' }, objectSchema: other },
      ).writePayload,
    ).toStrictEqual({ permission_set: 'sales_user' });
  });

  it('keeps it only when the user picked it: not without an opening baseline, not when the form opened with it', () => {
    const values = { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' };
    expect(save(values, { createBaseline: null }).writePayload).toStrictEqual({ permission_set: 'sales_user' });
    expect(
      save(values, { createBaseline: { permission_set_package: 'com.acme.crm' } }).writePayload,
    ).toStrictEqual({ permission_set: 'sales_user' });
  });

  it("never without the name it sits beside, the caller's field-level grant, or the object declaring it", () => {
    const values = { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' };
    // Field-level security refuses the package, or the name.
    expect(save(values, { canEdit: (f) => f !== 'permission_set_package' }).writePayload).toStrictEqual({
      permission_set: 'sales_user',
    });
    expect(save(values, { canEdit: (f) => f !== 'permission_set' }).writePayload).toStrictEqual({});
    // An inline form passes no definition, so nothing here proves the column
    // exists or reads it `readonly`: it adds nothing, and the payload is the
    // strip's own, exactly as before.
    expect(save(values, { customFields: [{ name: 'permission_set' }] }).writePayload).toStrictEqual(
      sanitizeFormData(values, null),
    );
    expect(
      createHolderPackagePayload({ permission_set: 'sales_user' }, {}, 'sys_user_permission_set', PERMISSION_SET_GRANT_COLUMNS, {
        values,
        objectSchema: null,
      }),
    ).toStrictEqual({ permission_set: 'sales_user' });
    // A definition without the column.
    const { permission_set_package: _omit, ...rest } = GRANT_SCHEMA.fields;
    expect(save(values, { objectSchema: { ...GRANT_SCHEMA, fields: rest } }).writePayload).toStrictEqual({
      permission_set: 'sales_user',
    });
  });

  it('lifts only the readonly branch: a system or computed package column is still refused', () => {
    const values = { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' };
    for (const flag of [{ system: true }, { computed: true }, { type: 'formula' }]) {
      const fields = {
        ...GRANT_SCHEMA.fields,
        permission_set_package: { ...GRANT_SCHEMA.fields.permission_set_package, ...flag },
      };
      expect(save(values, { objectSchema: { ...GRANT_SCHEMA, fields } }).writePayload).toStrictEqual({
        permission_set: 'sales_user',
      });
    }
  });

  it('is keyed by the one declared pair', () => {
    expect(PERMISSION_SET_GRANT_COLUMNS).toStrictEqual({
      object: 'sys_user_permission_set',
      nameField: 'permission_set',
      packageField: 'permission_set_package',
    });
    // The judgement itself admits only the pair's package column.
    expect(
      createHolderPackagePayload(
        { permission_set: 'sales_user' },
        {},
        'sys_user_permission_set',
        PERMISSION_SET_GRANT_COLUMNS,
        {
          values: { permission_set: 'sales_user', permission_set_package: 'com.acme.crm', granted_by: 'u9' },
          objectSchema: GRANT_SCHEMA,
        },
      ),
    ).toStrictEqual({ permission_set: 'sales_user', permission_set_package: 'com.acme.crm' });
  });
});

/** The registry: the environment's own `sales_user` beside a package's, and a name one package alone serves. */
const PERMISSION_ITEMS = [
  { name: 'sales_user', label: 'Sales User', packageId: 'sys_metadata' },
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
  { name: 'support_agent', label: 'Support Agent', packageId: 'com.acme.crm' },
];

const ENV = 'Sales User (sales_user) · defined in this environment';
const CRM = 'Sales User (sales_user) · package com.acme.crm';

function mount(schema: Record<string, unknown>, stored?: Record<string, unknown>) {
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue(GRANT_SCHEMA),
    listMetadataItems: vi.fn(async (_type: string) => PERMISSION_ITEMS),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'g1', ...d })),
    update: vi.fn(async (_o: string, id: string, d: Record<string, unknown>) => ({ id, ...stored, ...d })),
    findOne: vi.fn(async () => (stored ? { ...stored } : null)),
    find: vi.fn(async () => ({ data: [] })),
  };
  const view = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ObjectForm schema={{ type: 'object-form', objectName: 'sys_user_permission_set', ...schema } as any} dataSource={ds as any} />
    </SchemaRendererProvider>,
  );
  return { ds, ...view };
}

async function pickOption(text: string) {
  const trigger = await screen.findByRole('combobox');
  await waitFor(() => expect(trigger).toBeEnabled());
  await act(async () => {
    fireEvent.click(trigger);
  });
  const item = (await screen.findByText(text)).closest('[cmdk-item]') as HTMLElement;
  await act(async () => {
    fireEvent.click(item);
  });
  return { trigger, item };
}

async function submit(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
}

describe("ObjectForm — a grant's permission-set holder, end to end (objectstack#32770)", () => {
  it("a create form saves a package's pick as the name and that package", async () => {
    const { ds, container } = mount({ mode: 'create' });
    const { trigger } = await pickOption(CRM);
    await waitFor(() => expect(trigger).toHaveTextContent(CRM));

    await submit(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toMatchObject({
      permission_set: 'sales_user',
      permission_set_package: 'com.acme.crm',
    });
    expect(ds.create.mock.calls[0][1]).not.toHaveProperty('granted_by');
  });

  it("a create form saves the environment's pick, and a name one holder serves, as the name alone (CONTROL)", async () => {
    for (const text of [ENV, 'Support Agent (support_agent)']) {
      const { ds, container } = mount({ mode: 'create' });
      await pickOption(text);
      await submit(container);
      await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
      const sent = ds.create.mock.calls[0][1];
      expect(sent.permission_set).toBe(text === ENV ? 'sales_user' : 'support_agent');
      expect(sent).not.toHaveProperty('permission_set_package');
      cleanup();
    }
  });

  it("a package's pick then the environment's clears the package before the save", async () => {
    const { ds, container } = mount({ mode: 'create' });
    await pickOption(CRM);
    const { trigger } = await pickOption(ENV);
    await waitFor(() => expect(trigger).toHaveTextContent(ENV));
    await submit(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toMatchObject({ permission_set: 'sales_user' });
    expect(ds.create.mock.calls[0][1]).not.toHaveProperty('permission_set_package');
  });

  it("an edit form shows the stored holder, lists the package's option disabled, and never sends the package", async () => {
    const stored = { id: 'g1', permission_set: 'sales_user', permission_set_package: 'com.acme.crm', note: 'old' };
    const { ds, container } = mount({ mode: 'edit', recordId: 'g1' }, stored);

    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger).toHaveTextContent(CRM));
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect((await screen.findByText(CRM, { selector: '[cmdk-item] *, [cmdk-item]' })).closest('[cmdk-item]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByTestId('registry-ref-permission-holder-needs-package')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });

    const note = container.querySelector('input[name="note"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(note, { target: { value: 'new' } });
    });
    await submit(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const sent = ds.update.mock.calls[0][2];
    expect(sent).toMatchObject({ note: 'new' });
    expect(sent).not.toHaveProperty('permission_set_package');
  });
});
