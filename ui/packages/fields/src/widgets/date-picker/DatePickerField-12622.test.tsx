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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { zh } from '@object-ui/i18n/locales';
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

  // objectstack#27483: unwritten text has to reach the host, or a form saves
  // the old value as if nothing had been typed.
  it('reports text naming no date to a host that takes it, and leaves the text to the host', () => {
    const onChange = vi.fn();
    const onInvalidInputChange = vi.fn();
    const { container } = render(
      <DatePickerField value="" onChange={onChange} field={FIELD} onInvalidInputChange={onInvalidInputChange} />,
    );
    expect(onInvalidInputChange).not.toHaveBeenCalled();
    typeAndCommit(textBox(container), '13/45/2026');
    expect(onChange).not.toHaveBeenCalled();
    expect(onInvalidInputChange).toHaveBeenCalledTimes(1);
    expect(onInvalidInputChange.mock.calls[0][0]).toContain('13/45/2026');
    expect(onInvalidInputChange.mock.calls[0][0]).toContain('MM/DD/YYYY');
    expect(textBox(container).getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByTestId('date-picker-notice')).toBeNull();

    typeAndCommit(textBox(container), '10/20/2026');
    expect(onChange).toHaveBeenCalledWith('2026-10-20');
    expect(onInvalidInputChange).toHaveBeenLastCalledWith(null);
    expect(onInvalidInputChange).toHaveBeenCalledTimes(2);
  });

  it('withdraws the report on clear and on unmount', () => {
    const onInvalidInputChange = vi.fn();
    const { container, unmount } = render(
      <DatePickerField value="" onChange={() => {}} field={FIELD} onInvalidInputChange={onInvalidInputChange} />,
    );
    typeAndCommit(textBox(container), '13/45/2026');
    fireEvent.click(screen.getByTestId('date-picker-clear'));
    expect(onInvalidInputChange).toHaveBeenLastCalledWith(null);

    typeAndCommit(textBox(container), 'nonsense');
    expect(onInvalidInputChange.mock.lastCall?.[0]).toContain('nonsense');
    unmount();
    expect(onInvalidInputChange).toHaveBeenLastCalledWith(null);
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

  it('reports a date and time naming no instant to a host that takes it (objectstack#27483)', () => {
    const onChange = vi.fn();
    const onInvalidInputChange = vi.fn();
    const { container } = render(
      <DateTimePickerField value="" onChange={onChange} field={DT_FIELD} onInvalidInputChange={onInvalidInputChange} />,
    );
    typeAndCommit(textBox(container), '13/45/2026 25:99');
    expect(onChange).not.toHaveBeenCalled();
    expect(onInvalidInputChange.mock.calls[0][0]).toContain('13/45/2026 25:99');
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

/**
 * objectstack#32589 — the `datetime` face's popover picks the time too: an
 * hour and a minute control under the calendar, so a time is chosen without
 * typing the whole value. A time pick writes the ISO instant of the local wall
 * clock `<day>T<HH:mm>`, through the same `fromDateTimeInputValue` the text box
 * uses, so what is written reads back as the time picked.
 */
describe('DateTimePickerField — the popover picks the time (objectstack#32589)', () => {
  const openPicker = () => fireEvent.click(screen.getByTestId('date-picker-trigger'));
  const choose = async (control: 'date-picker-hour' | 'date-picker-minute', option: string) => {
    fireEvent.click(await screen.findByTestId(control));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: option }));
  };
  const dayButton = (y: number, m: number, d: number) =>
    waitFor(() => {
      const el = document.body.querySelector(`button[data-day="${new Date(y, m, d).toLocaleDateString()}"]`);
      if (!el) throw new Error('calendar not open');
      return el as HTMLButtonElement;
    });

  it('an hour pick writes that hour on the value day, keeping its minute', async () => {
    const onChange = vi.fn();
    render(<DateTimePickerField value={new Date(2026, 10, 12, 9, 15).toISOString()} onChange={onChange} field={DT_FIELD} />);
    openPicker();
    expect(within(await screen.findByTestId('date-picker-time')).getByTestId('date-picker-hour').textContent).toBe('09 AM');
    await choose('date-picker-hour', '06 PM');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 10, 12, 18, 15).toISOString());
  });

  it('a minute pick writes that minute, keeping the hour', async () => {
    const onChange = vi.fn();
    render(<DateTimePickerField value={new Date(2026, 10, 12, 18, 0).toISOString()} onChange={onChange} field={DT_FIELD} />);
    openPicker();
    await choose('date-picker-minute', '30');
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 10, 12, 18, 30).toISOString());
  });

  it('a picked time round-trips: the written value reads back as the time picked', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <DateTimePickerField value={new Date(2026, 10, 12, 9, 15).toISOString()} onChange={onChange} field={DT_FIELD} />,
    );
    openPicker();
    await choose('date-picker-hour', '06 PM');
    const written = onChange.mock.calls[0][0] as string;
    rerender(<DateTimePickerField value={written} onChange={onChange} field={DT_FIELD} />);
    expect(textBox(container).value).toBe('11/12/2026, 06:15 PM');
    expect(screen.getByTestId('date-picker-hour').textContent).toBe('06 PM');
    expect(screen.getByTestId('date-picker-minute').textContent).toBe('15');
  });

  it('a minute off the 5-minute grid is shown and kept', async () => {
    render(<DateTimePickerField value={new Date(2026, 10, 12, 9, 17).toISOString()} onChange={() => {}} field={DT_FIELD} />);
    openPicker();
    expect((await screen.findByTestId('date-picker-minute')).textContent).toBe('17');
  });

  it('with no value, a day pick writes the day at 00:00, keeps the popover open and focuses the hour', async () => {
    const onChange = vi.fn();
    render(<DateTimePickerField value="" onChange={onChange} field={DT_FIELD} />);
    openPicker();
    const day = await dayButton(new Date().getFullYear(), new Date().getMonth(), 1);
    act(() => {
      fireEvent.click(day);
    });
    const d = new Date();
    expect(onChange).toHaveBeenCalledWith(new Date(d.getFullYear(), d.getMonth(), 1, 0, 0).toISOString());
    const hour = screen.getByTestId('date-picker-hour');
    expect(hour).toBeTruthy();
    expect(document.activeElement).toBe(hour);
  });

  it('with no value, a time pick writes it on today', async () => {
    const onChange = vi.fn();
    render(<DateTimePickerField value="" onChange={onChange} field={DT_FIELD} />);
    openPicker();
    await choose('date-picker-hour', '06 PM');
    const d = new Date();
    expect(onChange).toHaveBeenCalledWith(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0).toISOString());
  });

  it('zh session: the controls are named by the zh pack and the hours read in the zh clock', async () => {
    render(inSession('zh', <DateTimePickerField value={new Date(2026, 10, 12, 18, 0).toISOString()} onChange={() => {}} field={DT_FIELD} />));
    openPicker();
    const hour = await screen.findByRole('combobox', { name: zh.fields.datePicker.hour });
    expect(hour.textContent).toBe('18时');
    expect(screen.getByRole('combobox', { name: zh.fields.datePicker.minute })).toBeTruthy();
    expect(screen.getByRole('group', { name: zh.fields.datePicker.time })).toBeTruthy();
  });

  it('CONTROL: the date face has no time row, and a day pick closes the popover', async () => {
    const onChange = vi.fn();
    render(<DatePickerField value="2026-10-16" onChange={onChange} field={FIELD} />);
    openPicker();
    const day = await dayButton(2026, 9, 20);
    expect(screen.queryByTestId('date-picker-time')).toBeNull();
    act(() => {
      fireEvent.click(day);
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-20');
    await waitFor(() => expect(document.body.querySelector('button[data-day]')).toBeNull());
  });
});
