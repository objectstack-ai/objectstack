/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10474 — the EDITABLE date-time faces never roll a stored day that
 * does not exist into a real one, and never blank it silently.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 * `toDateTimeInputValue` let a `Z` / offset / date-only spelling fall through
 * to `new Date(...)` plus local getters, so `2026-02-30T10:00:00Z` reached the
 * `datetime-local` control as `2026-03-02T10:00`, and `fromDateTimeInputValue`
 * re-emitted through `new Date(value).toISOString()`, rolling the same way.
 * The zone-less spelling was handed over verbatim, which a real control
 * sanitises to `""`: a silent blank (objectui#3127's shape).
 *
 * ── The face ───────────────────────────────────────────────────────────
 * The control cannot show the stored string (measured in Chromium: a
 * `datetime-local` sanitises a nonexistent day to `""` in every spelling), so
 * the control gets `""`, is marked `aria-invalid`, and a notice NAMING the
 * stored string sits beside it and describes it. Nothing is written until the
 * user picks a new value.
 *
 * Every expectation is written to hold in any TZ (the suite is run under UTC
 * and a non-UTC zone): expected wall clocks are derived, never hardcoded.
 *
 * ── Directions, predicted before the run ───────────────────────────────────
 *   pre-card adapter                RED — `2026-03-02T10:00` in the control,
 *                                   no notice, no `aria-invalid`
 *   controls                        green throughout
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateTimeField } from './DateTimeField';
import { GridField } from './GridField';
import {
  fromDateTimeInputValue,
  isImpossibleStoredDay,
  toDateInputValue,
  toDateTimeInputValue,
} from './nativeDateValue';

afterEach(() => cleanup());

const IMPOSSIBLE = [
  '2026-02-30T10:00:00Z',
  '2026-02-30T10:00:00.000Z',
  '2026-02-30T10:00+08:00',
  '2026-02-30T10:00',
  '2026-02-30',
  '2025-02-29T23:30:00-05:00',
];

/** The real day the engine rolls each impossible spelling onto. */
const ROLLED = ['2026-03-02', '2026-03-01', '2025-03-01', '2025-03-02'];

const REAL_ISO = '2026-06-17T14:30:00.000Z';
const localWallClockOf = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe('objectui#10474 — the adapter judges the day as written', () => {
  it.each(IMPOSSIBLE)('%s is an impossible stored day and never reaches the control as a real one', (v) => {
    expect(isImpossibleStoredDay(v)).toBe(true);
    expect(toDateTimeInputValue(v)).toBe('');
  });

  it.each(['2026-02-30T10:00', '2026-02-30T10:00:00'])('fromDateTimeInputValue never re-emits %s as a rolled day', (v) => {
    const out = fromDateTimeInputValue(v);
    expect(out).toBe(v);
    for (const d of ROLLED) expect(out).not.toContain(d);
  });

  it('controls: a real instant, a zone-less value, a real day written with an offset', () => {
    expect(isImpossibleStoredDay(REAL_ISO)).toBe(false);
    expect(toDateTimeInputValue(REAL_ISO)).toBe(localWallClockOf(REAL_ISO));
    expect(toDateTimeInputValue('2026-06-17T14:30')).toBe('2026-06-17T14:30');
    // March 1st in UTC, written on a real day: kept, converted as before.
    const offset = '2026-02-28T23:30:00-05:00';
    expect(isImpossibleStoredDay(offset)).toBe(false);
    expect(toDateTimeInputValue(offset)).toBe(localWallClockOf(offset));
    expect(fromDateTimeInputValue('2026-06-17T14:30')).toBe(new Date('2026-06-17T14:30').toISOString());
    expect(isImpossibleStoredDay(new Date(2026, 1, 28))).toBe(false);
    expect(isImpossibleStoredDay('not a date')).toBe(false);
  });

  it('the `date` editor keeps the leading YYYY-MM-DD verbatim (unchanged, never rolled)', () => {
    expect(toDateInputValue('2026-02-30')).toBe('2026-02-30');
    expect(toDateInputValue('2026-02-30T10:00:00Z')).toBe('2026-02-30');
  });
});

describe('objectui#10474 — DateTimeField, editable', () => {
  it.each(IMPOSSIBLE)('a stored %s is never shown as a rolled day, and the invalid state is visible', (v) => {
    const onChange = vi.fn();
    const { container } = render(<DateTimeField value={v} onChange={onChange} field={{} as any} />);
    const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const notice = screen.getByTestId('datetime-impossible-day');
    expect(notice.textContent).toContain(`"${v}"`);
    expect(input.getAttribute('aria-describedby')).toContain(notice.id);
    for (const d of ROLLED) expect(container.textContent + input.value).not.toContain(d);
    // Untouched: nothing is written.
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a host-supplied aria-describedby beside the notice', () => {
    const { container } = render(
      <DateTimeField value="2026-02-30T10:00:00Z" onChange={() => {}} field={{} as any} {...({ 'aria-describedby': 'host-msg' } as any)} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['host-msg', screen.getByTestId('datetime-impossible-day').id]);
  });

  it('an explicit new pick writes the picked value', () => {
    const onChange = vi.fn();
    const { container } = render(<DateTimeField value="2026-02-30T10:00:00Z" onChange={onChange} field={{} as any} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-03-01T09:15' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(new Date('2026-03-01T09:15').toISOString());
  });

  it('controls: a real instant round-trips unchanged; a zone-less value keeps today\'s face; no notice', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<DateTimeField value={REAL_ISO} onChange={onChange} field={{} as any} />);
    let input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe(localWallClockOf(REAL_ISO));
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('datetime-impossible-day')).toBeNull();
    // The control hands back what it shows; the write lands on the same instant.
    fireEvent.change(input, { target: { value: localWallClockOf('2026-06-17T15:30:00.000Z') } });
    expect(onChange).toHaveBeenLastCalledWith('2026-06-17T15:30:00.000Z');

    rerender(<DateTimeField value="2026-06-17T14:30" onChange={onChange} field={{} as any} />);
    input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('2026-06-17T14:30');
    expect(screen.queryByTestId('datetime-impossible-day')).toBeNull();
  });
});

describe('objectui#10474 — the sub-grid\'s editable `datetime` cell', () => {
  const field = {
    columns: [
      { name: 'merchant', label: 'Merchant', type: 'text' as const },
      { name: 'incurred_at', label: 'Incurred At', type: 'datetime' as const },
    ],
  } as any;

  it('a stored 2026-02-30T10:00:00Z is not shown as 2 March, the invalid state is visible, and nothing is written untouched', () => {
    const onChange = vi.fn();
    const { container } = render(
      <GridField value={[{ merchant: 'X', incurred_at: '2026-02-30T10:00:00Z' }]} onChange={onChange} field={field} />,
    );
    const input = screen.getAllByLabelText('Incurred At')[0] as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('datetime-local');
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const notice = screen.getByTestId('line-items-impossible-day-0-incurred_at');
    expect(notice.textContent).toContain('"2026-02-30T10:00:00Z"');
    expect(input.getAttribute('aria-describedby')).toBe(notice.id);
    expect(container.textContent).not.toContain('2026-03-02');
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an explicit new pick writes the picked value', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ merchant: 'X', incurred_at: '2026-02-30T10:00:00Z' }]} onChange={onChange} field={field} />);
    fireEvent.change(screen.getAllByLabelText('Incurred At')[0], { target: { value: '2026-03-01T09:15' } });
    expect(onChange).toHaveBeenCalled();
    const rows = onChange.mock.calls.at(-1)![0];
    expect(rows[0].incurred_at).toBe(new Date('2026-03-01T09:15').toISOString());
  });

  it('control: a real instant shows its local wall clock with no notice', () => {
    render(<GridField value={[{ merchant: 'X', incurred_at: REAL_ISO }]} onChange={() => {}} field={field} />);
    const input = screen.getAllByLabelText('Incurred At')[0] as HTMLInputElement;
    expect(input.value).toBe(localWallClockOf(REAL_ISO));
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('line-items-impossible-day-0-incurred_at')).toBeNull();
  });
});
