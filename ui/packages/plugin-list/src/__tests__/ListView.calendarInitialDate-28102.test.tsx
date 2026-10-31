/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28102 — `ListView`'s calendar branch hands a stored view's
 * `calendar.initialDate` on inside the `object-calendar` node's `calendar`
 * block, the one place `ObjectCalendar` reads the date it opens on from. The
 * branch forwards the block's keys by name, so a key it does not name never
 * reaches the renderer: a renewals list view declaring `next_record` opened on
 * today.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const objectDef = {
  name: 'renewal',
  label: 'Renewal',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    renewal_date: { name: 'renewal_date', type: 'date', label: 'Renewal Date' },
  },
};

let captured: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-calendar',
  (props: Record<string, any>) => {
    captured.push(props);
    return <div data-testid="calendar-spy" />;
  },
  { namespace: 'test', label: 'Calendar spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => []),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

async function calendarNode(calendar: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: 'renewal', viewType: 'calendar', columns: ['name'], calendar } as never}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1].schema;
}

beforeEach(() => {
  captured = [];
});
afterEach(cleanup);

describe('ListView calendar branch — calendar.initialDate reaches the node (objectstack#28102)', () => {
  it.each(['next_record', 'first_record', '{next_month_start}'])('forwards `initialDate: %s` inside the calendar block', async (initialDate) => {
    const node = await calendarNode({ startDateField: 'renewal_date', initialDate });
    expect(node.calendar).toEqual({ startDateField: 'renewal_date', initialDate });
    expect(node).not.toHaveProperty('initialDate');
  });

  it('CONTROL: a block without the key carries none', async () => {
    const node = await calendarNode({ startDateField: 'renewal_date' });
    expect(node.calendar).toEqual({ startDateField: 'renewal_date' });
  });
});
