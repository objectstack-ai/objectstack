// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A select whose METADATA carries `dependsOn` gates and prunes its options —
 * read through the DECLARED type (objectui#6153, instance 1; maintainer ruling
 * A, 2026-09-02).
 *
 * The behaviour predates the card: `SelectField` has gated on the metadata's
 * `dependsOn` since ADR-0058 / #2284, reached through `(config as any)`. What
 * the card changed is the CONTRACT — `BaseFieldMetadata` now declares
 * `dependsOn` in the spec's field-level shape, and the widget reads it as
 * `field.dependsOn`. So the fixtures below are ANNOTATED `SelectFieldMetadata`
 * literals with NO cast: the excess-property check that refused this exact
 * document before the declaration is the compile half of the pin, and the gate
 * + cascade-clear are the runtime half. The sibling `*.cascade.test.tsx` files
 * keep proving the same behaviour through `as any` literals; this file proves
 * it through the declared type, which is the fact the card records.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { SelectFieldMetadata } from '@object-ui/types';
import { SelectField } from './SelectField';

// The literal `content/docs/fields/select.mdx` teaches — annotated, uncast.
const provinceField: SelectFieldMetadata = {
  type: 'select',
  name: 'province',
  label: 'Province',
  dependsOn: ['country'],
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
};

const provincesField: SelectFieldMetadata = {
  ...provinceField,
  name: 'provinces',
  multiple: true,
};

// `name` / `dependentValues` are HOST props (the form renderer's channel), not
// metadata — spread the way every other option-widget test does.
const host = (name: string, dependentValues: Record<string, unknown>) =>
  ({ name, dependentValues }) as Record<string, unknown>;

describe('SelectField — `dependsOn` off the DECLARED metadata type (objectui#6153)', () => {
  it('gates with a "select the parent first" hint while the controlling field is empty', () => {
    render(
      <SelectField value={undefined} onChange={vi.fn()} field={provinceField} {...host('province', {})} />,
    );
    expect(screen.getByTestId('select-empty-province')).toHaveTextContent(/select country first/i);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('unlocks once the controlling value is set', () => {
    render(
      <SelectField
        value={undefined}
        onChange={vi.fn()}
        field={provinceField}
        {...host('province', { country: 'cn' })}
      />,
    );
    expect(screen.queryByTestId('select-empty-province')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('prunes a value the controlling field no longer offers, and keeps one it does', () => {
    const dropped = vi.fn();
    render(
      <SelectField value="ca" onChange={dropped} field={provinceField} {...host('province', { country: 'cn' })} />,
    );
    // 'ca' is offered only under country=us — under cn it is not, so it is cleared.
    expect(dropped).toHaveBeenCalledWith(null);

    const kept = vi.fn();
    render(
      <SelectField value="zj" onChange={kept} field={provinceField} {...host('province', { country: 'cn' })} />,
    );
    expect(kept).not.toHaveBeenCalled();
  });

  it('the `multiple` arm (MultiSelectField) reads the same declared key', () => {
    render(
      <SelectField value={[]} onChange={vi.fn()} field={provincesField} {...host('provinces', {})} />,
    );
    expect(screen.getByTestId('multiselect-empty-provinces')).toHaveTextContent(/select country first/i);
  });
});
