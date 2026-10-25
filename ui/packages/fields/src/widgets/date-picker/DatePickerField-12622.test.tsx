/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12622 — the record form's date picker.
 *
 * A `date` / `datetime` field in a record form drew the browser's native
 * input, whose placeholder and digit order are the MACHINE's (`年/月/日` in an
 * English console). The form face is now a text box in the display locale's
 * format with a calendar popover, keyboard entry, clear, and today / tomorrow
 * shortcuts. The value written is unchanged: `YYYY-MM-DD` for `date`, an ISO
 * instant for `datetime`.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatePickerField, DateTimePickerField } from './DatePickerField';

afterEach(() => cleanup());

type Field = React.ComponentProps<typeof DatePickerField>['field'];
const FIELD = { name: 'close_date', type: 'date' } as Field;
const DT_FIELD = { name: 'remind_at', type: 'datetime' } as Field;

function inSession(language: string, node: React.ReactNode) {
  return (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {node}
    </I18nProvider>
  );
}

const textBox = (container: HTMLElement) =>
  container.querySelector('[data-slot="date-picker"] input') as HTMLInputElement;

const typeAndCommit = (input: HTMLInputElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

describe('DatePickerField — the picker, not the native input (objectui#12622)', () => {
  it('renders a text box in the display locale format, never input[type=date]', () => {
    const { container } = render(<DatePickerField value="2026-10-16" onChange={() => {}} field={FIELD} />);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    const input = textBox(container);
    expect(input.type).toBe('text');
    expect(input.value).toBe('10/16/2026');
    expect(input.placeholder).toBe('MM/DD/YYYY');
    expect(screen.getByTestId('date-picker-trigger')).toBeTruthy();
  });

  it('zh session: the same value in the zh format', () => {
    const { container } = render(inSession('zh', <DatePickerField value="2026-10-16" onChange={() => {}} field={FIELD} />));
    const input = textBox(container);
    expect(input.value).toBe('2026/10/16');
    expect(input.placeholder).toBe('YYYY/MM/DD');
  });

  it('typing a date in the locale format writes the ISO day', () => {
    const onChange = vi.fn();
    const { container } = render(<DatePickerField value="" onChange={onChange} field={FIELD} />);
    typeAndCommit(textBox(container), '10/20/2026');
    expect(onChange).toHaveBeenCalledWith('2026-10-20');
    expect(textBox(container).value).toBe('10/20/2026');
  });

  it('Enter commits too', () => {
    const onChange = vi.fn();
    const { container } = render(<DatePickerField value="" onChange={onChange} field={FIELD} />);
    const input = textBox(container);
    fireEvent.change(input, { target: { value: '2026-10-20' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-10-20');
  });

  it('text naming no date is not written, and says so', () => {
    const onChange = vi.fn();
    const { container } = render(<DatePickerField value="2026-10-16" onChange={onChange} field={FIELD} />);
    typeAndCommit(textBox(container), '02/30/2026');
    expect(onChange).not.toHaveBeenCalled();
    expect(textBox(container).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('date-picker-notice').textContent).toContain('MM/DD/YYYY');
  });

  it('a calendar pick writes the ISO day', async () => {
    const onChange = vi.fn();
    render(<DatePickerField value="2026-10-16" onChange={onChange} field={FIELD} />);
    fireEvent.click(screen.getByTestId('date-picker-trigger'));
    const day = await waitFor(() => {
      const el = document.body.querySelector(`button[data-day="${new Date(2026, 9, 20).toLocaleDateString()}"]`);
      if (!el) throw new Error('calendar not open');
      return el as HTMLButtonElement;
    });
    fireEvent.click(day);
    expect(onChange).toHaveBeenCalledWith('2026-10-20');
  });

  it('the today and tomorrow shortcuts write those days', async () => {
    const onChange = vi.fn();
    render(<DatePickerField value="" onChange={onChange} field={FIELD} />);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dayIn = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    fireEvent.click(screen.getByTestId('date-picker-trigger'));
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenLastCalledWith(dayIn(0));
    fireEvent.click(screen.getByTestId('date-picker-trigger'));
    fireEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    expect(onChange).toHaveBeenLastCalledWith(dayIn(1));
  });

  it('clear writes the empty value the native input wrote', () => {
    const onChange = vi.fn();
    render(<DatePickerField value="2026-10-16" onChange={onChange} field={FIELD} />);
    fireEvent.click(screen.getByTestId('date-picker-clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('carries the host id, aria-required and disabled onto the text box', () => {
    const { container } = render(
      <DatePickerField value="" onChange={() => {}} field={FIELD} id="f-1" aria-required disabled />,
    );
    const input = textBox(container);
    expect(input.id).toBe('f-1');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.disabled).toBe(true);
    expect(screen.queryByTestId('date-picker-clear')).toBeNull();
    expect((screen.getByTestId('date-picker-trigger') as HTMLButtonElement).disabled).toBe(true);
  });

  it('readonly is the DateField readonly face, unchanged', () => {
    const { container } = render(<DatePickerField value="2026-10-16" onChange={() => {}} field={FIELD} readonly />);
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-slot="date-picker"]')).toBeNull();
  });
});

describe('DateTimePickerField — writes an ISO instant (objectui#12622)', () => {
  it('shows the stored instant as the local wall clock in the locale format', () => {
    const iso = new Date(2026, 9, 16, 14, 30).toISOString();
    const { container } = render(<DateTimePickerField value={iso} onChange={() => {}} field={DT_FIELD} />);
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(textBox(container).value).toBe('10/16/2026, 02:30 PM');
  });

  it('typing a date and time writes the ISO instant of that local wall clock', () => {
    const onChange = vi.fn();
    const { container } = render(<DateTimePickerField value="" onChange={onChange} field={DT_FIELD} />);
    typeAndCommit(textBox(container), '10/16/2026 14:30');
    const written = onChange.mock.calls[0][0] as string;
    expect(written).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(written).toBe(new Date(2026, 9, 16, 14, 30).toISOString());
  });

  it('a calendar pick keeps the value time', async () => {
    const onChange = vi.fn();
    const iso = new Date(2026, 9, 16, 9, 15).toISOString();
    render(<DateTimePickerField value={iso} onChange={onChange} field={DT_FIELD} />);
    fireEvent.click(screen.getByTestId('date-picker-trigger'));
    const day = await waitFor(() => {
      const el = document.body.querySelector(`button[data-day="${new Date(2026, 9, 20).toLocaleDateString()}"]`);
      if (!el) throw new Error('calendar not open');
      return el as HTMLButtonElement;
    });
    act(() => {
      fireEvent.click(day);
    });
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 20, 9, 15).toISOString());
  });
});
