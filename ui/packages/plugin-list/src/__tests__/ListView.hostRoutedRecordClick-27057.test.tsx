/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27057 — `ListView` hands the calendar and the gantt its click
 * router only when its HOST routes record clicks.
 *
 * Since this card both views give a row click to whoever hands them one, and
 * open their own record drawer only when nobody does. The console's object,
 * data and interface pages pass `ListView` an `onRowClick` that opens the
 * record in the one record page, and the router delivers the calendar's and
 * the gantt's clicks to it. A list mounted with no host handler (a page
 * `list-view` block) routes nothing by itself for a view that authored no
 * `navigation`, so there the two views keep their drawer: the router would
 * have turned it into a click that opens nothing.
 *
 * Rows, each reading the node `ListView` built for its child view:
 *   - host handler, calendar and gantt → the node carries the router, and
 *     calling it reaches the host with the row;
 *   - no host handler, calendar and gantt → no router on the node;
 *   - CONTROL, kanban and grid → the router either way, as before.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const rows = [
  { id: '1', name: 'Ada onboarding', start_date: '2099-09-01', end_date: '2099-09-03' },
];

const objectDef = {
  name: 'crm_leave_request',
  label: 'Leave Request',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    end_date: { name: 'end_date', type: 'date', label: 'End Date' },
  },
};

let captured: Array<Record<string, any>> = [];

const makeSpy = (testid: string) => (props: Record<string, any>) => {
  captured.push({ testid, ...props });
  return <div data-testid={testid} />;
};

for (const type of ['object-calendar', 'object-gantt', 'object-kanban', 'object-grid']) {
  ComponentRegistry.register(type, makeSpy(`${type}-spy`), {
    namespace: 'test',
    label: `${type} spy`,
    category: 'view',
  });
}

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

const VIEWS: Record<string, Record<string, unknown>> = {
  calendar: { calendar: { startDateField: 'start_date', titleField: 'name' } },
  gantt: { gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' } },
  kanban: { kanban: { groupByField: 'name' } },
  grid: {},
};

/** Mount ListView on one view type and return the node its child was handed. */
async function childNode(viewType: string, onRowClick?: (record: unknown, event?: unknown) => void) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: 'crm_leave_request', viewType, columns: ['name'], ...VIEWS[viewType] } as never}
        dataSource={dataSource}
        onRowClick={onRowClick}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1];
}

beforeEach(() => {
  captured = [];
});
afterEach(cleanup);

describe('ListView hands the calendar and the gantt its router only under a host handler (objectstack#27057)', () => {
  for (const viewType of ['calendar', 'gantt']) {
    it(`${viewType}: under a host handler the node carries the router, and it reaches the host`, async () => {
      const host = vi.fn();
      const node = await childNode(viewType, host);

      expect(node.testid).toBe(`object-${viewType}-spy`);
      expect(typeof node.schema.onRowClick).toBe('function');
      node.schema.onRowClick(rows[0], { metaKey: false });
      expect(host).toHaveBeenCalledWith(rows[0], { metaKey: false });
    });

    it(`${viewType}: with no host handler the node carries no router, so the view keeps its drawer`, async () => {
      const node = await childNode(viewType);

      expect(node.testid).toBe(`object-${viewType}-spy`);
      expect(Object.keys(node.schema)).not.toContain('onRowClick');
      expect(node.onRowClick).toBeUndefined();
    });
  }

  for (const viewType of ['kanban', 'grid']) {
    it(`CONTROL: ${viewType} carries the router with or without a host handler, as before`, async () => {
      const withHost = await childNode(viewType, vi.fn());
      expect(typeof withHost.schema.onRowClick).toBe('function');
      cleanup();
      captured = [];
      const hostless = await childNode(viewType);
      expect(typeof hostless.schema.onRowClick).toBe('function');
    });
  }
});
