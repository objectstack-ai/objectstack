/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cascading / role-gated `radio` options (#2715) — parity with the single
 * `SelectField` (ADR-0058 / #2284).
 *
 * Exercises the observable widget behaviour: the dependency gate (a "select the
 * parent first" empty-state) and the scalar cascade clear (a value dropped when
 * the offered set no longer includes it). The per-option filtering itself is
 * unit-tested in `@object-ui/core` (`optionRules.test.ts`); here we prove the
 * radio group wires `dependentValues` + predicate scope into that resolver via
 * the shared `useCascadingOptions` hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PredicateScopeProvider } from '@object-ui/react';
import { RadioField } from './RadioField';

const provinceField = {
  name: 'province',
  type: 'radio',
  dependsOn: 'country',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RadioField — dependency gating (#2715)', () => {
  it('gates with a "select parent first" hint while the controlling field is empty', () => {
    render(
      <RadioField
        value={undefined}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    const gate = screen.getByTestId('radio-empty-province');
    expect(gate).toHaveTextContent(/select country first/i);
    // Gated → no radios offered.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('unlocks the radios once the controlling field is set', () => {
    render(
      <RadioField
        value={undefined}
        onChange={vi.fn()}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(screen.queryByTestId('radio-empty-province')).not.toBeInTheDocument();
    // Only the `cn` option is offered.
    expect(screen.getByRole('radio', { name: 'Zhejiang' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'California' })).not.toBeInTheDocument();
  });
});

describe('RadioField — cascade clear (#2715)', () => {
  it('clears a value the parent change no longer offers', () => {
    const onChange = vi.fn();
    render(
      <RadioField
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
      <RadioField
        value={'zj'}
        onChange={onChange}
        field={provinceField}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RadioField — role / context gating (#2715)', () => {
  const tierField = {
    name: 'tier',
    type: 'radio',
    options: [
      { label: 'Standard', value: 'standard' },
      { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
    ],
  } as any;

  it('clears an admin-only value for a non-admin (offered set excludes it)', () => {
    const onChange = vi.fn();
    render(
      <PredicateScopeProvider scope={{ current_user: { positions: ['sales'] } }}>
        <RadioField
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
        <RadioField
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
