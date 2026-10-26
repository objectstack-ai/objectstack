/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12291 — quick-create from an empty day is offered only where its
 * write can succeed, and otherwise hands the day to the host's full create form.
 *
 * Measured on the stock `showcase_task` (required `project`, a master-detail
 * lookup): the dialog asked for a title only, its write auto-filled the
 * required select and left the lookup empty, and the server answered 400
 * "Project is required" — with no Project input anywhere in the dialog. The
 * triage direction on the card: check the object's required fields against what
 * quick-create can fill BEFORE offering the dialog; where one is outside that
 * set, open the full create form pre-filled with the clicked day's date field;
 * ⛔ no lookup picker in the dialog, ⛔ no guessed lookup value.
 *
 * The full create form is the HOST's. `ObjectCalendar` reaches it through the
 * declared `onEdit` prop, the channel `ListView` already hands down (and in the
 * console that is the handler that opens the record form): it is called with a
 * NEW record — no id — carrying the date values. The console half of the
 * hand-off (the form opening with those values) is pinned in `app-shell`'s
 * `AppContent.createSeed-12291.test.tsx`.
 *
 * `CalendarView` is replaced by a probe that records the handlers it is handed,
 * as in `ObjectCalendar.writeGrant-12082.test.tsx`: an affordance is the
 * PRESENCE of its handler there, so what is measured here is which handler
 * `ObjectCalendar` hands the grid, and driving it is the real path into the
 * component's own decision.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

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
// Module scope: the registration the relay case renders through.
import './index';

/** The stock `showcase_task`'s required set: a required master-detail lookup. */
const TASK_FIELDS = {
  title: { type: 'text', required: true },
  project: { type: 'master_detail', reference: 'showcase_project', required: true },
  status: {
    type: 'select',
    required: true,
    options: [
      { label: 'Backlog', value: 'backlog' },
      { label: 'To Do', value: 'todo' },
    ],
  },
  due_date: { type: 'date' },
};

/** The stock `crm_activity`'s required set: the title plus two required selects. */
const ACTIVITY_FIELDS = {
  subject: { type: 'text', required: true },
  type: {
    type: 'select',
    required: true,
    options: [
      { label: 'Call', value: 'call' },
      { label: 'Email', value: 'email' },
    ],
  },
  status: {
    type: 'select',
    required: true,
    options: [
      { label: 'Planned', value: 'planned' },
      { label: 'Completed', value: 'completed' },
    ],
  },
  due_date: { type: 'datetime' },
  contact: { type: 'lookup', reference: 'crm_contact' },
};

const TASK_SCHEMA = {
  type: 'object-calendar',
  objectName: 'showcase_task',
  calendar: { startDateField: 'due_date', titleField: 'title' },
} as any;

const ACTIVITY_SCHEMA = {
  type: 'object-calendar',
  objectName: 'crm_activity',
  calendar: { startDateField: 'due_date', titleField: 'subject' },
} as any;

/** The day the card's reproduction clicked. */
const OCT_20 = new Date(2026, 9, 20);

const makeDataSource = (objectName: string, fields: Record<string, unknown>) =>
  ({
    find: vi.fn().mockResolvedValue({ data: [] }),
    getObjectSchema: vi.fn().mockResolvedValue({ name: objectName, fields }),
    create: vi.fn().mockResolvedValue({ id: 'new-1' }),
    update: vi.fn().mockResolvedValue({}),
  }) as any;

beforeEach(() => {
  probe.props = null;
});
afterEach(cleanup);

type Handler = ((...args: unknown[]) => unknown) | undefined;
const handler = (name: string): Handler => probe.props?.[name] as Handler;

/**
 * Let the object schema SETTLE: the decision reads its field definitions, so
 * the handler the grid holds before that is the no-schema default. The adapter
 * double answers on a microtask; one macrotask inside `act` lets that answer
 * land and the re-render commit.
 */
async function schemaSettled(ds: { getObjectSchema: ReturnType<typeof vi.fn> }) {
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(
  schema: any,
  fields: Record<string, unknown>,
  props: Record<string, unknown> = {},
  perms: MePermissionsResponse | null = null,
) {
  const ds = makeDataSource(schema.objectName, fields);
  const cal = <ObjectCalendar schema={schema} dataSource={ds} data={[]} {...props} />;
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{cal}</MePermissionsProvider> : cal);
  await screen.findByTestId('calendar-probe');
  await schemaSettled(ds);
  return ds;
}

describe('objectui#12291 — an object quick-create cannot satisfy hands the day to the host\'s full create form', () => {
  it('on showcase_task (required project) the empty-day click opens the full form with due_date set, and no dialog', async () => {
    const onEdit = vi.fn();
    const ds = await mount(TASK_SCHEMA, TASK_FIELDS, { onEdit });

    act(() => {
      handler('onDateClick')!(OCT_20);
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    // A NEW record (no id) carrying exactly the clicked day, in the stored
    // `YYYY-MM-DD` form of a `date` field — and nothing guessed for `project`.
    expect(onEdit.mock.calls[0][0]).toEqual({ due_date: '2026-10-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('a week / day range drag hands off too, with both ends when the calendar binds an end field', async () => {
    const onEdit = vi.fn();
    const schema = {
      type: 'object-calendar',
      objectName: 'showcase_task',
      calendar: { startDateField: 'start_at', endDateField: 'end_at', titleField: 'title' },
    } as any;
    const fields = {
      title: TASK_FIELDS.title,
      project: TASK_FIELDS.project,
      start_at: { type: 'datetime' },
      end_at: { type: 'datetime' },
    };
    await mount(schema, fields, { onEdit });
    const start = new Date(2026, 9, 20, 9, 0);
    const end = new Date(2026, 9, 20, 10, 30);

    act(() => {
      handler('onTimeRangeSelect')!(start, end);
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ start_at: start.toISOString(), end_at: end.toISOString() });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reaches the host through the registered renderer, as `ListView` hands its `onEdit` down', async () => {
    const onEdit = vi.fn();
    const ds = makeDataSource('showcase_task', TASK_FIELDS);
    render(
      <SchemaRendererProvider dataSource={ds}>
        <SchemaRenderer
          schema={{ type: 'object-calendar', id: 'n', objectName: 'showcase_task', startDateField: 'due_date', titleField: 'title' } as never}
          data={[]}
          onEdit={onEdit}
        />
      </SchemaRendererProvider>,
    );
    await screen.findByTestId('calendar-probe');
    await schemaSettled(ds);

    act(() => {
      handler('onDateClick')!(OCT_20);
    });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual({ due_date: '2026-10-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no host form to hand off to, the gesture offers nothing on such an object', async () => {
    await mount(TASK_SCHEMA, TASK_FIELDS);
    expect(handler('onDateClick')).toBeUndefined();
    expect(handler('onTimeRangeSelect')).toBeUndefined();
  });

  it('a closed `calendarQuickCreate` row withholds the hand-off exactly as it withholds the dialog', async () => {
    const onEdit = vi.fn();
    const readOnly: MePermissionsResponse = {
      authenticated: true,
      userId: 'u-pin',
      tenantId: null,
      roles: ['member'],
      permissionSets: ['member'],
      objects: { showcase_task: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false } as never },
      fields: {},
    };
    await mount(TASK_SCHEMA, TASK_FIELDS, { onEdit }, readOnly);
    expect(handler('onDateClick')).toBeUndefined();
    expect(handler('onTimeRangeSelect')).toBeUndefined();
  });

  it('a caller-supplied onDateClick still wins over the hand-off', async () => {
    const onEdit = vi.fn();
    const onDateClick = vi.fn();
    await mount(TASK_SCHEMA, TASK_FIELDS, { onEdit, onDateClick });
    act(() => {
      handler('onDateClick')!(OCT_20);
    });
    expect(onDateClick).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('objectui#12291 — an object with no unfillable required field keeps the dialog', () => {
  it('crm_activity: the click opens the dialog, and its write carries the day and the auto-filled selects', async () => {
    const onEdit = vi.fn();
    const ds = await mount(ACTIVITY_SCHEMA, ACTIVITY_FIELDS, { onEdit });

    act(() => {
      handler('onDateClick')!(OCT_20);
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][0]).toBe('crm_activity');
    expect(ds.create.mock.calls[0][1]).toEqual({
      subject: 'Call Ada',
      due_date: OCT_20.toISOString(),
      type: 'call',
      status: 'planned',
    });
  });
});

describe('objectui#12291 — the check and the write read ONE statement of what quick-create can fill', () => {
  // Each row adds one required field to an object that otherwise keeps the
  // dialog, and names whether quick-create can carry it. The write's own
  // auto-fill and the check before the dialog must answer alike: a field the
  // write fills keeps the dialog, a field it leaves empty hands off.
  const ROWS: Array<{ name: string; def: Record<string, unknown>; handsOff: boolean }> = [
    { name: 'a required select with options', def: { type: 'select', required: true, options: [{ label: 'A', value: 'a' }] }, handsOff: false },
    { name: 'a required select with NO options', def: { type: 'select', required: true, options: [] }, handsOff: true },
    { name: 'a required boolean', def: { type: 'boolean', required: true }, handsOff: false },
    { name: 'a required currency', def: { type: 'currency', required: true }, handsOff: false },
    { name: 'a required text with a declared default', def: { type: 'text', required: true, defaultValue: 'n/a' }, handsOff: false },
    { name: 'a required text', def: { type: 'text', required: true }, handsOff: true },
    { name: 'a required lookup', def: { type: 'lookup', reference: 'crm_account', required: true }, handsOff: true },
    // The server fills these on insert, so the write is not refused for them.
    { name: 'a required readonly field', def: { type: 'text', required: true, readonly: true }, handsOff: false },
    { name: 'a required system field', def: { type: 'lookup', reference: 'sys_user', required: true, system: true }, handsOff: false },
    { name: 'a required autonumber', def: { type: 'autonumber', required: true }, handsOff: false },
  ];

  it.each(ROWS)('$name — hands off: $handsOff', async ({ def, handsOff }) => {
    const onEdit = vi.fn();
    const ds = await mount(ACTIVITY_SCHEMA, { ...ACTIVITY_FIELDS, extra: def }, { onEdit });

    act(() => {
      handler('onDateClick')!(OCT_20);
    });

    if (handsOff) {
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
      return;
    }
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  });
});
