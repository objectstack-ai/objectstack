/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CurrencyField } from './widgets/CurrencyField';
import { NumberField } from './widgets/NumberField';
import { TextField } from './widgets/TextField';
import { SelectField } from './widgets/SelectField';
import { BooleanField } from './widgets/BooleanField';
import { EmailField } from './widgets/EmailField';
import { UrlField } from './widgets/UrlField';
import { PhoneField } from './widgets/PhoneField';

const mockOnChange = vi.fn();

describe('Standard Field Widgets', () => {
  /**
   * Scope note — the ten standard field widgets (objectui#7336).
   *
   * Eight are exercised below. The other two are already covered by dedicated
   * suites elsewhere, so a case here would duplicate rather than add; this
   * note stands in for them, and is the point of the card:
   *
   * - `DateField` -> `./datetime-widgets.test.tsx`. Its `describe('DateField')`
   *   holds four cases: edit-mode input, onChange, locale-formatted readonly
   *   and empty-value dash. The objectui#3127 stored-ISO round trip for
   *   `DateField` is in that same FILE but a SIBLING block -- the
   *   `describe('existing values round-trip through the native controls
   *   (#3127)')` it shares with `DateTimeField` -- not inside
   *   `describe('DateField')`. Its locale channel is pinned in
   *   `./__tests__/date-locale-channel.test.tsx` (objectui#4468) and its
   *   `toDateInputValue` helper in `./widgets/nativeDateValue.test.ts`.
   * - `TextAreaField` -> seven suites in `./widgets/__tests__/`:
   *   `TextAreaField.characterCount.{announcements,i18n,no-provider}`,
   *   `.fullscreenCharacterCount{,.i18n}`, `.fullscreenDisabled` and
   *   `.mobileFullscreen`.
   *
   * All three were once imported here and never rendered. PR objectui#7332
   * removed the unused imports -- correct, since an unused import asserts
   * nothing -- but that left the file reading as a complete sweep of the set
   * with no signal that members were missing. Two of the three needed only
   * this pointer; the third, `PhoneField`, was a real gap and now has cases.
   */

  describe('CurrencyField', () => {
    const fieldMock = { type: 'currency', currency: 'USD', precision: 2 };

    it('should render value with currency symbol in input mode', () => {
      render(
        <CurrencyField
          value={123.45}
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      const input = screen.getByRole('spinbutton'); // input type="number"
      expect(input).toHaveValue(123.45);
      expect(screen.getByText('$')).toBeInTheDocument();
    });

    it('should format currency in readonly mode', () => {
      const { container } = render(
        <CurrencyField
          value={1234.56}
          onChange={mockOnChange}
          field={fieldMock as any}
          readonly={true}
        />
      );
      // Expected output format might depend on locale, matching generic USD format
      expect(container.textContent).toMatch(/\$1,234.56/);
    });

    it('should handle EUR currency', () => {
      render(
        <CurrencyField
          value={100}
          onChange={mockOnChange}
          field={{ ...fieldMock, currency: 'EUR' } as any}
        />
      );
      // Was `EUR`, the bare code: the adornment came from a hand-written
      // `currency === 'USD' ? '$' : currency` ternary, so every currency but one
      // fell through to its code. objectui#4414 converged the symbol on the
      // single `Intl` channel the readonly branch of this same widget already
      // formatted through, which answers `€` here — a DOCUMENTED change, pinned
      // in full (with the locale-dependence it brings) in
      // `__tests__/CurrencyField.symbol.test.tsx`.
      expect(screen.getByText('€')).toBeInTheDocument();
    });
  });

  describe('NumberField', () => {
    const fieldMock = { type: 'number', precision: 2 };

    it('should render numeric input', () => {
      render(
        <NumberField
          value={42}
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveValue(42);
    });

    it('should call onChange with number', () => {
      render(
        <NumberField
          value={1}
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '10' } });
      expect(mockOnChange).toHaveBeenCalledWith(10);
    });

    it('should display value in readonly mode', () => {
      const { container } = render(
        <NumberField
          value={99.9}
          onChange={mockOnChange}
          field={fieldMock as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('99.9');
    });

    it('should surface metadata min/max on the input (objectui#2572)', () => {
      render(
        <NumberField
          value={5}
          onChange={mockOnChange}
          field={{ type: 'number', min: 0, max: 100 } as any}
        />
      );
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('min', '0');
      expect(input).toHaveAttribute('max', '100');
    });

    it('should step by 1 for scale: 0 (whole numbers), not "any"', () => {
      render(
        <NumberField
          value={5}
          onChange={mockOnChange}
          field={{ type: 'number', scale: 0 } as any}
        />
      );
      expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '1');
    });

    it('should honor an explicit metadata step over the scale-derived one', () => {
      render(
        <NumberField
          value={5}
          onChange={mockOnChange}
          field={{ type: 'number', scale: 2, step: 5 } as any}
        />
      );
      expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '5');
    });
  });

  describe('TextField', () => {
    const fieldMock = { type: 'text' };

    it('should render text input', () => {
      render(
        <TextField
          value="Hello"
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveValue('Hello');
    });

    it('should render as password when type is password', () => {
        render(
          <TextField
            value="secret"
            onChange={mockOnChange}
            field={{ type: 'password' } as any}
          />
        );
        // getByRole('textbox') doesn't work for password type usually
        const input = screen.getByDisplayValue('secret'); 
        expect(input).toHaveAttribute('type', 'password');
      });

    it('should display value in readonly mode', () => {
      const { container } = render(
        <TextField
          value="ReadOnly"
          onChange={mockOnChange}
          field={fieldMock as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('ReadOnly');
    });
  });

  describe('SelectField', () => {
    const fieldMock = { 
        type: 'select', 
        options: [
            { label: 'Option A', value: 'a' },
            { label: 'Option B', value: 'b' }
        ] 
    };

    it('should render select trigger (Combobox/Select)', () => {
      render(
        <SelectField
          value={''}
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should display label in readonly mode', () => {
      const { container } = render(
        <SelectField
          value="a"
          onChange={mockOnChange}
          field={fieldMock as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('Option A');
    });

    // A `select` declared `multiple` is a multi-value picker (spec allows
    // `multiple` on select). SelectField delegates to the chip picker so the
    // form, inline editor, and ActionParamDialog all get multi-select from the
    // one `select` widget — no single-select fallback, no per-surface drift.
    it('renders the multi-value chip picker when field.multiple is set', () => {
      render(
        <SelectField
          value={['a']}
          onChange={mockOnChange}
          field={{ ...fieldMock, multiple: true } as any}
        />
      );
      // Chip picker uses toggle buttons (aria-pressed), not a Radix combobox.
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      const optionA = screen.getByRole('button', { name: 'Option A' });
      expect(optionA).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Option B' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('multi-select toggles values as an array', () => {
      render(
        <SelectField
          value={['a']}
          onChange={mockOnChange}
          field={{ ...fieldMock, multiple: true } as any}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Option B' }));
      expect(mockOnChange).toHaveBeenCalledWith(['a', 'b']);
    });

    it('multi-select renders selected values as badges in readonly mode', () => {
      const { container } = render(
        <SelectField
          value={['a', 'b']}
          onChange={mockOnChange}
          field={{ ...fieldMock, multiple: true } as any}
          readonly={true}
        />
      );
      expect(container.textContent).toContain('Option A');
      expect(container.textContent).toContain('Option B');
    });
  });

  describe('BooleanField', () => {
    const fieldMock = { type: 'boolean' };

    it('should render checkbox/switch', () => {
      render(
        <BooleanField
          value={true}
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      // Ensure we can find the switch role (Shadcn switch uses role="switch")
      expect(screen.getByRole('switch')).toBeChecked();
    });

    it('should toggle value', () => {
      render(
        <BooleanField
          value={false}
          onChange={mockOnChange}
          field={fieldMock as any}
        />
      );
      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);
      expect(mockOnChange).toHaveBeenCalledWith(true);
    });

    it('should display Yes/No in readonly mode', () => {
       const { container } = render(
        <BooleanField
          value={true}
          onChange={mockOnChange}
          field={fieldMock as any}
          readonly={true}
        />
      );
      expect(container.textContent).toBe('Yes');
    });
  });

  describe('EmailField', () => {
    it('should render email input', () => {
      render(
        <EmailField
          value="test@example.com"
          onChange={mockOnChange}
          field={{ type: 'email' } as any}
        />
      );
      const input = screen.getByDisplayValue('test@example.com');
      expect(input).toHaveAttribute('type', 'email');
    });

    it('should render as link in readonly mode', () => {
      render(
        <EmailField
          value="test@example.com"
          onChange={mockOnChange}
          field={{ type: 'email' } as any}
          readonly={true}
        />
      );
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'mailto:test@example.com');
      expect(link).toHaveTextContent('test@example.com');
    });
  });

  describe('UrlField', () => {
    it('should render url input', () => {
      render(
        <UrlField
          value="https://example.com"
          onChange={mockOnChange}
          field={{ type: 'url' } as any}
        />
      );
      const input = screen.getByDisplayValue('https://example.com');
      expect(input).toHaveAttribute('type', 'url');
    });

    it('should render clickable link in readonly mode', () => {
      render(
        <UrlField
          value="https://example.com"
          onChange={mockOnChange}
          field={{ type: 'url' } as any}
          readonly={true}
        />
      );
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'https://example.com');
    });
  });

  describe('PhoneField', () => {
    // The one member of the standard set that had no coverage of its own
    // behaviour anywhere. `__tests__/validation-feedback.test.tsx` renders it
    // four times, but only inside the cross-widget contract battery
    // (aria-invalid, disabled, empty-readonly dash, default placeholder) --
    // nothing there, or in any other file, asserted the two things that make
    // it a PHONE widget: the `tel` input type and the `tel:` link its readonly
    // branch renders. (The `tel:` assertions that do exist belong to the
    // plugin-list / plugin-report CELL renderers, not to this widget.) Same
    // readonly/edit round trip the EmailField and UrlField blocks above write.
    it('should render tel input', () => {
      render(
        <PhoneField
          value="+15551234567"
          onChange={mockOnChange}
          field={{ type: 'phone' } as any}
        />
      );
      const input = screen.getByDisplayValue('+15551234567');
      expect(input).toHaveAttribute('type', 'tel');
    });

    it('should render clickable tel link in readonly mode', () => {
      render(
        <PhoneField
          value="+15551234567"
          onChange={mockOnChange}
          field={{ type: 'phone' } as any}
          readonly={true}
        />
      );
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'tel:+15551234567');
      expect(link).toHaveTextContent('+15551234567');
    });
  });
});
