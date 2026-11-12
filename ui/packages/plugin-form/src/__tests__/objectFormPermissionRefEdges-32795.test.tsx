/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32795 — the record form's half of the `permission-ref` edges
 * after objectstack#32770 (ADR-0150 D3/D4/D8).
 *
 *  - item 2: the form stamps the object it edits on a `permission-ref` field
 *    (`withFormObject`), on both field builders (`ObjectForm`'s generated
 *    fields and `sectionFields`, which the tabbed and wizard arms read), so the
 *    widget offers a package's pick on the grant's create form only — a
 *    `permission_set` column on another object lists it disabled;
 *  - item 3: a grant's CREATE form never opens with a seeded package column
 *    (`withoutSeededHolderPackage`, from `formOpeningValues` and
 *    `seedCreateValues`), so a seed is not shown as a pick the save would not
 *    write; the screen and the payload agree. `createHolderPackagePayload` is
 *    unchanged: a value equal to the seed is still not sent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup, screen, act } from '@testing-library/react';
import React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';
import { PERMISSION_SET_GRANT_COLUMNS } from '@object-ui/fields';

import { ObjectForm } from '../ObjectForm';
import { TabbedForm } from '../TabbedForm';
import { WizardForm } from '../WizardForm';
import { formWritePayload } from '../writePayload';
import { withoutSeededHolderPackage } from '../sanitize';
import { seedCreateValues } from '../schemaDefaults';

const FIELDS = {
  permission_set: { type: 'text', label: 'Permission Set', required: true, maxLength: 100, widget: 'permission-ref' },
  permission_set_package: { type: 'text', label: 'Permission Set Package', required: false, readonly: true, maxLength: 255 },
  note: { type: 'text', label: 'Note' },
};
const GRANT_SCHEMA = { name: 'sys_user_permission_set', fields: FIELDS };
const OTHER_SCHEMA = { name: 'crm_deal', fields: FIELDS };

const PERMISSION_ITEMS = [
  { name: 'sales_user', label: 'Sales User', packageId: 'sys_metadata' },
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
];
const ENV = 'Sales User (sales_user) · defined in this environment';
const CRM = 'Sales User (sales_user) · package com.acme.crm';

function dataSourceFor(objectSchema: Record<string, unknown>) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    listMetadataItems: vi.fn(async (_type: string) => PERMISSION_ITEMS),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'g1', ...d })),
    update: vi.fn(async (_o: string, id: string, d: Record<string, unknown>) => ({ id, ...d })),
    findOne: vi.fn(async () => null),
    find: vi.fn(async () => ({ data: [] })),
  };
}

function mountObjectForm(objectSchema: { name: string }, schema: Record<string, unknown> = {}) {
  const ds = dataSourceFor(objectSchema);
  const view = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ObjectForm schema={{ type: 'object-form', objectName: objectSchema.name, mode: 'create', ...schema } as any} dataSource={ds as any} />
    </SchemaRendererProvider>,
  );
  return { ds, ...view };
}

async function openPicker() {
  const trigger = await screen.findByRole('combobox');
  await waitFor(() => expect(trigger).toBeEnabled());
  await waitFor(() => expect(trigger).not.toHaveTextContent(/^$/));
  await act(async () => {
    fireEvent.click(trigger);
  });
  return trigger;
}

async function optionOf(text: string): Promise<HTMLElement> {
  const item = (await screen.findByText(text, { selector: '[cmdk-item] *, [cmdk-item]' })).closest('[cmdk-item]');
  if (!item) throw new Error(`no option renders ${text}`);
  return item as HTMLElement;
}

async function submit(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
}

afterEach(() => cleanup());

describe('objectstack#32795 item 2 — the form stamps its object, so the pairing is read by object and column', () => {
  it('the grant create form (generated fields): a package option is pickable', async () => {
    mountObjectForm(GRANT_SCHEMA);
    await openPicker();
    expect(await optionOf(CRM)).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('another object with a `permission_set` permission-ref column: the package option is disabled, with the note', async () => {
    const { ds, container } = mountObjectForm(OTHER_SCHEMA);
    await openPicker();
    const crm = await optionOf(CRM);
    expect(crm).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('registry-ref-permission-holder-needs-package')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(crm);
    });
    await act(async () => {
      fireEvent.click(await optionOf(ENV));
    });
    await submit(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toMatchObject({ permission_set: 'sales_user' });
    expect(ds.create.mock.calls[0][1]).not.toHaveProperty('permission_set_package');
  });

  const SECTIONS = [{ name: 'main', label: 'Main', fields: ['permission_set', 'note'] }];
  const ARMS: Array<[string, React.ComponentType<any>, string]> = [
    ['ObjectForm (authored sections)', ObjectForm as any, 'simple'],
    ['TabbedForm', TabbedForm as any, 'tabbed'],
    ['WizardForm', WizardForm as any, 'wizard'],
  ];
  describe.each(ARMS)('%s — `sectionFields` stamps the object too', (_name, Container, formType) => {
    for (const [objectSchema, pickable] of [
      [GRANT_SCHEMA, true],
      [OTHER_SCHEMA, false],
    ] as const) {
      it(`${objectSchema.name}: the package option is ${pickable ? 'pickable' : 'disabled'}`, async () => {
        const ds = dataSourceFor(objectSchema);
        render(
          <SchemaRendererProvider dataSource={ds as any}>
            <Container
              schema={{ type: 'object-form', formType, objectName: objectSchema.name, mode: 'create', sections: SECTIONS } as any}
              dataSource={ds as any}
            />
          </SchemaRendererProvider>,
        );
        await openPicker();
        const crm = await optionOf(CRM);
        if (pickable) expect(crm).not.toHaveAttribute('aria-disabled', 'true');
        else expect(crm).toHaveAttribute('aria-disabled', 'true');
      });
    }
  });
});

describe('objectstack#32795 item 3 — a seeded package is not shown as a pick', () => {
  it('a grant create form opened with a package seeded shows the name as the server reads it, and saves the name alone', async () => {
    const { ds, container } = mountObjectForm(GRANT_SCHEMA, {
      initialData: { permission_set: 'sales_user', permission_set_package: 'com.acme.crm', note: 'n' },
    });
    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger).toHaveTextContent(ENV));
    expect(trigger).not.toHaveTextContent(CRM);

    await submit(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toMatchObject({ permission_set: 'sales_user', note: 'n' });
    expect(ds.create.mock.calls[0][1]).not.toHaveProperty('permission_set_package');
  });

  it('a package the user then picks is a change, and is saved beside the name', async () => {
    const { ds, container } = mountObjectForm(GRANT_SCHEMA, {
      initialData: { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' },
    });
    const trigger = await openPicker();
    await act(async () => {
      fireEvent.click(await optionOf(CRM));
    });
    await waitFor(() => expect(trigger).toHaveTextContent(CRM));
    await submit(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toMatchObject({
      permission_set: 'sales_user',
      permission_set_package: 'com.acme.crm',
    });
  });

  it('drops the one key, on the grant object, on a create only', () => {
    const seed = { permission_set: 'sales_user', permission_set_package: 'com.acme.crm', note: 'n' };
    expect(withoutSeededHolderPackage(seed, 'sys_user_permission_set', PERMISSION_SET_GRANT_COLUMNS)).toStrictEqual({
      permission_set: 'sales_user',
      note: 'n',
    });
    // An edit (no create object), another object: untouched, the same object.
    expect(withoutSeededHolderPackage(seed, null, PERMISSION_SET_GRANT_COLUMNS)).toBe(seed);
    expect(withoutSeededHolderPackage(seed, 'crm_deal', PERMISSION_SET_GRANT_COLUMNS)).toBe(seed);
    const unseeded = { permission_set: 'sales_user' };
    expect(withoutSeededHolderPackage(unseeded, 'sys_user_permission_set', PERMISSION_SET_GRANT_COLUMNS)).toBe(unseeded);
  });

  it('`seedCreateValues` (the modal, drawer, tabbed and wizard create seed) drops it for the grant object only', () => {
    const initial = { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' };
    expect(seedCreateValues(GRANT_SCHEMA as any, initial)).toStrictEqual({ permission_set: 'sales_user' });
    expect(seedCreateValues(OTHER_SCHEMA as any, initial)).toStrictEqual(initial);
    expect(seedCreateValues({ fields: FIELDS } as any, initial)).toStrictEqual(initial);
  });

  it('the create payload is unchanged: a package equal to the baseline is still not sent, a changed one is', () => {
    const values = { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' };
    const save = (createBaseline: Record<string, unknown> | null) =>
      formWritePayload(values, { mode: 'create', objectName: 'sys_user_permission_set' }, {
        objectSchema: GRANT_SCHEMA as any,
        canEdit: undefined,
        snapshot: null,
        createBaseline,
      }).writePayload;
    expect(save({ permission_set_package: 'com.acme.crm' })).toStrictEqual({ permission_set: 'sales_user' });
    expect(save(null)).toStrictEqual({ permission_set: 'sales_user' });
    expect(save({})).toStrictEqual(values);
  });
});
