/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32795 item 1 — `permission-ref` refuses an option it marks as
 * blocked by itself, whatever the host control does with `disabled`.
 *
 * Where a form cannot write a holder's package, the widget lists that
 * package's option disabled (objectstack#32770). The shared combobox honours
 * `disabled`, but the refusal is the widget's: these pins swap the combobox
 * for a control that ignores `disabled` and hands every click to
 * `onValueChange`. A blocked option's click must still write nothing — no name
 * and no package — while the environment's own set stays pickable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  /** A host control that does NOT honour `options[].disabled`. */
  function CarelessCombobox({
    options,
    onValueChange,
  }: {
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    onValueChange?: (value: string) => void;
  }) {
    return (
      <div role="listbox">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-disabled-flag={option.disabled ? 'true' : undefined}
            onClick={() => onValueChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  return { ...actual, Combobox: CarelessCombobox };
});

import { PermissionRefField } from '../RegistryRefField';

type Header = { name: string; label?: string; packageId?: string };

const ENV_AND_PACKAGE: Header[] = [
  { name: 'sales_user', label: 'Sales User', packageId: 'sys_metadata' },
  { name: 'sales_user', label: 'Sales User', packageId: 'com.acme.crm' },
];
const ENV = 'Sales User (sales_user) · defined in this environment';
const CRM = 'Sales User (sales_user) · package com.acme.crm';

function mount(field: Record<string, unknown>, onAutofill?: (patch: Record<string, unknown>) => void) {
  const onChange = vi.fn();
  const dataSource = { listMetadataItems: vi.fn(async () => ENV_AND_PACKAGE), find: vi.fn() } as any;
  render(
    <PermissionRefField
      value=""
      onChange={onChange}
      field={field as any}
      dataSource={dataSource}
      dependentValues={{ permission_set_package: 'com.acme.crm' }}
      onAutofill={onAutofill}
    />,
  );
  return { onChange };
}

afterEach(() => cleanup());

describe('permission-ref — a blocked option is refused by the widget itself (objectstack#32795 item 1)', () => {
  it('an edit of a grant (no writer): a click on a package option writes nothing, the environment option writes the name', async () => {
    const { onChange } = mount({
      name: 'permission_set',
      type: 'text',
      widget: 'permission-ref',
      formObject: 'sys_user_permission_set',
    });
    const blocked = await screen.findByText(CRM);
    expect(blocked).toHaveAttribute('data-disabled-flag', 'true');

    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(ENV));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('sales_user');
  });

  it('an action param with a writer handed anyway: a click on a package option writes no name and no package', async () => {
    const onAutofill = vi.fn();
    const { onChange } = mount({ name: 'permissionSet', type: 'text' }, onAutofill);
    fireEvent.click(await screen.findByText(CRM));
    expect(onChange).not.toHaveBeenCalled();
    expect(onAutofill).not.toHaveBeenCalled();
  });
});
