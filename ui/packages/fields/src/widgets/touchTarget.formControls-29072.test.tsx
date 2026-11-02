/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The create / edit form's field controls carry the phone touch floor
 * (objectstack#29072).
 *
 * At 375 and 390 px every registered widget the Forms flow drew kept its
 * primitive's height: 40 px inputs, select trigger and lookup trigger, 32 px
 * lookup search and select options, 28 px date-picker buttons. The form
 * renderer's BUILT-IN controls already carried `min-h-[44px] sm:min-h-0`; the
 * registered widgets now carry the same token (`touchTarget.ts`).
 *
 * This file pins the class shape on each control. jsdom has no layout engine,
 * so the measured half (44 px below `sm`, the primitive's own height above it)
 * is the Playwright spec `ui/e2e/form-controls-phone-touch.spec.ts`.
 */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PHONE_TOUCH_HEIGHT, PHONE_TOUCH_SQUARE } from './touchTarget';
import { TextField } from './TextField';
import { EmailField } from './EmailField';
import { PhoneField } from './PhoneField';
import { UrlField } from './UrlField';
import { NumberField } from './NumberField';
import { CurrencyField } from './CurrencyField';
import { PercentField } from './PercentField';
import { SelectField } from './SelectField';
import { LookupField } from './LookupField';
import { DatePickerField } from './date-picker/DatePickerField';
import { FileField } from './FileField';

const HEIGHT = PHONE_TOUCH_HEIGHT.split(' ');
const SQUARE = PHONE_TOUCH_SQUARE.split(' ');

function expectTokens(el: Element, tokens: string[]) {
  const cls = el.getAttribute('class')?.split(/\s+/) ?? [];
  for (const t of tokens) expect(cls, `${el.tagName} is missing ${t}`).toContain(t);
}

const base = { onChange: vi.fn(), readonly: false } as any;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
});
afterEach(() => cleanup());

describe('form field controls carry the phone touch floor (objectstack#29072)', () => {
  it('the token is the one the built-in form controls use, and gives way from sm up', () => {
    expect(HEIGHT).toEqual(['min-h-[44px]', 'sm:min-h-0']);
    expect(SQUARE).toEqual(['min-h-[44px]', 'min-w-[44px]', 'sm:min-h-0', 'sm:min-w-0']);
  });

  it.each([
    ['text', TextField, { name: 'title', type: 'text' }],
    ['email', EmailField, { name: 'email', type: 'email' }],
    ['phone', PhoneField, { name: 'phone', type: 'phone' }],
    ['url', UrlField, { name: 'website', type: 'url' }],
    ['number', NumberField, { name: 'score', type: 'number' }],
    ['currency', CurrencyField, { name: 'amount', type: 'currency' }],
    ['percent', PercentField, { name: 'probability', type: 'percent' }],
  ])('%s input', (_label, Widget: any, field) => {
    const { container } = render(<Widget {...base} field={field} value={undefined} />);
    expectTokens(container.querySelector('input')!, HEIGHT);
  });

  it('a host className still reaches the input beside the token', () => {
    const { container } = render(<TextField {...base} field={{ name: 'title' } as any} value="" className="host-x" />);
    const input = container.querySelector('input')!;
    expectTokens(input, [...HEIGHT, 'host-x']);
  });

  it('percent slider: its hit area, not only the thumb', () => {
    render(<PercentField {...base} field={{ name: 'p', type: 'percent' } as any} value={0.5} />);
    expectTokens(screen.getByTestId('percent-slider'), HEIGHT);
  });

  it('select: the trigger and every option', async () => {
    render(
      <SelectField
        {...base}
        field={{ name: 'stage', type: 'select', options: [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }] } as any}
        value={undefined}
      />,
    );
    const trigger = screen.getByTestId('select-trigger-stage');
    expectTokens(trigger, HEIGHT);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    for (const v of ['one', 'two']) expectTokens(await screen.findByTestId(`select-option-${v}`), HEIGHT);
  });

  it('lookup: the trigger, the clear button and the browse-all button', () => {
    const dataSource = { find: vi.fn(async () => ({ data: [], total: 0 })) } as any;
    render(
      <LookupField
        {...base}
        field={{ name: 'account', label: 'Account', reference: 'crm_account', reference_field: 'name' } as any}
        value={{ id: 'a1', name: 'Acme' }}
        dataSource={dataSource}
      />,
    );
    expectTokens(screen.getByTestId('lookup-trigger-account'), HEIGHT);
    expectTokens(screen.getByTestId('lookup-clear'), SQUARE);
    expectTokens(screen.getByTestId('browse-all-records'), SQUARE);
  });

  it('date picker: the input, its clear and calendar buttons, and the 44 px calendar cell', async () => {
    const { container } = render(
      <DatePickerField {...base} field={{ name: 'close_date', type: 'date' } as any} value="2026-11-02" />,
    );
    const input = container.querySelector('input')!;
    expectTokens(input, [...HEIGHT, 'pr-24', 'sm:pr-16']);
    expectTokens(screen.getByTestId('date-picker-clear'), SQUARE);
    const trigger = screen.getByTestId('date-picker-trigger');
    expectTokens(trigger, SQUARE);
    fireEvent.click(trigger);
    const grid = await screen.findByRole('grid');
    const calendar = grid.closest('[class*="--cell-size"]')!;
    expectTokens(calendar, ['[--cell-size:2.75rem]', 'sm:[--cell-size:2rem]']);
  });

  // From #29071's run: the file field's "Take photo" button (36 px) and the
  // per-file remove button (24 px) sit in the same create / edit form.
  it('file: the camera button and the per-file remove button', () => {
    render(
      <FileField
        {...base}
        field={{ name: 'receipt', type: 'file', capture: 'environment' } as any}
        value={[{ name: 'doc1.pdf', size: 1024 }]}
      />,
    );
    expectTokens(screen.getByTestId('file-field-camera-button'), HEIGHT);
    const row = screen.getByText('doc1.pdf').closest('[class*="justify-between"]');
    const remove = row?.querySelector(':scope > button');
    expect(remove, 'the remove button on the doc1.pdf row').toBeTruthy();
    expectTokens(remove!, SQUARE);
  });
});
