/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36806 — a calendar drag is an edit by hand, so the date fields it
 * writes take the one hand-lock verdict of `@object-ui/core`: a `uiReadonly`
 * (or `readonly`) start field closes the drag, a locked end field the resize
 * handle, and a conditional lock (`uiReadonlyWhen`) TRUE over the record takes
 * the drop and writes nothing. On the harness of
 * `ObjectCalendar.endEditable-29020.test.tsx`.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { ObjectCalendar } from '../ObjectCalendar';

const TITLE = 'Build homepage';
const MONTH_HANDLE = 'Resize event end';
const CLOCK = '2026-01-15T12:00:00.000Z';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(lock: { due?: Record<string, unknown>; end?: Record<string, unknown> }, calendar: Record<string, unknown>, row: Record<string, unknown>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
  const objectSchema = {
    name: 'task',
    fields: {
      name: { type: 'text' },
      stage: { type: 'text' },
      due_date: { type: 'date', ...(lock.due ?? {}) },
      end_date: { type: 'date', ...(lock.end ?? {}) },
    },
  };
  const ds = {
    getObjectSchema: vi.fn(async () => objectSchema),
    find: vi.fn(async () => ({ value: [{ id: 't1', name: TITLE, ...row }] })),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 't2' })),
  };
  const schema = { type: 'object-calendar', objectName: 'task', defaultView: 'month', calendar: { titleField: 'name', ...calendar } } as never;
  render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <ObjectCalendar schema={schema} dataSource={ds as never} />
    </LocalizationProvider>,
  );
  return ds;
}

/** `January 12, 2026` out of a month cell's accessible name. */
function dayOf(cell: Element): string {
  const m = (cell.getAttribute('aria-label') ?? '').match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
  return m ? m[0] : '';
}

function cellFor(day: string): HTMLElement {
  const cell = screen.getAllByRole('gridcell').find((c) => dayOf(c) === day);
  expect(cell, `no month cell for ${day}`).toBeDefined();
  return cell as HTMLElement;
}

/** jsdom has no DataTransfer round-trip; carry the payload in a synthetic one. */
function performDnd(source: Element, target: Element) {
  const store: Record<string, string> = {};
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? '',
    setDragImage: () => {},
    types: ['text/plain'],
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}


/** Wait until the object schema has landed, so the lock reads are in force. */
async function settled(ds: { getObjectSchema: ReturnType<typeof vi.fn> }) {
  await screen.findAllByLabelText(TITLE);
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
}

describe('ObjectCalendar: a locked date field closes the drag (objectstack#36806)', () => {
  it.each([['uiReadonly', { uiReadonly: true }], ['readonly', { readonly: true }]])(
    'a `%s` start field: a drop writes nothing',
    async (_name, lock) => {
      const ds = mount({ due: lock }, { startDateField: 'due_date' }, { due_date: '2026-01-12' });
      await settled(ds);
      const [pill] = within(cellFor('January 12, 2026')).getAllByLabelText(TITLE);
      performDnd(pill, cellFor('January 13, 2026'));
      await new Promise((r) => setTimeout(r, 0));
      expect(ds.update).not.toHaveBeenCalled();
    },
  );

  it('a `uiReadonly` end field draws no resize-end handle', async () => {
    const ds = mount(
      { end: { uiReadonly: true } },
      { startDateField: 'due_date', endDateField: 'end_date' },
      { due_date: '2026-01-12', end_date: '2026-01-13' },
    );
    await settled(ds);
    await waitFor(() => expect(screen.queryAllByLabelText(MONTH_HANDLE)).toHaveLength(0));
  });

  it('a `uiReadonlyWhen` TRUE over the record: the drop writes nothing', async () => {
    const ds = mount({ due: { uiReadonlyWhen: "record.stage == 'done'" } }, { startDateField: 'due_date' }, { due_date: '2026-01-12', stage: 'done' });
    await settled(ds);
    const [pill] = within(cellFor('January 12, 2026')).getAllByLabelText(TITLE);
    performDnd(pill, cellFor('January 13, 2026'));
    await new Promise((r) => setTimeout(r, 0));
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('CONTROL — the same predicate FALSE over the record writes the move', async () => {
    const ds = mount({ due: { uiReadonlyWhen: "record.stage == 'done'" } }, { startDateField: 'due_date' }, { due_date: '2026-01-12', stage: 'open' });
    await settled(ds);
    const [pill] = within(cellFor('January 12, 2026')).getAllByLabelText(TITLE);
    performDnd(pill, cellFor('January 13, 2026'));
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith('task', 't1', { due_date: '2026-01-13' }));
  });
});
