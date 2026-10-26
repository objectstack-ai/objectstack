/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — the calendar's two default writes read the affordance-to-
 * grant map: quick-create (an empty-day click, or a time-range drag in the
 * week / day grid) reads `calendarQuickCreate`, and drag-to-reschedule reads
 * `calendarReschedule`.
 *
 * Before, neither read a grant. A read-only caller could open the quick-create
 * dialog and submit it, and could drag an event to a new day; both writes went
 * out and the server refused them. The fix is the one `CalendarView` already
 * understands: an affordance is the PRESENCE of its handler (an absent
 * `onEventDrop` draws no draggable event, an absent `onTimeRangeSelect` starts
 * no range drag, an absent `onDateClick` opens nothing), so `ObjectCalendar`
 * hands the grid a handler only when the row allows the write.
 *
 * `CalendarView` is replaced by a probe that records the handlers it is given:
 * the grid's own "capability = handler presence" contract is pinned in its own
 * suite (`CalendarView.dnd.test.tsx`), and what is measured here is which
 * handlers `ObjectCalendar` hands it under each grant. Driving the recorded
 * handler is the real path into `ObjectCalendar`'s own write.
 *
 * A caller-supplied `onDateClick` / `onEventDrop` is the HOST's channel — the
 * host decides what a click or a drop does — and is handed through unchanged.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

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

const OBJECT = 'crm_leave_request';
const ROWS = [{ id: 'r1', name: 'Ada out', start_date: '2020-03-10' }];

const SCHEMA = {
  type: 'object-calendar',
  objectName: OBJECT,
  calendar: { startDateField: 'start_date', titleField: 'name' },
} as any;

const makeDataSource = () =>
  ({
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: { id: { type: 'text' }, name: { type: 'text' }, start_date: { type: 'date' } },
    }),
    create: vi.fn().mockResolvedValue({ id: 'r2' }),
    update: vi.fn().mockResolvedValue({}),
  }) as any;

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; create: boolean; update: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, create: true, update: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, create: false, update: true },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, create: false, update: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, create: true, update: true },
];

const envelope = (bits: Record<string, unknown>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits as never },
  fields: {},
});

beforeEach(() => {
  probe.props = null;
});
afterEach(cleanup);

type Handler = ((...args: unknown[]) => unknown) | undefined;
const handler = (name: string): Handler => probe.props?.[name] as Handler;

async function mount(perms: MePermissionsResponse | null, ds = makeDataSource(), props: Record<string, unknown> = {}) {
  const cal = <ObjectCalendar schema={SCHEMA} dataSource={ds} data={ROWS as any} {...props} />;
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{cal}</MePermissionsProvider> : cal);
  await screen.findByTestId('calendar-probe');
  // The object schema settles after the first paint; the drop's date
  // conversion and the policy layer both read it.
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  return ds;
}

describe.each(SHAPES)('ObjectCalendar under a $shape grant (objectui#12082)', ({ bits, create, update }) => {
  it('quick-create (day click and time-range drag) is offered exactly when the create grant allows it', async () => {
    await mount(envelope(bits));
    expect(typeof handler('onDateClick') === 'function', 'onDateClick').toBe(create);
    expect(typeof handler('onTimeRangeSelect') === 'function', 'onTimeRangeSelect').toBe(create);
    if (create) {
      act(() => {
        handler('onDateClick')!(new Date(2020, 2, 18));
      });
      expect(await screen.findByRole('dialog')).toBeTruthy();
    }
  });

  it('drag-to-reschedule is offered exactly when the update grant allows it, and only then writes', async () => {
    const ds = await mount(envelope(bits));
    expect(typeof handler('onEventDrop') === 'function', 'onEventDrop').toBe(update);
    if (update) {
      await act(async () => {
        await handler('onEventDrop')!({ id: 'r1', data: ROWS[0] }, new Date(2020, 2, 12));
      });
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      expect(ds.update.mock.calls[0][0]).toBe(OBJECT);
    }
  });
});

describe('ObjectCalendar: the map\'s other layers and fail-open (objectui#12082)', () => {
  it('fail-open: with no permission provider every default handler is offered, as before', async () => {
    await mount(null);
    for (const name of ['onDateClick', 'onTimeRangeSelect', 'onEventDrop']) {
      expect(typeof handler(name), name).toBe('function');
    }
  });

  it('an effective operation set without create and update withholds both writes under the full grant', async () => {
    await mount(envelope({ ...SHAPES[3].bits, apiOperations: ['read'] }));
    for (const name of ['onDateClick', 'onTimeRangeSelect', 'onEventDrop']) {
      expect(handler(name), name).toBeUndefined();
    }
  });

  it('a host-supplied onDateClick / onEventDrop is handed through unchanged, whatever the grant', async () => {
    const onDateClick = vi.fn();
    const onEventDrop = vi.fn();
    const ds = await mount(envelope(SHAPES[2].bits), makeDataSource(), { onDateClick, onEventDrop });
    act(() => {
      handler('onDateClick')!(new Date(2020, 2, 18));
    });
    await act(async () => {
      await handler('onEventDrop')!({ id: 'r1', data: ROWS[0] }, new Date(2020, 2, 12));
    });
    expect(onDateClick).toHaveBeenCalledTimes(1);
    expect(onEventDrop).toHaveBeenCalledTimes(1);
    expect(ds.update).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
