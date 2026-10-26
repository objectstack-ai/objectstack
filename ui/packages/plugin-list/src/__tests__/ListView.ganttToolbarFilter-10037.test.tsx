/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10037 — on a `gantt` view the toolbar's Filter control and the
 * `UserFilters` chips must reach the query the CHART issues.
 *
 * THE DEFECT. Every other view draws the rows `ListView` fetched, and that
 * fetch applies `buildEffectiveFilter(schema.filter, currentFilters,
 * userFilterConditions)`. The registered `object-gantt` renderer forwards no
 * host prop and runs its OWN query, `$filter: schema.filter`
 * (`ObjectGantt.reload`; the no-host-prop half is pinned in
 * `plugin-gantt/src/ObjectGantt.hostDataProp-7210.test.tsx`). The gantt node
 * carried only the AUTHORED `schema.filter`, so both controls changed
 * `ListView`'s fetch and nothing drawn on screen.
 *
 * ⭐ WHY THE ASSERTIONS READ THE CHART'S QUERY, NOT LISTVIEW'S. `ListView`'s
 * own fetch applied the toolbar filter before the repair and after it, so a
 * case reading that fetch is green on defect and fix alike. The stand-in below
 * reproduces the registered renderer's contract exactly as far as this seam
 * goes: it takes NOTHING but `schema` (host props are dropped, as the real
 * `ObjectGanttRenderer` drops them) and queries `$filter: schema.filter`,
 * keyed on `schema.filter` the way `ObjectGantt`'s reload effect is. Its
 * queries go to their own spy, so they can never be confused with the host's.
 *
 * REVERSE VERIFICATION. Delete the `filter: selfQueryFilter` line from the
 * gantt branch (the node falls back to `baseProps`' authored filter): both
 * FORWARDS cases go red, and so does STABILITY, whose precondition waits for
 * the forwarded toolbar condition; the CONTROL stays green. Disable the
 * payload-keyed cache in `selfQueryFilter`: STABILITY alone goes red (the
 * chart re-queries an unchanged filter on every re-render).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const objectDef = {
  name: 'duly_task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: { name: 'status', type: 'text', label: 'Status' },
    priority: {
      name: 'priority',
      type: 'select',
      label: 'Priority',
      options: [
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
      ],
    },
    owner: { name: 'owner', type: 'text', label: 'Owner' },
    visible_from: { name: 'visible_from', type: 'date', label: 'Visible From' },
    due_date: { name: 'due_date', type: 'date', label: 'Due Date' },
  },
};

const rows = [
  { id: '1', subject: 'Task 1', status: 'open', priority: 'high', owner: 'ada', visible_from: '2026-01-01', due_date: '2026-01-05' },
];

/** Every query the CHART stand-in issued, in order. */
let chartQueries: Array<Record<string, any>> = [];

/**
 * The `object-gantt` stand-in. `{ schema }` only — ⛔ no host prop is read,
 * which is the registered renderer's contract and the whole reason the node's
 * `filter` is the chart's only door.
 */
function GanttChartStandIn({ schema }: { schema: Record<string, any> }) {
  React.useEffect(() => {
    chartQueries.push({ $filter: schema.filter });
  }, [schema.filter]);
  return <div data-testid="gantt-chart-standin" />;
}

ComponentRegistry.register('object-gantt', GanttChartStandIn as any, {
  namespace: 'test',
  label: 'object-gantt stand-in',
  category: 'view',
});

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as any;
}

const AUTHORED_FILTER = [['owner', '=', 'ada']];

const BASE = {
  type: 'list-view',
  objectName: 'duly_task',
  viewType: 'gantt',
  columns: ['subject'],
  filter: AUTHORED_FILTER,
  gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
} as const;

/** The toolbar's Filter control state, restored at mount. */
const TOOLBAR_FILTERS = {
  id: 'root',
  logic: 'and' as const,
  conditions: [{ id: 'c1', field: 'status', operator: 'equals', value: 'open' }],
};

/** A `UserFilters` dropdown chip on `priority`, restored at mount. */
const CHIP_CONFIG = { element: 'dropdown', fields: [{ field: 'priority' }] };
const CHIP_SELECTIONS = { priority: ['high'] };

function mount(extra: Record<string, any> = {}, listProps: Record<string, any> = {}) {
  const dataSource = makeDataSource();
  const schema = { ...BASE, ...extra };
  const ui = (s: Record<string, any>) => (
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={s as never} dataSource={dataSource} {...listProps} />
    </SchemaRendererProvider>
  );
  const utils = render(ui(schema));
  return { dataSource, rerender: (s: Record<string, any>) => utils.rerender(ui(s)), schema };
}

/** The `$filter` of ListView's OWN (host) fetch, the shared effective value. */
const hostFilters = (dataSource: any) =>
  dataSource.find.mock.calls.map((c: any[]) => c[1]?.$filter);

const lastChartFilter = () => chartQueries[chartQueries.length - 1]?.$filter;

beforeEach(() => {
  chartQueries = [];
});
afterEach(cleanup);

describe('gantt view — the toolbar filter reaches the chart query (objectui#10037)', () => {
  it('CONTROL: with no toolbar filter and no chip, the chart queries the authored filter', async () => {
    // The positive control comes first: a harness whose stand-in never queried
    // would make every "does not contain" below meaningless rather than red.
    mount();
    await waitFor(() => expect(chartQueries.length).toBeGreaterThan(0));
    expect(lastChartFilter()).toEqual(AUTHORED_FILTER);
  });

  it('FORWARDS the toolbar Filter control: the chart query carries the toolbar condition AND the authored filter', async () => {
    const { dataSource } = mount({}, { initialFilters: TOOLBAR_FILTERS });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await waitFor(() => expect(JSON.stringify(lastChartFilter())).toContain('"status"'));
    const chart = JSON.stringify(lastChartFilter());
    expect(chart).toContain('"open"');
    expect(chart).toContain('"owner"');
    // The SAME value ListView's own fetch sends — one filter, two queries.
    expect(hostFilters(dataSource)).toContainEqual(lastChartFilter());
  });

  it('FORWARDS a UserFilters chip: the chart query carries the chip condition too', async () => {
    const { dataSource } = mount(
      { userFilters: CHIP_CONFIG },
      { initialFilters: TOOLBAR_FILTERS, userFilterSelections: CHIP_SELECTIONS },
    );
    await waitFor(() => expect(JSON.stringify(lastChartFilter())).toContain('"priority"'));
    const chart = JSON.stringify(lastChartFilter());
    expect(chart).toContain('"high"');
    expect(chart).toContain('"status"');
    expect(chart).toContain('"owner"');
    await waitFor(() => expect(hostFilters(dataSource)).toContainEqual(lastChartFilter()));
  });

  it('STABILITY: an unchanged effective filter does not re-query the chart when ListView re-renders', async () => {
    // `ObjectGantt`'s reload effect keys on `schema.filter`, so a fresh array
    // for the same filter is a refetch. The toolbar condition makes the
    // effective filter an `['and', …]` built fresh on every call — exactly
    // the case the payload-keyed cache exists for.
    const { rerender, schema } = mount({}, { initialFilters: TOOLBAR_FILTERS });
    await waitFor(() => expect(JSON.stringify(lastChartFilter())).toContain('"status"'));
    const settled = chartQueries.length;
    // A new-but-equal schema object: every memo keyed on `schema` recomputes.
    rerender({ ...schema, filter: [['owner', '=', 'ada']] });
    rerender({ ...schema, filter: [['owner', '=', 'ada']] });
    await new Promise((r) => setTimeout(r, 50));
    expect(chartQueries.length).toBe(settled);
  });
});
