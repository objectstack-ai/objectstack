/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27398 row 2 — an EMPTY currency box reads as
 * empty.
 *
 * The edit-mode input used to fall back to the placeholder `0.00` whenever the
 * field declared none, so an optional amount nobody filled in (a public form's
 * Annual Revenue) looked like a filled-in zero. The widget now shows the
 * field's own `placeholder`, or none — the shape `NumberField` already has.
 *
 * Every host draws this one widget with the field it was handed, so the pins
 * below cover the widget itself and the two package hosts that mount it: the
 * form renderer (record form) and `FieldEditWidget` (the grid's inline
 * editor). The public form page's own pin lives beside `FormPage.tsx`.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';
import { LocalizationProvider } from '@object-ui/i18n';
import { CurrencyField } from '../widgets/CurrencyField';
import { FieldEditWidget } from '../FieldEditWidget';

beforeAll(() => {
  ComponentRegistry.register('currency', CurrencyField as any, {
    namespace: 'field',
    skipFallback: true,
  });
}, 30000);

afterEach(() => cleanup());

const box = (container: HTMLElement): HTMLInputElement => {
  const el = container.querySelector('input[type=number]');
  if (!el) throw new Error('no currency input rendered');
  return el as HTMLInputElement;
};

/** The attribute as the browser would show it: absent and empty read alike. */
const shownPlaceholder = (container: HTMLElement) => box(container).getAttribute('placeholder') ?? '';

const renderWidget = (field: Record<string, unknown>, value: number | null = null) =>
  render(
    <LocalizationProvider value={{ locale: 'en' }}>
      <CurrencyField value={value as any} onChange={vi.fn()} field={{ type: 'currency', ...field } as any} />
    </LocalizationProvider>,
  );

describe('CurrencyField — an empty box shows no numeric stand-in (objectstack#27398 row 2)', () => {
  it('an empty field that declares no placeholder shows none', () => {
    const { container } = renderWidget({ name: 'annual_revenue', currency: 'USD' });
    expect(box(container).value).toBe('');
    expect(shownPlaceholder(container)).toBe('');
  });

  it('a zero-decimal currency is not offered a two-decimal stand-in either', () => {
    const { container } = renderWidget({ name: 'budget', currency: 'JPY' });
    expect(shownPlaceholder(container)).toBe('');
  });

  it('an authored empty placeholder stays empty rather than being replaced', () => {
    const { container } = renderWidget({ name: 'annual_revenue', currency: 'USD', placeholder: '' });
    expect(shownPlaceholder(container)).toBe('');
  });

  it("CONTROL — the field's own placeholder is still shown", () => {
    const { container } = renderWidget({ name: 'annual_revenue', currency: 'USD', placeholder: 'e.g. 250000' });
    expect(shownPlaceholder(container)).toBe('e.g. 250000');
  });

  it('CONTROL — a real zero still shows as a value', () => {
    const { container } = renderWidget({ name: 'annual_revenue', currency: 'USD' }, 0);
    expect(box(container).value).toBe('0');
  });
});

describe('the hosts that mount CurrencyField hand it no stand-in of their own (objectstack#27398 row 2)', () => {
  it('the form renderer (record form) draws an empty optional amount with no placeholder', () => {
    const Form = ComponentRegistry.get('form')!;
    const { container } = render(
      <Form
        schema={{
          type: 'form',
          mode: 'create',
          showSubmit: true,
          showCancel: false,
          defaultValues: {},
          fields: [{ name: 'annual_revenue', label: 'Annual Revenue', type: 'currency', currency: 'USD' }],
          onSubmit: () => {},
        }}
      />,
    );
    const row = container.querySelector('[data-field="annual_revenue"]') as HTMLElement | null;
    if (!row) throw new Error('the form renderer drew no annual_revenue row');
    expect(shownPlaceholder(row)).toBe('');
  });

  it('FieldEditWidget (the inline editor) draws an empty amount with no placeholder', () => {
    const { container } = render(
      <FieldEditWidget
        field={{ name: 'annual_revenue', type: 'currency', label: 'Annual Revenue', currency: 'USD' } as never}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(shownPlaceholder(container)).toBe('');
  });
});
