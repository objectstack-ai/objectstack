/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37448 — the calendar's quick-create judges the field hand lock
 * (`uiReadonly`) by its static half, as the create dialog does.
 *
 * The dialog writes the title field and the date fields itself, and fills the
 * other required fields it can (`quickCreateFill`). A field read-only by hand
 * is never in that write:
 *
 * - the title, start or end field locked: the dialog cannot leave it out of
 *   its own write, so the gesture goes to the host's full create form, and a
 *   locked date field is not prefilled there;
 * - another required field locked: it is left out, so the server applies its
 *   `defaultValue`; without one the write would be refused for it, so the
 *   gesture goes to the full form (`requiredFieldsQuickCreateCannotFill`).
 *
 * `CalendarView` is replaced by a probe that records the handlers it is
 * handed, as in `ObjectCalendar.quickCreateHandoff-12291.test.tsx`.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const probe = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock('./CalendarView', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    CalendarView: (props: Record<string, unknown>) => {
      probe.props = props;
      return <div data-testid="calendar-probe" />;
    },
  };
});

import { ObjectCalendar } from './ObjectCalendar';

const FIELDS = {
  subject: { type: 'text', required: true },
  status: {
    type: 'select',
    required: true,
    options: [
      { label: 'Planned', value: 'planned' },
      { label: 'Completed', value: 'completed' },
    ],
  },
  starts_on: { type: 'date' },
  ends_on: { type: 'date' },
};

const SCHEMA = {
  type: 'object-calendar',
  objectName: 'hlk_event',
  calendar: { startDateField: 'starts_on', endDateField: 'ends_on', titleField: 'subject' },
} as any;

const OCT_20 = new Date(2026, 9, 20);

const makeDataSource = (fields: Record<string, unknown>) =>
  ({
    find: vi.fn().mockResolvedValue({ data: [] }),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'hlk_event', fields }),
    create: vi.fn().mockResolvedValue({ id: 'new-1' }),
    update: vi.fn().mockResolvedValue({}),
  }) as any;

beforeEach(() => {
  probe.props = null;
});
afterEach(cleanup);

type Handler = ((...args: unknown[]) => unknown) | undefined;
const handler = (name: string): Handler => probe.props?.[name] as Handler;

async function mount(fields: Record<string, unknown>) {
  const ds = makeDataSource(fields);
  const onEdit = vi.fn();
  render(<ObjectCalendar schema={SCHEMA} dataSource={ds} data={[]} onEdit={onEdit} />);
  await screen.findByTestId('calendar-probe');
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { ds, onEdit };
}

function clickDay() {
  act(() => {
    handler('onDateClick')!(OCT_20);
  });
}

describe('ObjectCalendar quick-create — a field the dialog writes itself, locked by hand (objectstack#37448)', () => {
  it('the title field `uiReadonly`: the day goes to the full form, with no dialog and no write', async () => {
    const { ds, onEdit } = await mount({ ...FIELDS, subject: { ...FIELDS.subject, uiReadonly: true } });
    clickDay();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ starts_on: '2026-10-20', ends_on: '2026-10-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('the start field `uiReadonly`: the day goes to the full form, which is not prefilled with the locked field', async () => {
    const { ds, onEdit } = await mount({ ...FIELDS, starts_on: { type: 'date', uiReadonly: true } });
    clickDay();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ ends_on: '2026-10-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('the end field `uiReadonly`: the same, for the end field', async () => {
    const { onEdit } = await mount({ ...FIELDS, ends_on: { type: 'date', uiReadonly: true } });
    clickDay();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ starts_on: '2026-10-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CONTROL: a conditional lock (`uiReadonlyWhen`) does not judge a create, so the dialog stays', async () => {
    const { onEdit } = await mount({ ...FIELDS, starts_on: { type: 'date', uiReadonlyWhen: 'true' } });
    clickDay();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('ObjectCalendar quick-create — a required field the dialog fills, locked by hand (objectstack#37448)', () => {
  it('a required `uiReadonly` select with no default is not auto-filled: the day goes to the full form', async () => {
    const { ds, onEdit } = await mount({ ...FIELDS, status: { ...FIELDS.status, uiReadonly: true } });
    clickDay();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('a required `uiReadonly` field with a default keeps the dialog and is left out of its write', async () => {
    const { ds, onEdit } = await mount({
      ...FIELDS,
      status: { ...FIELDS.status, uiReadonly: true, defaultValue: 'completed' },
    });
    clickDay();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Call Ada', starts_on: '2026-10-20', ends_on: '2026-10-20' });
  });

  it('CONTROL: with no lock the dialog writes the auto-filled select', async () => {
    const { ds } = await mount(FIELDS);
    clickDay();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Call Ada', starts_on: '2026-10-20', ends_on: '2026-10-20', status: 'planned' });
  });
});
