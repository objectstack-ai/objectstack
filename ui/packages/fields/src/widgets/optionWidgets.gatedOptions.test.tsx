/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A GATED option list never deletes the stored value (objectui#4247).
 *
 * The four fixed-option widgets end their cascade resolution with a "drop what
 * is no longer offered" effect (ADR-0058 / #2715). `resolveCascadingOptions`
 * returns an EMPTY offered set whenever the list is gated — a declared
 * `dependsOn` parent is still empty — so on mount the effect found nothing
 * "still offered" and wrote the field empty, while the widget was rendering
 * `OptionsEmptyState` ("select Country first") right next to it: the control
 * tells the user it cannot offer anything, and deletes what they had.
 *
 * Ruling (#4247): **gated means UNKNOWN, not invalid.** The cascade clear exists
 * so a USER-DRIVEN parent change prunes a now-invalid child; a gated set on
 * MOUNT is missing information — the record simply arrived with the parent
 * empty (a later-cleared parent, an import, a partially-migrated row) — and
 * destroying stored data on missing information is silent data loss. Convergence
 * stays where it belongs: once the parent IS chosen and the resolved set
 * genuinely excludes the stored value, the existing prune applies.
 *
 * Three states, kept apart here so a future edit cannot collapse them:
 *
 *  1. never-configured — no authored `options` at all. Guarded since #4220;
 *     control only, pinned in `optionWidgets.unconfiguredOptions.test.tsx`.
 *  2. gated — an authored list withheld behind an unmet `dependsOn`. NEW: the
 *     value survives.
 *  3. resolved-and-excludes — the parent IS chosen and the resolved set does not
 *     offer the stored value. Clears; that is the ADR-0058 contract.
 *
 * The gate is read from the resolver's own `gated` flag, never re-derived from
 * `options.length === 0` — that would collide with state 1, which is a
 * different case with a different guard.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { CheckboxesField } from './CheckboxesField';
import { RadioField } from './RadioField';

/** Options that exist for exactly one country — the cascade the gate withholds. */
const PROVINCE_OPTIONS = [
  { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
  { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
];

const provinceField = (type: string) =>
  ({ name: 'province', type, dependsOn: 'country', options: PROVINCE_OPTIONS }) as any;

describe('option widgets — a GATED list never deletes the stored value (#4247)', () => {
  it('MultiSelectField keeps its array and shows the parent-first hint', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectField
        value={['zj']}
        onChange={onChange}
        field={provinceField('multiselect')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(screen.getByTestId('multiselect-empty-province')).toHaveTextContent(
      /select country first/i,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('CheckboxesField keeps its array and shows the parent-first hint', () => {
    const onChange = vi.fn();
    render(
      <CheckboxesField
        value={['zj']}
        onChange={onChange}
        field={provinceField('checkboxes')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(screen.getByTestId('checkboxes-empty-province')).toHaveTextContent(
      /select country first/i,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('RadioField keeps its value and shows the parent-first hint', () => {
    const onChange = vi.fn();
    render(
      <RadioField
        value="zj"
        onChange={onChange}
        field={provinceField('radio')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(screen.getByTestId('radio-empty-province')).toHaveTextContent(/select country first/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('SelectField keeps its value and shows the parent-first hint', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value="zj"
        onChange={onChange}
        field={provinceField('select')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(screen.getByTestId('select-empty-province')).toHaveTextContent(/select country first/i);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('controls — a RESOLVED list still prunes what it does not offer (ADR-0058)', () => {
  it('MultiSelectField drops the element the chosen parent excludes', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectField
        value={['zj', 'ca']}
        onChange={onChange}
        field={provinceField('multiselect')}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(['zj']);
  });

  it('CheckboxesField drops the element the chosen parent excludes', () => {
    const onChange = vi.fn();
    render(
      <CheckboxesField
        value={['zj', 'ca']}
        onChange={onChange}
        field={provinceField('checkboxes')}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(['zj']);
  });

  it('RadioField clears a value the chosen parent excludes', () => {
    const onChange = vi.fn();
    render(
      <RadioField
        value="ca"
        onChange={onChange}
        field={provinceField('radio')}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('SelectField clears a value the chosen parent excludes', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value="ca"
        onChange={onChange}
        field={provinceField('select')}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('transition — a gated field converges the moment its parent is chosen (#4247)', () => {
  it('MultiSelectField: gated keeps, then prunes once the resolved set excludes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MultiSelectField
        value={['zj']}
        onChange={onChange}
        field={provinceField('multiselect')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    // Gated: the value survives, nothing is staged.
    expect(onChange).not.toHaveBeenCalled();

    // The user picks the parent — the set resolves and genuinely excludes 'zj'.
    rerender(
      <MultiSelectField
        value={['zj']}
        onChange={onChange}
        field={provinceField('multiselect')}
        {...({ name: 'province', dependentValues: { country: 'us' } } as any)}
      />,
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('MultiSelectField: a resolved set that INCLUDES the stored value keeps it', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MultiSelectField
        value={['zj']}
        onChange={onChange}
        field={provinceField('multiselect')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    rerender(
      <MultiSelectField
        value={['zj']}
        onChange={onChange}
        field={provinceField('multiselect')}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('multiselect-option-zj')).toBeInTheDocument();
  });

  it('SelectField: gated keeps, then clears once the resolved set excludes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField
        value="zj"
        onChange={onChange}
        field={provinceField('select')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <SelectField
        value="zj"
        onChange={onChange}
        field={provinceField('select')}
        {...({ name: 'province', dependentValues: { country: 'us' } } as any)}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('SelectField: a resolved set that INCLUDES the stored value keeps it', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField
        value="zj"
        onChange={onChange}
        field={provinceField('select')}
        {...({ name: 'province', dependentValues: {} } as any)}
      />,
    );
    rerender(
      <SelectField
        value="zj"
        onChange={onChange}
        field={provinceField('select')}
        {...({ name: 'province', dependentValues: { country: 'cn' } } as any)}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
