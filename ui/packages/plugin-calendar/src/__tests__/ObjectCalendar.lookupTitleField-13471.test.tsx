/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13471 — a calendar whose `titleField` names a LOOKUP.
 *
 * The record query asks for the lookup expanded, so the value arrives as an
 * object (`{ _id, name }`). `ObjectCalendar` used to stringify the author's
 * `titleField` itself, so every event read the literal `[object Object]`. It now
 * hands the field to the unified record display-name resolver as the explicit
 * rung, which reduces an expanded reference to its display name.
 *
 * Events are read off the props `CalendarView` receives, the same seam the
 * `colorField` ladder test uses.
 */

import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectCalendar } from '../ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

let lastEvents: any[] = [];

vi.mock('../CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ events }: any) => {
      lastEvents = events;
      return <div data-testid="calendar-view" data-event-count={String(events.length)} />;
    },
  };
});

const OBJECT_SCHEMA = {
  name: 'srm_supplier_audit',
  nameField: 'audit_no',
  fields: {
    audit_no: { name: 'audit_no', type: 'text' },
    supplier: { name: 'supplier', type: 'lookup', reference_to: 'srm_supplier' },
    planned_date: { name: 'planned_date', type: 'datetime' },
  },
};

function makeDataSource(rows: any[]) {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  } as any;
}

async function titlesFor(rows: any[]): Promise<string[]> {
  lastEvents = [];
  const schema: any = {
    type: 'object-calendar',
    objectName: 'srm_supplier_audit',
    calendar: { startDateField: 'planned_date', titleField: 'supplier' },
  };
  const { unmount } = render(<ObjectCalendar schema={schema} dataSource={makeDataSource(rows)} />);
  try {
    let settled: any[] = [];
    await waitFor(() => {
      const events = lastEvents;
      expect(events).toHaveLength(rows.length);
      settled = events;
    });
    return settled.map((e) => e.title);
  } finally {
    unmount();
    expect(screen.queryAllByTestId('calendar-view')).toHaveLength(0);
  }
}

describe('objectui#13471 — calendar titleField naming a lookup', () => {
  it('an expanded lookup object shows the referenced record name', async () => {
    const titles = await titlesFor([
      { id: 'a1', audit_no: 'AUD-1', planned_date: '2026-10-05T09:00:00Z', supplier: { _id: 's1', name: 'Acme Metals' } },
      { id: 'a2', audit_no: 'AUD-2', planned_date: '2026-10-06T09:00:00Z', supplier: { id: 's2', name: 'Borealis Plastics' } },
    ]);
    expect(titles).toEqual(['Acme Metals', 'Borealis Plastics']);
  });

  it('a raw id string still shows as it did', async () => {
    const titles = await titlesFor([
      { id: 'a1', audit_no: 'AUD-1', planned_date: '2026-10-05T09:00:00Z', supplier: 'sup-001' },
    ]);
    expect(titles).toEqual(['sup-001']);
  });

  it('an expanded object with no usable name never prints [object Object]', async () => {
    const titles = await titlesFor([
      { id: 'a1', audit_no: 'AUD-1', planned_date: '2026-10-05T09:00:00Z', supplier: { _id: 's1' } },
      { id: 'a2', audit_no: 'AUD-2', planned_date: '2026-10-06T09:00:00Z', supplier: null },
    ]);
    expect(titles.some((t) => t.includes('[object Object]'))).toBe(false);
    // Falls through to the object-level resolver (`nameField`), the same ladder
    // an empty titleField always took.
    expect(titles).toEqual(['AUD-1', 'AUD-2']);
  });
});
