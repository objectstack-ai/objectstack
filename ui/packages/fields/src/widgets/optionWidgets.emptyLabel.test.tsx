/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A picklist option with a BLANK label renders its `value`, on BOTH paths
 * (objectui#9230).
 *
 * ## The document is legal, so the renderer owes it a visible row
 *
 * The field designer writes `label: ''` when the author fills only the value
 * box, and that is the correct producer behaviour, not the bug: the contract
 * accepts an empty label and REFUSES an absent one, so `''` is the only legal
 * thing to write for a cleared Label box. That reading is pinned at the
 * producer in `app-shell`'s `ObjectFieldInspector.optionLabel.test.tsx`
 * (objectui#7014 Q2), whose fourth case also pins that the designer must NOT
 * invent `value` into `label` behind the author's back. The control below
 * re-derives the half this file depends on rather than trusting prose: if the
 * spec ever starts refusing a blank label, it goes red and this fallback is
 * the wrong shape.
 *
 * ## What was actually broken: the family disagreed with itself
 *
 * Measured on `origin/main` before the fix, one authored option
 * `{ value: 'low', label: '' }` with `{ value: 'high', label: 'High' }` beside
 * it as the lit control:
 *
 *   | widget      | readonly path | interactive path |
 *   | select      | "low"         | ""   <- blank    |
 *   | multiselect | "low"         | ""   <- blank    |
 *   | radio       | "low"         | ""   <- blank    |
 *   | checkboxes  | "low"         | ""   <- blank    |
 *
 * All four summary paths already fell back to the value (`opt?.label || v`);
 * all four interactive paths rendered `{opt.label}` raw. Same option, same
 * record: "low" when the form was read-only and an unclickable blank row when
 * it was editable. `optionDisplayLabel` in `@object-ui/core` is now the single
 * definition both halves call.
 *
 * So every widget below is asserted on BOTH paths, and the two are asserted to
 * AGREE — a fix applied to only one half is exactly the state this file exists
 * to keep from coming back.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectOptionSchema } from '@objectstack/spec/data';
import type { FieldMetadata } from '@object-ui/types';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { CheckboxesField } from './CheckboxesField';
import { RadioField } from './RadioField';

/**
 * The authored list under test. `low` is the defect shape; `high` is the LIT
 * CONTROL — it must keep rendering its own label, so a green assertion on
 * `low` cannot come from a probe that sees no labels at all.
 */
const OPTIONS = [
  { value: 'low', label: '' },
  { value: 'high', label: 'High' },
];

// `radio` and `checkboxes` are WIDGET keys with no member of their own in the
// `FieldMetadata` union, so one documented cast stands in for a type that does
// not exist. Deliberately `as unknown as`, never `as any` (AGENTS.md #6): every
// assertion below stays type-checked.
const severityField = (type: string) =>
  ({ name: 'sev', type, options: OPTIONS }) as unknown as FieldMetadata;

/** The structural slice of a Zod schema this file needs -- no `any` (AGENTS.md #6). */
type SpecSchema = { safeParse: (value: unknown) => { success: boolean } };
const accepts = (schema: SpecSchema, doc: unknown): boolean => schema.safeParse(doc).success;

describe('option widgets · a blank option label falls back to the value (objectui#9230)', () => {
  it('the premise: the contract ACCEPTS a blank label and REFUSES an absent one', () => {
    // Why the renderer, and not the designer, is the fix site: `label: ''` is
    // a document every layer calls legal, so it reaches a widget by design.
    expect(accepts(SelectOptionSchema, { value: 'low', label: '' })).toBe(true);
    // Lit control — this schema does reject things, so the ACCEPT means something.
    expect(accepts(SelectOptionSchema, { value: 'low' })).toBe(false);
    expect(accepts(SelectOptionSchema, { value: 'low', label: 'Low' })).toBe(true);
  });

  it('SelectField shows the value in the OPEN dropdown, not a blank row', () => {
    render(
      <SelectField
        value={undefined}
        onChange={vi.fn()}
        field={severityField('select')}
        name="sev"
      />,
    );
    fireEvent.keyDown(screen.getByTestId('select-trigger-sev'), { key: 'Enter' });
    expect(screen.getByTestId('select-option-low')).toHaveTextContent('low');
    expect(screen.getByTestId('select-option-high')).toHaveTextContent('High');
  });

  it('SelectField read-only keeps showing the value (unchanged) — both paths agree', () => {
    const { container } = render(
      <SelectField
        value="low"
        onChange={vi.fn()}
        readonly
        field={severityField('select')}
        name="sev"
      />,
    );
    expect(container).toHaveTextContent('low');
  });

  it('MultiSelectField shows the value on its toggle, not a blank chip', () => {
    render(
      <MultiSelectField
        value={[]}
        onChange={vi.fn()}
        field={severityField('multiselect')}
        name="sev"
      />,
    );
    expect(screen.getByTestId('multiselect-option-low')).toHaveTextContent('low');
    expect(screen.getByTestId('multiselect-option-high')).toHaveTextContent('High');
  });

  it('MultiSelectField read-only keeps showing the value (unchanged) — both paths agree', () => {
    const { container } = render(
      <MultiSelectField
        value={['low']}
        onChange={vi.fn()}
        readonly
        field={severityField('multiselect')}
        name="sev"
      />,
    );
    expect(container).toHaveTextContent('low');
  });

  it('RadioField labels the radio with the value, so the row is clickable copy', () => {
    render(
      <RadioField
        // `RadioField` declares `value: string` (required), so the
        // nothing-selected state is the empty string, not `undefined`.
        value=""
        onChange={vi.fn()}
        field={severityField('radio')}
        name="sev"
      />,
    );
    // The <label for> must carry text: an empty one names nothing to a screen
    // reader and gives a pointer user no hit area beyond the dot itself.
    expect(screen.getByLabelText('low')).toBe(screen.getByTestId('radio-option-low'));
    expect(screen.getByLabelText('High')).toBe(screen.getByTestId('radio-option-high'));
  });

  it('RadioField read-only keeps showing the value (unchanged) — both paths agree', () => {
    const { container } = render(
      <RadioField
        value="low"
        onChange={vi.fn()}
        readonly
        field={severityField('radio')}
        name="sev"
      />,
    );
    expect(container).toHaveTextContent('low');
  });

  it('CheckboxesField labels the box with the value, so the row is clickable copy', () => {
    render(
      <CheckboxesField
        value={[]}
        onChange={vi.fn()}
        field={severityField('checkboxes')}
        name="sev"
      />,
    );
    expect(screen.getByLabelText('low')).toBe(screen.getByTestId('checkboxes-option-low'));
    expect(screen.getByLabelText('High')).toBe(screen.getByTestId('checkboxes-option-high'));
  });

  it('CheckboxesField read-only keeps showing the value (unchanged) — both paths agree', () => {
    const { container } = render(
      <CheckboxesField
        value={['low']}
        onChange={vi.fn()}
        readonly
        field={severityField('checkboxes')}
        name="sev"
      />,
    );
    expect(container).toHaveTextContent('low');
  });

  it('a whitespace-only label falls back too — it is the same invisible row', () => {
    render(
      <MultiSelectField
        value={[]}
        onChange={vi.fn()}
        field={
          {
            name: 'sev',
            type: 'multiselect',
            options: [{ value: 'low', label: '   ' }],
          } as unknown as FieldMetadata
        }
        name="sev"
      />,
    );
    expect(screen.getByTestId('multiselect-option-low')).toHaveTextContent('low');
  });
});
