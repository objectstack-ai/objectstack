/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An option widget with NO authored `options` keeps the value it was given
 * (objectui#4220).
 *
 * The four fixed-option widgets each end their cascade resolution with a
 * "clear what is no longer offered" effect (ADR-0058 / #2715). It ran against
 * the RESOLVED set without asking why that set was empty, and the two causes
 * are opposites:
 *
 *  - the list cascaded down to zero — a real decision, and clearing is the
 *    documented behaviour;
 *  - the field declares no `options` at all — no decision was made anywhere,
 *    and the widget's own next branch renders `OptionsEmptyState`, i.e. it
 *    tells the user there is nothing to pick. Clearing here deletes the stored
 *    value of a field the user was shown nothing but a hint for, on MOUNT,
 *    without a single interaction.
 *
 * Measured on two live hosts, both of which mount these widgets outside a form:
 * the grid's inline cell editor (`FieldEditWidget`, since #2942) and — since
 * #4220 — the detail page's inline editor, which stages every `onChange` into
 * the record draft the moment a section enters edit mode. An options-less
 * `checkboxes` there wiped its array as soon as the user started editing any
 * OTHER field in the same section, and the save bar wrote the empty array back.
 *
 * The prune now requires an authored list to prune against. The cascade itself
 * is untouched — the controls below still clear a value the configured list no
 * longer offers.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { CheckboxesField } from './CheckboxesField';
import { RadioField } from './RadioField';

const OPTIONS = [{ label: 'Alpha', value: 'alpha' }];

describe('option widgets — an unconfigured list never deletes the stored value (#4220)', () => {
  it('MultiSelectField keeps its array and shows the unfillable state', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectField
        value={['alpha', 'beta']}
        onChange={onChange}
        field={{ name: 'topics', type: 'multiselect' } as any}
      />,
    );
    expect(screen.getByTestId('multiselect-empty-topics')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('CheckboxesField keeps its array and shows the unfillable state', () => {
    const onChange = vi.fn();
    render(
      <CheckboxesField
        value={['alpha', 'beta']}
        onChange={onChange}
        field={{ name: 'perks', type: 'checkboxes' } as any}
      />,
    );
    expect(screen.getByTestId('checkboxes-empty-perks')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('RadioField keeps its value and shows the unfillable state', () => {
    const onChange = vi.fn();
    render(
      <RadioField
        value="alpha"
        onChange={onChange}
        field={{ name: 'tier', type: 'radio' } as any}
      />,
    );
    expect(screen.getByTestId('radio-empty-tier')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('SelectField keeps its value and shows the unfillable state', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value="alpha"
        onChange={onChange}
        field={{ name: 'stage', type: 'select' } as any}
      />,
    );
    expect(screen.getByTestId('select-empty-stage')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('controls — a CONFIGURED list still cascade-clears what it no longer offers', () => {
  it('MultiSelectField drops the unoffered element, keeps the offered one', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectField
        value={['alpha', 'zeta']}
        onChange={onChange}
        field={{ name: 'topics', type: 'multiselect', options: OPTIONS } as any}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(['alpha']);
  });

  it('CheckboxesField drops the unoffered element, keeps the offered one', () => {
    const onChange = vi.fn();
    render(
      <CheckboxesField
        value={['alpha', 'zeta']}
        onChange={onChange}
        field={{ name: 'perks', type: 'checkboxes', options: OPTIONS } as any}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(['alpha']);
  });

  it('RadioField clears a value the configured list does not offer', () => {
    const onChange = vi.fn();
    render(
      <RadioField
        value="zeta"
        onChange={onChange}
        field={{ name: 'tier', type: 'radio', options: OPTIONS } as any}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('SelectField clears a value the configured list does not offer', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value="zeta"
        onChange={onChange}
        field={{ name: 'stage', type: 'select', options: OPTIONS } as any}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
