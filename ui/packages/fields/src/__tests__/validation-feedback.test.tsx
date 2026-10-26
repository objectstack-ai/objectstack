/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * P3.2 Field Widget Polish - Validation Feedback
 *
 * Tests that field widgets consistently handle validation feedback:
 * `error` prop, aria-invalid attribute, and disabled states.
 *
 * The slot is `error` — the name `@objectstack/spec/ui`'s
 * `FieldWidgetPropsSchema` gives it — since objectui#3222. These are the
 * CONSUMER half only: they prove a widget handed a message marks its control
 * invalid. That was true before #3222 too, under the name `errorMessage`, and
 * it did not help anyone, because no host ever passed the prop. The PRODUCER
 * half is `form-error-delivery.test.tsx` in `@object-ui/components` plus
 * `widget-aria-invalid-e2e.test.tsx` next to this file; a rename alone would
 * have swapped one dead key for another.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TextField } from '../widgets/TextField';
import { NumberField } from '../widgets/NumberField';
import { EmailField } from '../widgets/EmailField';
import { UrlField } from '../widgets/UrlField';
import { PhoneField } from '../widgets/PhoneField';
import { TextAreaField } from '../widgets/TextAreaField';
import { CurrencyField } from '../widgets/CurrencyField';
import { BooleanField } from '../widgets/BooleanField';
import { SelectField } from '../widgets/SelectField';

const noop = vi.fn();

describe('P3.2 Validation Feedback', () => {
  // ---------------------------------------------------------------
  // aria-invalid on `error`
  // ---------------------------------------------------------------
  describe('aria-invalid attribute', () => {
    it('EmailField sets aria-invalid when `error` provided', () => {
      render(
        <EmailField
          value=""
          onChange={noop}
          field={{ type: 'email' } as any}
          error="Invalid email"
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('EmailField does not set aria-invalid without `error`', () => {
      render(
        <EmailField
          value=""
          onChange={noop}
          field={{ type: 'email' } as any}
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('UrlField sets aria-invalid when `error` provided', () => {
      render(
        <UrlField
          value=""
          onChange={noop}
          field={{ type: 'url' } as any}
          error="Invalid URL"
        />
      );
      const input = screen.getByDisplayValue('');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('PhoneField sets aria-invalid when `error` provided', () => {
      render(
        <PhoneField
          value=""
          onChange={noop}
          field={{ type: 'phone' } as any}
          error="Invalid phone"
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('TextAreaField sets aria-invalid when `error` provided', () => {
      render(
        <TextAreaField
          value=""
          onChange={noop}
          field={{ type: 'textarea' } as any}
          error="Required"
        />
      );
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('aria-invalid', 'true');
    });

    it('CurrencyField sets aria-invalid when `error` provided', () => {
      render(
        <CurrencyField
          value={0}
          onChange={noop}
          field={{ type: 'currency' } as any}
          error="Must be positive"
        />
      );
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    /**
     * objectui#6803. `NumberField` was the ONE widget in this package that
     * renders a control and never read the published `error` slot, so these two
     * cases are the load-bearing half of that fix.
     *
     * ⚠️ The e2e pin next door (`widget-aria-invalid-e2e.test.tsx`) CANNOT show
     * this gap, and that is measured, not assumed: inside the real form the
     * `aria-invalid` that `<FormControl>`'s Radix Slot hands down arrives as a
     * widget prop, and `toDomProps` forwards the whole `aria-*` family by
     * prefix — so the Slot's correct value reached the input on its own and the
     * `number` row was GREEN there before this fix as well as after. The
     * omission was invisible precisely because a host was covering for it.
     *
     * Here there is no host and no Slot, which is the widget's own contract:
     * handed an `error`, it must mark its own control. That is the assertion
     * that goes red without the wiring.
     */
    it('NumberField sets aria-invalid when `error` provided', () => {
      render(
        <NumberField
          value={5}
          onChange={noop}
          field={{ type: 'number' } as any}
          error="Must be at least 10"
        />
      );
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('NumberField says aria-invalid="false" when handed no error', () => {
      // The explicit `"false"` is the load-bearing half, same as in the e2e
      // file: a valid field SAYS it is valid rather than staying mute. Before
      // objectui#6803 this widget wrote the attribute ONLY while its own
      // bad-input refusal was active, so with no host to cover for it the
      // control carried no `aria-invalid` at all.
      render(
        <NumberField
          value={5}
          onChange={noop}
          field={{ type: 'number' } as any}
        />
      );
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('aria-invalid', 'false');
    });
  });

  // ---------------------------------------------------------------
  // Disabled state consistency
  // ---------------------------------------------------------------
  describe('disabled state', () => {
    it('TextField supports disabled prop', () => {
      render(
        <TextField
          value="test"
          onChange={noop}
          field={{ type: 'text' } as any}
          disabled={true}
        />
      );
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('NumberField supports disabled prop', () => {
      render(
        <NumberField
          value={5}
          onChange={noop}
          field={{ type: 'number' } as any}
          disabled={true}
        />
      );
      expect(screen.getByRole('spinbutton')).toBeDisabled();
    });

    it('EmailField supports disabled prop', () => {
      render(
        <EmailField
          value=""
          onChange={noop}
          field={{ type: 'email' } as any}
          disabled={true}
        />
      );
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('PhoneField supports disabled prop', () => {
      render(
        <PhoneField
          value=""
          onChange={noop}
          field={{ type: 'phone' } as any}
          disabled={true}
        />
      );
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('TextAreaField supports disabled prop', () => {
      render(
        <TextAreaField
          value=""
          onChange={noop}
          field={{ type: 'textarea' } as any}
          disabled={true}
        />
      );
      expect(screen.getByRole('textbox')).toBeDisabled();
    });
  });

  // ---------------------------------------------------------------
  // Readonly mode consistency
  // ---------------------------------------------------------------
  describe('readonly mode output', () => {
    it('TextField shows dash for empty value in readonly', () => {
      const { container } = render(
        <TextField
          value=""
          onChange={noop}
          field={{ type: 'text' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('NumberField shows dash for null value in readonly', () => {
      const { container } = render(
        <NumberField
          value={null as any}
          onChange={noop}
          field={{ type: 'number' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('EmailField shows dash for empty value in readonly', () => {
      const { container } = render(
        <EmailField
          value=""
          onChange={noop}
          field={{ type: 'email' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('UrlField shows dash for empty value in readonly', () => {
      const { container } = render(
        <UrlField
          value=""
          onChange={noop}
          field={{ type: 'url' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('PhoneField shows dash for empty value in readonly', () => {
      const { container } = render(
        <PhoneField
          value=""
          onChange={noop}
          field={{ type: 'phone' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('TextAreaField shows dash for empty value in readonly', () => {
      const { container } = render(
        <TextAreaField
          value=""
          onChange={noop}
          field={{ type: 'textarea' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('BooleanField shows Yes/No in readonly', () => {
      const { container: yesC } = render(
        <BooleanField
          value={true}
          onChange={noop}
          field={{ type: 'boolean' } as any}
          readonly={true}
        />
      );
      expect(yesC.textContent).toBe('Yes');

      const { container: noC } = render(
        <BooleanField
          value={false}
          onChange={noop}
          field={{ type: 'boolean' } as any}
          readonly={true}
        />
      );
      expect(noC.textContent).toBe('No');
    });

    it('SelectField shows dash for empty value in readonly', () => {
      const { container } = render(
        <SelectField
          value=""
          onChange={noop}
          field={{ type: 'select', options: [] } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });

    it('CurrencyField shows dash for null value in readonly', () => {
      const { container } = render(
        <CurrencyField
          value={null as any}
          onChange={noop}
          field={{ type: 'currency' } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('—');
    });
  });

  // ---------------------------------------------------------------
  // Placeholder consistency
  // ---------------------------------------------------------------
  describe('placeholder support', () => {
    it('TextField uses field placeholder', () => {
      render(
        <TextField
          value=""
          onChange={noop}
          field={{ type: 'text', placeholder: 'Enter name...' } as any}
        />
      );
      expect(screen.getByPlaceholderText('Enter name...')).toBeInTheDocument();
    });

    it('EmailField uses default placeholder', () => {
      render(
        <EmailField
          value=""
          onChange={noop}
          field={{ type: 'email' } as any}
        />
      );
      expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument();
    });

    it('UrlField uses default placeholder', () => {
      render(
        <UrlField
          value=""
          onChange={noop}
          field={{ type: 'url' } as any}
        />
      );
      expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument();
    });

    it('PhoneField uses default placeholder', () => {
      render(
        <PhoneField
          value=""
          onChange={noop}
          field={{ type: 'phone' } as any}
        />
      );
      expect(screen.getByPlaceholderText('(555) 123-4567')).toBeInTheDocument();
    });
  });
});
