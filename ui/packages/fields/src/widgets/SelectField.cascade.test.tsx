/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cascading / role-gated `select` options (#2284).
 *
 * Exercises the observable, non-Radix behaviour of {@link SelectField}: the
 * dependency gate (a "select the parent first" empty-state) and the cascade
 * clear (a value dropped when the offered set no longer includes it). The
 * per-option filtering itself is unit-tested in `@object-ui/core`
 * (`optionRules.test.ts`); here we prove the widget wires `dependentValues` +
 * predicate scope into that resolver.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PredicateScopeProvider } from '@object-ui/react';
import { SelectField } from './SelectField';

const provinceField = {
  name: 'province',
  type: 'select',
  dependsOn: 'country',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SelectField — dependency gating (#2284)', () => {
  it('gates with a "select parent first" hint while the controlling field is empty', () => {
    render(
      <SelectField
        value={undefined}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    const gate = screen.getByTestId('select-empty-province');
    expect(gate).toHaveTextContent(/select country first/i);
    // Gated → no live combobox is offered.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('unlocks the combobox once the controlling field is set', () => {
    render(
      <SelectField
        value={undefined}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(screen.queryByTestId('select-empty-province')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('SelectField — cascade clear (#2284)', () => {
  it('clears a value the parent change no longer offers', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value={'ca'}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    // 'ca' is a US province — under country=cn it is not offered, so it is dropped.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps a value that is still offered', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value={'zj'}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SelectField — role / context gating (#2284)', () => {
  const tierField = {
    name: 'tier',
    type: 'select',
    options: [
      { label: 'Standard', value: 'standard' },
      { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
    ],
  } as any;

  it('clears an admin-only value for a non-admin (offered set excludes it)', () => {
    const onChange = vi.fn();
    render(
      <PredicateScopeProvider scope={{ current_user: { positions: ['sales'] } }}>
        <SelectField
          value={'admin_only'}
          onChange={onChange}
          field={tierField}
          {...({ name: 'tier', dependentValues: {} } as any)}
        />
      </PredicateScopeProvider>,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps an admin-only value for an admin', () => {
    const onChange = vi.fn();
    render(
      <PredicateScopeProvider scope={{ current_user: { positions: ['admin'] } }}>
        <SelectField
          value={'admin_only'}
          onChange={onChange}
          field={tierField}
          {...({ name: 'tier', dependentValues: {} } as any)}
        />
      </PredicateScopeProvider>,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
