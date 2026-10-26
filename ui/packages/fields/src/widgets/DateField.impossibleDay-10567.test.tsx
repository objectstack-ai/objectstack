/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10567 — the EDITABLE date-only faces never blank a stored day that
 * does not exist silently. The date-only half of objectui#10474.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 * `toDateInputValue('2026-02-30')` keeps the day as written (it never rolls),
 * but an `<input type="date">` sanitises a nonexistent day to `""`: measured
 * in Chromium 141, and the HTML value sanitisation algorithm for `date` says
 * the same. So `DateField` and the sub-grid's editable `date` cell painted an
 * empty control with no marker for a stored value: objectui#3127's shape,
 * which objectui#10026's direction A rules out ("never blank silently").
 *
 * ── The face (objectui#10474's, reused) ────────────────────────────────────
 * `isImpossibleStoredDay` judges the day as written. The control is handed
 * `""` (the only thing it can paint), is marked `aria-invalid`, and a notice
 * NAMING the stored string sits beside it and describes it. Nothing is
 * written until the user picks a new value; picking a real day clears the
 * marker.
 *
 * ── Directions, predicted before the run ───────────────────────────────────
 *   pre-card widgets               RED — no `aria-invalid`, no notice
 *   detection removed (ablation)   RED on every impossible-day row,
 *                                  including the edit-clears row (it asserts
 *                                  the marker before the edit)
 *   controls (real day, empty)     green throughout
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateField } from './DateField';
import { GridField } from './GridField';

afterEach(() => cleanup());

/** Nonexistent days, date-only and in the ISO shape an API may hand back. */
const IMPOSSIBLE = ['2026-02-30', '2024-02-31', '2025-02-29', '2026-02-30T00:00:00.000Z'];

/** The real days the engine rolls those onto — none may appear anywhere. */
const ROLLED = ['2026-03-02', '2024-03-02', '2025-03-01'];

/** Real days, a leap day among them — no marker, no notice. */
const REAL = ['2026-02-28', '2024-02-29'];

/** `DateField` reads nothing off `field` on the editable path. */
const NO_FIELD = {} as any;

type Row = Record<string, unknown>;

function StatefulDateField({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
  const [value, setValue] = React.useState(initial);
  return (
    <DateField
      value={value}
      onChange={(v: string) => {
        onChange(v);
        setValue(v);
      }}
      field={NO_FIELD}
    />
  );
}

describe('objectui#10567 — DateField, editable', () => {
  it.each(IMPOSSIBLE)('a stored %s is not blanked silently: the control is marked and the stored string is named', (v) => {
    const onChange = vi.fn();
    const { container } = render(<DateField value={v} onChange={onChange} field={NO_FIELD} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const notice = screen.getByTestId('date-impossible-day');
    expect(notice.textContent).toContain(`"${v}"`);
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(notice.id);
    for (const d of ROLLED) expect(container.textContent + input.value).not.toContain(d);
    // Untouched: nothing is written.
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a host-supplied aria-describedby beside the notice', () => {
    const { container } = render(
      <DateField value="2026-02-30" onChange={() => {}} field={NO_FIELD} aria-describedby="host-msg" />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['host-msg', screen.getByTestId('date-impossible-day').id]);
  });

  it('picking a real day writes it and clears the marker and the notice', () => {
    const onChange = vi.fn();
    const { container } = render(<StatefulDateField initial="2026-02-30" onChange={onChange} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('date-impossible-day')).toBeTruthy();

    fireEvent.change(input, { target: { value: '2026-02-28' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-02-28');
    const after = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(after.value).toBe('2026-02-28');
    expect(after.getAttribute('aria-invalid')).toBe('false');
    expect(after.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('date-impossible-day')).toBeNull();
  });

  it.each(REAL)('control: a real day %s shows as written, with no marker and no notice', (v) => {
    const { container } = render(<DateField value={v} onChange={() => {}} field={NO_FIELD} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.value).toBe(v);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('date-impossible-day')).toBeNull();
  });

  it.each<[string | undefined]>([[''], [undefined]])('control: an empty value (%j) gives no marker and no notice', (v) => {
    const { container } = render(<DateField value={v as string} onChange={() => {}} field={NO_FIELD} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('date-impossible-day')).toBeNull();
  });
});

describe('objectui#10567 — the sub-grid\'s editable `date` cell', () => {
  const field = {
    columns: [
      { name: 'merchant', label: 'Merchant', type: 'text' as const },
      { name: 'due_on', label: 'Due On', type: 'date' as const },
    ],
  } as any;

  function StatefulGrid({ initial, onChange }: { initial: Row[]; onChange: (rows: Row[]) => void }) {
    const [rows, setRows] = React.useState(initial);
    return (
      <GridField
        value={rows}
        onChange={(next: Row[]) => {
          onChange(next);
          setRows(next);
        }}
        field={field}
      />
    );
  }

  it.each(IMPOSSIBLE)('a stored %s is not blanked silently: the cell is marked and the stored string is named', (v) => {
    const onChange = vi.fn();
    const { container } = render(<GridField value={[{ merchant: 'X', due_on: v }]} onChange={onChange} field={field} />);
    const input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('date');
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const notice = screen.getByTestId('line-items-impossible-day-0-due_on');
    expect(notice.textContent).toContain(`"${v}"`);
    expect(input.getAttribute('aria-describedby')).toBe(notice.id);
    for (const d of ROLLED) expect(container.textContent + input.value).not.toContain(d);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picking a real day writes it and clears the marker and the notice', () => {
    const onChange = vi.fn();
    render(<StatefulGrid initial={[{ merchant: 'X', due_on: '2026-02-30' }]} onChange={onChange} />);
    let input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('line-items-impossible-day-0-due_on')).toBeTruthy();

    fireEvent.change(input, { target: { value: '2026-02-28' } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0][0].due_on).toBe('2026-02-28');
    input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
    expect(input.value).toBe('2026-02-28');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('line-items-impossible-day-0-due_on')).toBeNull();
  });

  it.each(REAL)('control: a real day %s shows as written, with no marker and no notice', (v) => {
    render(<GridField value={[{ merchant: 'X', due_on: v }]} onChange={() => {}} field={field} />);
    const input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
    expect(input.value).toBe(v);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('line-items-impossible-day-0-due_on')).toBeNull();
  });

  it('control: an empty cell gives no marker and no notice', () => {
    render(<GridField value={[{ merchant: 'X', due_on: '' }]} onChange={() => {}} field={field} />);
    const input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('line-items-impossible-day-0-due_on')).toBeNull();
  });
});
