/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The data table's built-in inline date editors on a stored day that does not
 * exist (objectui#10625, the data-table half; the objectui#10026 direction A:
 * never roll, never blank silently).
 *
 * The table used to keep private copies of the native date adapters with no
 * impossible-day check. Measured before the fix: a stored `2026-02-30` on a
 * `date` column showed an empty control with no marker, and a stored
 * `2026-02-30T10:00:00Z` on a `datetime` column showed the ROLLED day
 * (`2026-03-02T10:00` in UTC), so an edit of the minutes alone wrote March 2nd.
 * The table now takes the one adapter set from `@object-ui/core` and follows
 * `DateField` / `DateTimeField`'s face: an empty control, `aria-invalid`, and a
 * notice naming the stored string, described by the control.
 *
 * Rendered through the real registry (`renderComponent`), with no host
 * `renderCellEditor`, which is exactly the path a schema-authored editable
 * `data-table` node takes. Assertions hold in every timezone: a real datetime
 * is judged by the instant it reads back as, never by a hard-coded wall clock.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../renderers';

function tableWith(type: 'date' | 'datetime', stored: string, onCellChange = vi.fn()) {
  const schema = {
    type: 'data-table' as const,
    editable: true,
    singleClickEdit: true,
    columns: [
      { header: 'Name', accessorKey: 'name', editable: false },
      { header: 'When', accessorKey: 'when', type },
    ],
    data: [{ id: '1', name: 'Row one', when: stored }],
    onCellChange,
  } as any;
  const { container } = renderComponent(schema);
  const cell = container.querySelectorAll('tbody td')[1] as HTMLElement;
  fireEvent.click(cell);
  const input = cell.querySelector('input') as HTMLInputElement;
  return { cell, input, onCellChange };
}

function noticeFor(input: HTMLInputElement): HTMLElement | null {
  const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

describe('data-table inline date editors on an impossible stored day (objectui#10625)', () => {
  it('a date column shows an empty, invalid control with a notice naming the stored string', () => {
    const { input } = tableWith('date', '2026-02-30');
    expect(input.type).toBe('date');
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const notice = noticeFor(input);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('2026-02-30');
  });

  it('a datetime column shows an empty, invalid control (never the rolled day) with a notice', () => {
    const { input } = tableWith('datetime', '2026-02-30T10:00:00Z');
    expect(input.type).toBe('datetime-local');
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const notice = noticeFor(input);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('2026-02-30T10:00:00Z');
  });

  it('Enter with no edit stages nothing rolled on either column', () => {
    for (const [type, stored] of [
      ['date', '2026-02-30'],
      ['datetime', '2026-02-30T10:00:00Z'],
    ] as const) {
      const { input, onCellChange } = tableWith(type, stored);
      fireEvent.keyDown(input, { key: 'Enter' });
      for (const call of onCellChange.mock.calls) {
        expect(call[2]).toBe(stored);
      }
    }
  });
});

describe('data-table inline date editors on a real stored day (objectui#10625)', () => {
  it('a date column round-trips unchanged and is not marked invalid', () => {
    const { input, onCellChange } = tableWith('date', '2026-02-14');
    expect(input.value).toBe('2026-02-14');
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
    expect(noticeFor(input)).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange.mock.calls[0][2]).toBe('2026-02-14');
  });

  it('a datetime column shows the stored instant and writes it back on the same basis', () => {
    const stored = '2026-02-14T10:00:00.000Z';
    const { input, onCellChange } = tableWith('datetime', stored);
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Read back as local time, the control's wall clock is the stored instant.
    expect(new Date(input.value).toISOString()).toBe(stored);
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
    expect(noticeFor(input)).toBeNull();
    fireEvent.change(input, { target: { value: input.value } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange.mock.calls[0][2]).toBe(stored);
  });
});
