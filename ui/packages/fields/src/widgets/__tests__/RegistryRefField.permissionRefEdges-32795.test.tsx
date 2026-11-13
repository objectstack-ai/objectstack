/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32795 — the `permission-ref` widget's by-name edges after
 * objectstack#32770 (ADR-0150 D3/D4/D8). Item 1 (a blocked option refused by
 * the widget itself) is pinned in `RegistryRefField.blockedOptionGuard-32795`,
 * which swaps the host combobox module-wide; item 3 (a seeded package) is the
 * record form's and is pinned in `@object-ui/plugin-form`.
 *
 *  - item 2: the grant pairing is recognised by the object the form stamps AND
 *    the column — a `permission_set` column on another object, or one no form
 *    stamped, takes a bare name: its package options are listed disabled even
 *    with a writer handed, and a click writes nothing;
 *  - item 4: an option key is the name, or the `[name, package]` pair as JSON,
 *    so a stored value the registry does not list never shares a key with a
 *    holder's option;
 *  - item 5: the read cell labels a name more than one holder serves by the
 *    holder the row's package column names, where the row carries that column;
 *    one holder, or a row without the column: by name, as before (CONTROL).
 *
 * objectstack#32833 item 3: an author's `formObject` is kept where the form has
 * no object to stamp, and an action param is never stamped, so it takes a bare
 * name.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { PermissionRefField } from '../RegistryRefField';
import { PermissionRefCell } from '../RegistryRefCell';
import { FORM_OBJECT_KEY, withFormObject, holderPackageFieldOf } from '../permissionSetHolders';

type Header = { name: string; label?: string; packageId?: string };

function lister(items: Header[]) {
  return { listMetadataItems: vi.fn(async () => items), find: vi.fn() } as any;
}

const TWO_PACKAGES: Header[] = [
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.hr' },
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
];
const CRM = 'Sales User (sales_user) · package com.acme.crm';
const HR = 'Sales User (sales_user) · package com.acme.hr';

const GRANT_DEF = { type: 'text', label: 'Permission Set', widget: 'permission-ref' };

function mountField(field: Record<string, unknown>, opts: { value?: string; onAutofill?: (p: Record<string, unknown>) => void } = {}) {
  const onChange = vi.fn();
  render(
    <PermissionRefField
      name="permission_set"
      value={opts.value ?? ''}
      onChange={onChange}
      field={field as any}
      dataSource={lister(TWO_PACKAGES)}
      dependentValues={{}}
      onAutofill={opts.onAutofill}
    />,
  );
  return { onChange };
}

function optionOf(text: string): HTMLElement {
  const item = screen.getByText(text).closest('[cmdk-item]');
  if (!item) throw new Error(`no option renders ${text}`);
  return item as HTMLElement;
}

afterEach(() => cleanup());

describe('objectstack#32795 item 2 — the grant pairing is recognised by object AND column', () => {
  it('the record form stamps the object on a `permission-ref` definition only, and hands every other one on untouched', () => {
    const grant = { ...GRANT_DEF };
    expect(withFormObject(grant, 'sys_user_permission_set')).toEqual({ ...GRANT_DEF, [FORM_OBJECT_KEY]: 'sys_user_permission_set' });
    expect(grant).not.toHaveProperty(FORM_OBJECT_KEY);
    const text = { type: 'text', label: 'Name' };
    expect(withFormObject(text, 'sys_user_permission_set')).toBe(text);
    expect(withFormObject(grant, undefined)).toBe(grant);
    expect(withFormObject(grant, '')).toBe(grant);
  });

  it('the grant object: a package option is pickable on a create and writes the package (CONTROL of the pairing)', async () => {
    const onAutofill = vi.fn();
    const { onChange } = mountField(withFormObject({ ...GRANT_DEF }, 'sys_user_permission_set'), { onAutofill });
    fireEvent.click(await screen.findByRole('combobox'));
    expect(optionOf(CRM)).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(optionOf(CRM));
    expect(onChange).toHaveBeenCalledWith('sales_user');
    expect(onAutofill).toHaveBeenCalledWith({ permission_set_package: 'com.acme.crm' });
  });

  it('a `permission_set` column on another object takes a bare name: package options disabled, a click writes nothing', async () => {
    const onAutofill = vi.fn();
    const { onChange } = mountField(withFormObject({ ...GRANT_DEF }, 'crm_deal'), { onAutofill });
    fireEvent.click(await screen.findByRole('combobox'));
    expect(optionOf(CRM)).toHaveAttribute('aria-disabled', 'true');
    expect(optionOf(HR)).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('registry-ref-permission-holder-needs-package')).toBeInTheDocument();
    fireEvent.click(optionOf(CRM));
    expect(onChange).not.toHaveBeenCalled();
    expect(onAutofill).not.toHaveBeenCalled();
  });

  it('a field no form stamped with its object is read the same way (narrower, never wider)', async () => {
    const onAutofill = vi.fn();
    mountField({ ...GRANT_DEF }, { onAutofill });
    fireEvent.click(await screen.findByRole('combobox'));
    expect(optionOf(CRM)).toHaveAttribute('aria-disabled', 'true');
    expect(optionOf(HR)).toHaveAttribute('aria-disabled', 'true');
  });
});

describe("objectstack#32795 item 4 — a holder's option key cannot be a stored value's", () => {
  it("a stored value spelled `name@package` stays its own option, and the holder's option still picks its holder", async () => {
    const onAutofill = vi.fn();
    const { onChange } = mountField(withFormObject({ ...GRANT_DEF }, 'sys_user_permission_set'), {
      value: 'sales_user@com.acme.crm',
      onAutofill,
    });
    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveAttribute('data-not-found', 'true');
    fireEvent.click(trigger);
    fireEvent.click(optionOf(CRM));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('sales_user');
    expect(onAutofill).toHaveBeenCalledWith({ permission_set_package: 'com.acme.crm' });
  });
});

const SHARED_LABELS: Header[] = [
  { name: 'sales_user', label: 'Sales (HR)', packageId: 'com.acme.hr' },
  { name: 'sales_user', label: 'Sales (CRM)', packageId: 'com.acme.crm' },
  { name: 'auditor', label: 'Auditor', packageId: 'com.acme.crm' },
];
const ENV_AND_PACKAGE_LABELS: Header[] = [
  { name: 'sales_user', label: 'Sales (here)', packageId: 'sys_metadata' },
  { name: 'sales_user', label: 'Sales (CRM)', packageId: 'com.acme.crm' },
];
const CELL_FIELD = { name: 'permission_set', type: 'text', widget: 'permission-ref' } as any;

function mountCells(items: Header[], rows: Array<{ value: string; row?: Record<string, unknown>; field?: unknown }>) {
  const ds = lister(items);
  render(
    <SchemaRendererProvider dataSource={ds}>
      {rows.map(({ value, row, field }, i) => (
        <div key={i} data-testid={`cell-${i}`}>
          <PermissionRefCell value={value} field={(field ?? CELL_FIELD) as any} dependentValues={row} />
        </div>
      ))}
    </SchemaRendererProvider>,
  );
  return ds;
}

function cellText(i: number): HTMLElement {
  return screen.getByTestId(`cell-${i}`).firstElementChild as HTMLElement;
}

describe('objectstack#32795 item 5 — the read cell labels by (package, name) where the row carries the package', () => {
  it("labels each row by the holder its package column names, and by no one's label where none is reached", async () => {
    mountCells(SHARED_LABELS, [
      { value: 'sales_user', row: { permission_set: 'sales_user', permission_set_package: 'com.acme.hr' } },
      { value: 'sales_user', row: { permission_set: 'sales_user', permission_set_package: 'com.acme.crm' } },
      // Two packages, the row names neither: the bare name, never one by order.
      { value: 'sales_user', row: { permission_set: 'sales_user', permission_set_package: null } },
      { value: 'auditor', row: { permission_set: 'auditor', permission_set_package: null } },
    ]);
    await waitFor(() => expect(cellText(3)).toHaveTextContent('Auditor'));
    expect(cellText(0)).toHaveTextContent(/^Sales \(HR\)$/);
    expect(cellText(1)).toHaveTextContent(/^Sales \(CRM\)$/);
    expect(cellText(2)).toHaveTextContent(/^sales_user$/);
    expect(cellText(0)).toHaveAttribute('title', 'sales_user');
  });

  it("a row naming no package is the environment's own set where the environment holds the name", async () => {
    mountCells(ENV_AND_PACKAGE_LABELS, [
      { value: 'sales_user', row: { permission_set_package: null } },
      { value: 'sales_user', row: { permission_set_package: 'com.acme.crm' } },
    ]);
    await waitFor(() => expect(cellText(0)).toHaveTextContent(/^Sales \(here\)$/));
    expect(cellText(1)).toHaveTextContent(/^Sales \(CRM\)$/);
  });

  it('CONTROL: a row without the package column, another column, or one holder labels by name as before', async () => {
    mountCells(SHARED_LABELS, [
      { value: 'sales_user' },
      { value: 'sales_user', row: { permission_set: 'sales_user' } },
      {
        value: 'sales_user',
        row: { permission_set_package: 'com.acme.hr' },
        field: { name: 'permissionSet', type: 'text', widget: 'permission-ref' },
      },
      { value: 'auditor', row: { permission_set_package: 'com.acme.crm' } },
    ]);
    await waitFor(() => expect(cellText(3)).toHaveTextContent(/^Auditor$/));
    // By name alone: the last label served for the name, exactly as before.
    expect(cellText(0)).toHaveTextContent(/^Sales \(CRM\)$/);
    expect(cellText(1)).toHaveTextContent(/^Sales \(CRM\)$/);
    expect(cellText(2)).toHaveTextContent(/^Sales \(CRM\)$/);
  });
});

describe('objectstack#32833 item 3 — where the form does not stamp its object', () => {
  it('a `formObject` an author wrote is kept when the widget key or the object name is missing, and the form stamp wins when present', () => {
    const authored = { ...GRANT_DEF, [FORM_OBJECT_KEY]: 'crm_deal' };
    // No object name to stamp: the definition is handed on as written.
    expect(withFormObject(authored, undefined)).toBe(authored);
    expect(withFormObject(authored, '')).toBe(authored);
    // Not a widget that reads the key: handed on as written, whatever it carries.
    const noWidget = { type: 'text', label: 'Permission Set', [FORM_OBJECT_KEY]: 'sys_user_permission_set' };
    expect(withFormObject(noWidget, 'crm_deal')).toBe(noWidget);
    // A form that knows its object stamps it over the authored value.
    expect(withFormObject(authored, 'sys_user_permission_set')).toEqual({ ...GRANT_DEF, [FORM_OBJECT_KEY]: 'sys_user_permission_set' });
  });

  it('an action param (`create_user`’s `permissionSet`) is never stamped and takes a bare name: package options disabled, a click writes nothing', async () => {
    const onAutofill = vi.fn();
    const onChange = vi.fn();
    const param = { type: 'text', label: 'Permission Set', widget: 'permission-ref' };
    render(
      <PermissionRefField
        name="permissionSet"
        value=""
        onChange={onChange}
        field={param as any}
        dataSource={lister(TWO_PACKAGES)}
        dependentValues={{}}
        onAutofill={onAutofill}
      />,
    );
    fireEvent.click(await screen.findByRole('combobox'));
    expect(optionOf(CRM)).toHaveAttribute('aria-disabled', 'true');
    expect(optionOf(HR)).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(optionOf(CRM));
    expect(onChange).not.toHaveBeenCalled();
    expect(onAutofill).not.toHaveBeenCalled();
    // Even stamped with the grant object, a param's column is not the grant's name column.
    expect(holderPackageFieldOf('sys_user_permission_set', 'permissionSet')).toBeNull();
    expect(holderPackageFieldOf(undefined, 'permission_set')).toBeNull();
    expect(holderPackageFieldOf('sys_user_permission_set', 'permission_set')).toBe('permission_set_package');
  });
});

describe('objectstack#32833 M1 — a stored package belongs to the name it was picked for', () => {
  const GRANT = withFormObject({ ...GRANT_DEF }, 'sys_user_permission_set');
  const field = (value: string, pkg: string | null, onAutofill: (p: Record<string, unknown>) => void) => (
    <PermissionRefField
      name="permission_set"
      value={value}
      onChange={vi.fn()}
      field={GRANT as any}
      dataSource={SHARED}
      dependentValues={{ permission_set_package: pkg }}
      onAutofill={onAutofill}
    />
  );
  const SHARED = lister([...TWO_PACKAGES, { name: 'other_set', label: 'Other Set', packageId: 'com.acme.crm' }, { name: 'other_set', label: 'Other Set', packageId: 'com.acme.hr' }]);

  it('the name changed by another path than a pick: the package it kept is cleared', async () => {
    const onAutofill = vi.fn();
    const view = render(field('sales_user', 'com.acme.crm', onAutofill));
    await screen.findByRole('combobox');
    expect(onAutofill).not.toHaveBeenCalled();
    view.rerender(field('other_set', 'com.acme.crm', onAutofill));
    await waitFor(() => expect(onAutofill).toHaveBeenCalledWith({ permission_set_package: null }));
  });

  it('CONTROL — the same name with its package, or a name with no package, writes nothing', async () => {
    const onAutofill = vi.fn();
    const view = render(field('sales_user', 'com.acme.crm', onAutofill));
    await screen.findByRole('combobox');
    view.rerender(field('sales_user', 'com.acme.crm', onAutofill));
    view.rerender(field('other_set', null, onAutofill));
    view.rerender(field('sales_user', null, onAutofill));
    expect(onAutofill).not.toHaveBeenCalled();
  });
});
