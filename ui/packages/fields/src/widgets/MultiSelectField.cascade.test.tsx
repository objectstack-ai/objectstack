/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cascading / role-gated `multiselect` options (#2715) — parity with the single
 * `SelectField` (ADR-0058 / #2284).
 *
 * Exercises the observable widget behaviour: the dependency gate (a "select the
 * parent first" empty-state), and the cascade clear — but here per-element: a
 * selection dropped from the array when the offered set no longer includes it,
 * while still-valid selections are kept. The per-option filtering itself is
 * unit-tested in `@object-ui/core` (`optionRules.test.ts`); here we prove the
 * chip picker wires `dependentValues` + predicate scope into that resolver via
 * the shared `useCascadingOptions` hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PredicateScopeProvider } from '@object-ui/react';
import { MultiSelectField } from './MultiSelectField';

const provinceField = {
  name: 'province',
  type: 'multiselect',
  dependsOn: 'country',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MultiSelectField — dependency gating (#2715)', () => {
  it('gates with a "select parent first" hint while the controlling field is empty', () => {
    render(
      <MultiSelectField
        value={[]}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    const gate = screen.getByTestId('multiselect-empty-province');
    expect(gate).toHaveTextContent(/select country first/i);
    // Gated → no chips offered.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('unlocks the chips once the controlling field is set', () => {
    render(
      <MultiSelectField
        value={[]}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(screen.queryByTestId('multiselect-empty-province')).not.toBeInTheDocument();
    // Only the `cn` option is offered.
    expect(screen.getByTestId('multiselect-option-zj')).toBeInTheDocument();
    expect(screen.queryByTestId('multiselect-option-ca')).not.toBeInTheDocument();
  });
});

describe('MultiSelectField — cascade clear (#2715)', () => {
  it('drops only the selections the parent change no longer offers', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectField
        value={['zj', 'ca']}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    // 'ca' is a US province — under country=cn it is not offered, so it is
    // pruned; the still-valid 'zj' is kept.
    expect(onChange).toHaveBeenCalledWith(['zj']);
  });

  it('keeps selections that are all still offered', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectField
        value={['zj']}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MultiSelectField — role / context gating (#2715)', () => {
  const tierField = {
    name: 'tiers',
    type: 'multiselect',
    options: [
      { label: 'Standard', value: 'standard' },
      { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
    ],
  } as any;

  it('prunes an admin-only value for a non-admin (offered set excludes it)', () => {
    const onChange = vi.fn();
    render(
      <PredicateScopeProvider scope={{ current_user: { positions: ['sales'] } }}>
        <MultiSelectField
          value={['standard', 'admin_only']}
          onChange={onChange}
          field={tierField}
          {...({ name: 'tiers', dependentValues: {} } as any)}
        />
      </PredicateScopeProvider>,
    );
    expect(onChange).toHaveBeenCalledWith(['standard']);
  });

  it('keeps an admin-only value for an admin', () => {
    const onChange = vi.fn();
    render(
      <PredicateScopeProvider scope={{ current_user: { positions: ['admin'] } }}>
        <MultiSelectField
          value={['standard', 'admin_only']}
          onChange={onChange}
          field={tierField}
          {...({ name: 'tiers', dependentValues: {} } as any)}
        />
      </PredicateScopeProvider>,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
