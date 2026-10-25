/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cascading / role-gated `checkboxes` options (#2715 follow-up) — parity with
 * `MultiSelectField` (ADR-0058 / #2284).
 *
 * Exercises the observable widget behaviour: the dependency gate (a "select the
 * parent first" empty-state) and the per-element cascade clear — a selection
 * dropped from the array when the offered set no longer includes it, while
 * still-valid selections are kept. The per-option filtering itself is unit-tested
 * in `@object-ui/core` (`optionRules.test.ts`); here we prove the checkbox list
 * wires `dependentValues` + predicate scope into that resolver via the shared
 * `useCascadingOptions` hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PredicateScopeProvider } from '@object-ui/react';
import { CheckboxesField } from './CheckboxesField';

const provinceField = {
  name: 'provinces',
  type: 'checkboxes',
  dependsOn: 'country',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CheckboxesField — dependency gating (#2715)', () => {
  it('gates with a "select parent first" hint while the controlling field is empty', () => {
    render(
      <CheckboxesField
        value={[]}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'provinces', dependentValues: {} } as any)}
      />,
    );
    const gate = screen.getByTestId('checkboxes-empty-provinces');
    expect(gate).toHaveTextContent(/select country first/i);
    // Gated → no checkboxes offered.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('unlocks the checkboxes once the controlling field is set', () => {
    render(
      <CheckboxesField
        value={[]}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'provinces', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(screen.queryByTestId('checkboxes-empty-provinces')).not.toBeInTheDocument();
    // Only the `cn` option is offered.
    expect(screen.getByRole('checkbox', { name: 'Zhejiang' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'California' })).not.toBeInTheDocument();
  });
});

describe('CheckboxesField — cascade clear (#2715)', () => {
  it('drops only the selections the parent change no longer offers', () => {
    const onChange = vi.fn();
    render(
      <CheckboxesField
        value={['zj', 'ca']}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'provinces', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    // 'ca' is a US province — under country=cn it is not offered, so it is
    // pruned; the still-valid 'zj' is kept.
    expect(onChange).toHaveBeenCalledWith(['zj']);
  });

  it('keeps selections that are all still offered', () => {
    const onChange = vi.fn();
    render(
      <CheckboxesField
        value={['zj']}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'provinces', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CheckboxesField — role / context gating (#2715)', () => {
  const tierField = {
    name: 'tiers',
    type: 'checkboxes',
    options: [
      { label: 'Standard', value: 'standard' },
      { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
    ],
  } as any;

  it('prunes an admin-only value for a non-admin (offered set excludes it)', () => {
    const onChange = vi.fn();
    render(
      <PredicateScopeProvider scope={{ current_user: { positions: ['sales'] } }}>
        <CheckboxesField
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
        <CheckboxesField
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
