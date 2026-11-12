/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32770 — `permission-ref` where more than one holder serves a
 * permission set's name (ADR-0150 D4/D8 R1).
 *
 * A permission set is identified by `(package, name)`, and the registry serves
 * one item per holder, each with the package it was served under. These pins
 * hold what the widget promises about such a name:
 *
 *  - CONTROL: a name one holder serves is listed, written and shown exactly as
 *    before, whatever package it came from, with no note beside the picker;
 *  - a name more than one holder serves is one option per holder, each naming
 *    its holder, and a pick writes the NAME;
 *  - on a grant's create form (the record form's sibling writer present) a
 *    package's option also writes that package into the grant's package
 *    column, and a later pick that needs none clears it;
 *  - where the form cannot write the package (an edit of a grant, an action
 *    param that takes a bare name) a package's option is listed, disabled,
 *    and a note says why; the environment's own set stays pickable; nothing
 *    is ever resolved to one holder by order;
 *  - a stored name is shown as the holder the row's package column names,
 *    else the environment's own set, else marked as naming no holder.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PermissionRefField } from '../RegistryRefField';

type Header = { name: string; label?: string; packageId?: string };

function lister(items: Header[]) {
  return { listMetadataItems: vi.fn(async () => items), find: vi.fn() } as any;
}

/** The grant's name column, or an action param that names a set by its name alone. */
const GRANT_FIELD = { name: 'permission_set', type: 'text', label: 'Permission Set' };
const ACTION_PARAM = { name: 'permissionSet', type: 'text', label: 'Permission Set' };

function mount({
  items,
  value = '',
  field = GRANT_FIELD,
  dependentValues,
  onAutofill,
  readonly = false,
}: {
  items: Header[];
  value?: string;
  field?: { name: string; type: string; label: string };
  dependentValues?: Record<string, unknown>;
  onAutofill?: (patch: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const onChange = vi.fn();
  const dataSource = lister(items);
  render(
    <PermissionRefField
      value={value}
      onChange={onChange}
      readonly={readonly}
      field={field as any}
      dataSource={dataSource}
      dependentValues={dependentValues}
      onAutofill={onAutofill}
      id="f-permission-set"
    />,
  );
  return { onChange, dataSource };
}

/** The cmdk item that renders `text`. */
function optionOf(text: string): HTMLElement {
  const item = screen.getByText(text).closest('[cmdk-item]');
  if (!item) throw new Error(`no option renders ${text}`);
  return item as HTMLElement;
}

const ENV = 'Sales User (sales_user) · defined in this environment';
const CRM = 'Sales User (sales_user) · package com.acme.crm';
const HR = 'Sales User (sales_user) · package com.acme.hr';

/** The environment's own set and one package's set of one name, beside a name one package alone serves. */
const ENV_AND_PACKAGE: Header[] = [
  { name: 'sales_user', label: 'Sales User', packageId: 'sys_metadata' },
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
  { name: 'support_agent', label: 'Support Agent', packageId: 'com.acme.crm' },
];

/** Two packages' sets of one name, and no set of the environment's own. */
const TWO_PACKAGES: Header[] = [
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.hr' },
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
];

afterEach(() => cleanup());

describe('permission-ref — CONTROL: a name one holder serves (objectstack#32770)', () => {
  it('lists, writes and shows each name as before, whatever package served it, and writes no package', async () => {
    const onAutofill = vi.fn();
    const { onChange } = mount({
      items: [
        { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
        { name: 'org_admin', label: 'Org Admin', packageId: 'sys_metadata' },
        { name: 'auditor' },
      ],
      dependentValues: { permission_set_package: null },
      onAutofill,
    });

    fireEvent.click(await screen.findByRole('combobox'));
    const labels = Array.from(document.querySelectorAll('[cmdk-item]')).map((el) => el.textContent);
    expect(labels).toEqual(['auditor', 'Org Admin (org_admin)', 'Sales User (sales_user)']);
    expect(screen.queryByText(/package com\.acme\.crm/)).toBeNull();
    expect(screen.queryByText(/defined in this environment/)).toBeNull();
    expect(screen.queryByTestId('registry-ref-permission-holder-needs-package')).toBeNull();

    fireEvent.click(screen.getByText('Sales User (sales_user)'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('sales_user');
    expect(onAutofill).not.toHaveBeenCalled();
  });

  it('shows a stored name one holder serves by its label beside the name, editable and read-only', async () => {
    const items = [{ name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' }];
    mount({ items, value: 'sales_user' });
    expect(await screen.findByRole('combobox')).toHaveTextContent(/^Sales User \(sales_user\)$/);
    cleanup();

    mount({ items, value: 'sales_user', readonly: true });
    const shown = await screen.findByText('Sales User (sales_user)');
    expect(shown).not.toHaveAttribute('data-holder-unresolved');
    expect(shown).not.toHaveAttribute('data-not-found');
  });
});

describe('permission-ref — a name more than one holder serves, on a grant create form (objectstack#32770)', () => {
  it('lists one option per holder, the environment first, each naming its holder', async () => {
    mount({ items: ENV_AND_PACKAGE, onAutofill: vi.fn(), dependentValues: {} });

    fireEvent.click(await screen.findByRole('combobox'));
    const labels = Array.from(document.querySelectorAll('[cmdk-item]')).map((el) => el.textContent);
    expect(labels).toEqual([ENV, CRM, 'Support Agent (support_agent)']);
    expect(optionOf(ENV)).not.toHaveAttribute('aria-disabled', 'true');
    expect(optionOf(CRM)).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('registry-ref-permission-holder-needs-package')).toBeNull();
  });

  it("a package's option writes the name, and that package into the grant's package column", async () => {
    const onAutofill = vi.fn();
    const { onChange } = mount({ items: TWO_PACKAGES, onAutofill, dependentValues: {} });

    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(optionOf(HR));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('sales_user');
    expect(onAutofill).toHaveBeenCalledTimes(1);
    expect(onAutofill).toHaveBeenCalledWith({ permission_set_package: 'com.acme.hr' });
  });

  it("the environment's option writes the name alone, and clears a package an earlier pick wrote", async () => {
    const fresh = vi.fn();
    const first = mount({ items: ENV_AND_PACKAGE, onAutofill: fresh, dependentValues: {} });
    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(optionOf(ENV));
    expect(first.onChange).toHaveBeenCalledWith('sales_user');
    expect(fresh).not.toHaveBeenCalled();
    cleanup();

    const earlier = vi.fn();
    const second = mount({
      items: ENV_AND_PACKAGE,
      value: 'sales_user',
      onAutofill: earlier,
      dependentValues: { permission_set_package: 'com.acme.crm' },
    });
    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(optionOf(ENV));
    expect(second.onChange).toHaveBeenCalledWith('sales_user');
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(earlier).toHaveBeenCalledWith({ permission_set_package: null });
  });

  it('a name one holder serves, picked after a package was written, clears that package', async () => {
    const onAutofill = vi.fn();
    const { onChange } = mount({
      items: ENV_AND_PACKAGE,
      value: 'sales_user',
      onAutofill,
      dependentValues: { permission_set_package: 'com.acme.crm' },
    });
    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(screen.getByText('Support Agent (support_agent)'));
    expect(onChange).toHaveBeenCalledWith('support_agent');
    expect(onAutofill).toHaveBeenCalledWith({ permission_set_package: null });
  });

  it('the trigger shows the holder the package column names', async () => {
    mount({
      items: TWO_PACKAGES,
      value: 'sales_user',
      onAutofill: vi.fn(),
      dependentValues: { permission_set_package: 'com.acme.crm' },
    });
    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent(CRM);
    expect(trigger).not.toHaveAttribute('data-holder-unresolved');
  });
});

describe('permission-ref — a target that takes a bare name (objectstack#32770)', () => {
  it("an edit of a grant lists a package's option disabled, says why, and keeps the environment's pickable", async () => {
    const { onChange } = mount({ items: ENV_AND_PACKAGE, dependentValues: { permission_set_package: null } });

    fireEvent.click(await screen.findByRole('combobox'));
    expect(optionOf(CRM)).toHaveAttribute('aria-disabled', 'true');
    expect(optionOf(ENV)).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('registry-ref-permission-holder-needs-package')).toHaveTextContent(
      'This form names a permission set by its name only.',
    );

    fireEvent.click(optionOf(CRM));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(optionOf(ENV));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('sales_user');
  });

  it('an action param refuses every package option even when a writer is handed, and resolves nothing by order', async () => {
    const onAutofill = vi.fn();
    const { onChange } = mount({ items: TWO_PACKAGES, field: ACTION_PARAM, onAutofill, dependentValues: {} });

    fireEvent.click(await screen.findByRole('combobox'));
    expect(optionOf(CRM)).toHaveAttribute('aria-disabled', 'true');
    expect(optionOf(HR)).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('registry-ref-permission-holder-needs-package')).toBeInTheDocument();

    fireEvent.click(optionOf(HR));
    fireEvent.click(optionOf(CRM));
    expect(onChange).not.toHaveBeenCalled();
    expect(onAutofill).not.toHaveBeenCalled();
  });
});

describe('permission-ref — a stored name more than one holder serves (objectstack#32770)', () => {
  it('read-only: the holder the package column names, else the environment, else no holder named', async () => {
    mount({
      items: [...ENV_AND_PACKAGE, { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.hr' }],
      value: 'sales_user',
      readonly: true,
      dependentValues: { permission_set_package: 'com.acme.hr' },
    });
    expect(await screen.findByText(HR)).toBeInTheDocument();
    cleanup();

    // A package that no longer serves the name is read as no package: the
    // environment's own set.
    mount({
      items: ENV_AND_PACKAGE,
      value: 'sales_user',
      readonly: true,
      dependentValues: { permission_set_package: 'com.acme.retired' },
    });
    expect(await screen.findByText(ENV)).toBeInTheDocument();
    cleanup();

    mount({ items: TWO_PACKAGES, value: 'sales_user', readonly: true, dependentValues: { permission_set_package: null } });
    const unresolved = await screen.findByText('sales_user (several packages provide it; none named)');
    expect(unresolved).toHaveAttribute('data-holder-unresolved', 'true');
    expect(unresolved).not.toHaveAttribute('data-not-found');
  });

  it('editable: a name two packages serve and the row names neither of stays its own option, flagged', async () => {
    const { onChange } = mount({ items: TWO_PACKAGES, value: 'sales_user', dependentValues: {} });
    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent('sales_user (several packages provide it; none named)');
    expect(trigger).toHaveAttribute('data-holder-unresolved', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a non-grant field is never read against the grant package column', async () => {
    mount({
      items: TWO_PACKAGES,
      value: 'sales_user',
      field: ACTION_PARAM,
      readonly: true,
      dependentValues: { permission_set_package: 'com.acme.crm' },
    });
    await waitFor(() => expect(screen.getByText('sales_user (several packages provide it; none named)')).toBeInTheDocument());
  });
});
