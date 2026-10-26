/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10250 — on the views that QUERY FOR THEMSELVES, the toolbar state
 * must reach the query the VIEW issues.
 *
 * THE DEFECT. `ListView`'s toolbar offers Filter, the `UserFilters` chips and
 * Search on every view, and its own fetch applies all three. Most views draw
 * the rows that fetch returned. Three do not:
 *
 *   - `tree`: `ObjectTree`'s object provider runs its own `find` with
 *     `$filter: schema.filter`, BEFORE it looks at the host `data`;
 *   - `chart` (the object-bound shape): `ObjectChart` reads no host rows and
 *     aggregates with `schema.filter`. Since objectui#6152 round 15 that shape
 *     is the `'unbound'` chart (a `chart` view naming no `dataset`; the legacy
 *     inline axes that used to bind it retired): `ObjectChart` refuses it on
 *     screen, and the one query it runs first still takes `schema.filter`;
 *   - `gantt`: objectui#10037 forwarded the Filter and the chips, but the
 *     Search term never reached `ObjectGantt`'s query.
 *
 * The tree and chart nodes carried only the AUTHORED `schema.filter`, and the
 * gantt node carried no term, so each control changed `ListView`'s fetch and
 * nothing drawn on screen.
 *
 * ⭐ WHY THE ASSERTIONS READ THE VIEW'S QUERY, NOT LISTVIEW'S. `ListView`'s own
 * fetch applied the toolbar state before the repair and after it, so a case
 * reading that fetch is green on defect and fix alike. Each stand-in below
 * reproduces its registered renderer's contract as far as this seam goes, and
 * its queries go to their own log, so they can never be confused with the
 * host's:
 *
 *   - `object-tree`: queries `$filter: schema.filter`, keyed on the IDENTITY of
 *     `schema.filter` and of the host `data` — `ObjectTree`'s record effect
 *     lists both;
 *   - `object-chart`: aggregates with `schema.filter`, keyed on its SERIALISED
 *     value — `ObjectChart`'s `filterKey`;
 *   - `object-gantt`: takes NOTHING but `schema` (the registered wrapper drops
 *     host props) and queries `$filter` / `$search` / `$searchFields` from
 *     `schema.filter` / `schema.search` / `schema.searchableFields`, keyed on
 *     the filter's identity, the term, and the field list's serialised value —
 *     `ObjectGantt.reload`'s list. `ObjectGantt` sending the pair is pinned one
 *     package over, in `plugin-gantt/src/ObjectGantt.searchTerm-10250.test.tsx`.
 *
 * REVERSE VERIFICATION. Put `filter: schema.filter` back on the tree node: the
 * tree FORWARDS and CHANGE cases go red, and so does its STABILITY case, whose
 * precondition waits for the forwarded condition; CONTROL stays green. The same
 * for the chart node. Delete the gantt node's `search` spread: the gantt
 * FORWARDS and SEARCHABLE FIELDS cases go red, and so do CLEARED and
 * STABILITY, whose preconditions wait for the forwarded term; CONTROL stays
 * green. Disable the payload-keyed cache in `selfQueryFilter`: the tree's
 * STABILITY case goes red (its stand-in keys on identity); the chart's does not,
 * because `ObjectChart` keys on the serialised filter and so does its stand-in.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react';
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
    priority: { name: 'priority', type: 'text', label: 'Priority' },
    owner: { name: 'owner', type: 'text', label: 'Owner' },
    estimate: { name: 'estimate', type: 'number', label: 'Estimate' },
    parent: { name: 'parent', type: 'text', label: 'Parent' },
    visible_from: { name: 'visible_from', type: 'date', label: 'Visible From' },
    due_date: { name: 'due_date', type: 'date', label: 'Due Date' },
  },
};

/** One array for every response, so the host `data` keeps its identity. */
const rows = [
  { id: '1', subject: 'Task 1', status: 'open', priority: 'high', owner: 'ada', estimate: 3, visible_from: '2026-01-01', due_date: '2026-01-05' },
];

let treeQueries: Array<Record<string, any>> = [];
let chartQueries: Array<Record<string, any>> = [];
let ganttQueries: Array<Record<string, any>> = [];

function TreeStandIn({ schema, data }: { schema: Record<string, any>; data?: unknown }) {
  React.useEffect(() => {
    treeQueries.push({ $filter: schema.filter });
  }, [schema.filter, data]);
  return <div data-testid="tree-standin" />;
}

function ChartStandIn({ schema }: { schema: Record<string, any> }) {
  const filterKey = schema.filter ? JSON.stringify(schema.filter) : '';
  React.useEffect(() => {
    chartQueries.push({ filter: schema.filter });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised filter, as ObjectChart is
  }, [filterKey]);
  return <div data-testid="chart-standin" />;
}

function GanttStandIn({ schema }: { schema: Record<string, any> }) {
  const search: string | undefined = typeof schema.search === 'string' && schema.search !== '' ? schema.search : undefined;
  const searchFieldsKey = search && Array.isArray(schema.searchableFields) ? JSON.stringify(schema.searchableFields) : '';
  React.useEffect(() => {
    ganttQueries.push({
      $filter: schema.filter,
      ...(search ? { $search: search, ...(searchFieldsKey ? { $searchFields: JSON.parse(searchFieldsKey) } : {}) } : {}),
    });
  }, [schema.filter, search, searchFieldsKey]);
  return <div data-testid="gantt-standin" />;
}

for (const [type, component] of [
  ['object-tree', TreeStandIn],
  ['object-chart', ChartStandIn],
  ['object-gantt', GanttStandIn],
] as const) {
  ComponentRegistry.register(type, component as any, { namespace: 'test', label: `${type} stand-in`, category: 'view' });
}

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

const VIEWS = {
  tree: { viewType: 'tree', tree: { parentField: 'parent' } },
  // Re-spelled in objectui#6152 round 15: the legacy inline axes this carried
  // bind nothing now, so the view names no chart block (door-legal).
  chart: { viewType: 'chart' },
  gantt: { viewType: 'gantt', gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' } },
} as const;

/** The toolbar's Filter control state, restored at mount. */
const TOOLBAR_FILTERS = {
  id: 'root',
  logic: 'and' as const,
  conditions: [{ id: 'c1', field: 'status', operator: 'equals', value: 'open' }],
};

/** A `UserFilters` toggle chip, OFF at mount; clicking it adds `priority != null`. */
const TOGGLE_CHIP = { element: 'toggle', fields: [{ field: 'priority' }] };

function mount(view: keyof typeof VIEWS, extra: Record<string, any> = {}, listProps: Record<string, any> = {}) {
  const dataSource = makeDataSource();
  const schema = {
    type: 'list-view',
    objectName: 'duly_task',
    columns: ['subject'],
    filter: AUTHORED_FILTER,
    ...VIEWS[view],
    ...extra,
  };
  const ui = (className: string) => (
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema as never} dataSource={dataSource} className={className} {...listProps} />
    </SchemaRendererProvider>
  );
  const utils = render(ui('first'));
  // A re-render that changes nothing the view reads: no refetch of the host,
  // no new `data`, only a new render of `ListView` (and so a fresh
  // `buildEffectiveFilter` result).
  return { dataSource, rerenderUnrelated: (className: string) => utils.rerender(ui(className)) };
}

/** The `$filter` of every host (ListView) fetch. */
const hostFilters = (dataSource: any) => dataSource.find.mock.calls.map((c: any[]) => c[1]?.$filter);
const lastHostParams = (dataSource: any) => dataSource.find.mock.calls.at(-1)?.[1] ?? {};
const last = (log: Array<Record<string, any>>) => log[log.length - 1] ?? {};
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  treeQueries = [];
  chartQueries = [];
  ganttQueries = [];
});
afterEach(cleanup);

describe.each([
  { view: 'tree' as const, log: () => treeQueries, filterOf: (q: Record<string, any>) => q.$filter },
  { view: 'chart' as const, log: () => chartQueries, filterOf: (q: Record<string, any>) => q.filter },
])('$view view — the toolbar Filter and the chips reach the view\'s own query (objectui#10250)', ({ view, log, filterOf }) => {
  it('CONTROL: with no toolbar filter and no chip, the view queries the authored filter', async () => {
    // First, so a stand-in that never queried reads as a broken harness rather
    // than as a pass for every "carries" below.
    mount(view);
    await waitFor(() => expect(log().length).toBeGreaterThan(0));
    expect(filterOf(last(log()))).toEqual(AUTHORED_FILTER);
  });

  it('FORWARDS the toolbar Filter control: the view query carries the toolbar condition AND the authored filter', async () => {
    const { dataSource } = mount(view, {}, { initialFilters: TOOLBAR_FILTERS });
    await waitFor(() => expect(JSON.stringify(filterOf(last(log())))).toContain('"status"'));
    const query = JSON.stringify(filterOf(last(log())));
    expect(query).toContain('"open"');
    expect(query).toContain('"owner"');
    // The SAME value ListView's own fetch sends — one filter, two queries.
    await waitFor(() => expect(hostFilters(dataSource)).toContainEqual(filterOf(last(log()))));
  });

  it('CHANGE: clicking a chip after mount issues a new view query carrying the chip condition', async () => {
    const { dataSource } = mount(view, { userFilters: TOGGLE_CHIP });
    await waitFor(() => expect(log().length).toBeGreaterThan(0));
    await settle();
    expect(JSON.stringify(filterOf(last(log())))).not.toContain('"priority"');
    const before = log().length;

    fireEvent.click(screen.getByTestId('filter-toggle-priority'));

    await waitFor(() => expect(JSON.stringify(filterOf(last(log())))).toContain('"priority"'));
    expect(log().length).toBeGreaterThan(before);
    expect(JSON.stringify(filterOf(last(log())))).toContain('"owner"');
    await waitFor(() => expect(hostFilters(dataSource)).toContainEqual(filterOf(last(log()))));
  });

  it('STABILITY: an unchanged effective filter does not re-query the view when ListView re-renders', async () => {
    // The toolbar condition makes the effective filter an `['and', …]` that
    // `buildEffectiveFilter` builds fresh on every call — the case the
    // payload-keyed cache exists for.
    const { rerenderUnrelated } = mount(view, {}, { initialFilters: TOOLBAR_FILTERS });
    await waitFor(() => expect(JSON.stringify(filterOf(last(log())))).toContain('"status"'));
    await settle();
    const settled = log().length;
    rerenderUnrelated('second');
    rerenderUnrelated('third');
    await settle();
    expect(log().length).toBe(settled);
  });
});

describe('gantt view — the toolbar Search reaches the chart query (objectui#10250)', () => {
  const typeSearch = (value: string) => {
    if (!screen.queryByPlaceholderText(/search/i)) fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value } });
  };

  it('CONTROL: with no term, the chart query carries no $search', async () => {
    mount('gantt');
    await waitFor(() => expect(ganttQueries.length).toBeGreaterThan(0));
    await settle();
    expect(last(ganttQueries)).not.toHaveProperty('$search');
  });

  it('FORWARDS the term typed into the toolbar Search box: the chart query carries the same $search as the host fetch', async () => {
    const { dataSource } = mount('gantt');
    await waitFor(() => expect(ganttQueries.length).toBeGreaterThan(0));
    typeSearch('needle');
    await waitFor(() => expect(last(ganttQueries).$search).toBe('needle'));
    await waitFor(() => expect(lastHostParams(dataSource).$search).toBe('needle'));
    // The filter door is unchanged by the second key on the node.
    expect(last(ganttQueries).$filter).toEqual(AUTHORED_FILTER);
    expect(last(ganttQueries)).not.toHaveProperty('$searchFields');
  });

  it('SEARCHABLE FIELDS ride with the term, exactly as they ride with the host fetch', async () => {
    const { dataSource } = mount('gantt', { searchableFields: ['subject'] });
    await waitFor(() => expect(ganttQueries.length).toBeGreaterThan(0));
    // No term, no field list: the pair travels together or not at all.
    expect(last(ganttQueries)).not.toHaveProperty('$searchFields');
    typeSearch('needle');
    await waitFor(() => expect(last(ganttQueries).$searchFields).toEqual(['subject']));
    await waitFor(() => expect(lastHostParams(dataSource).$searchFields).toEqual(['subject']));
  });

  it('CLEARED: removing the term issues a chart query without $search', async () => {
    mount('gantt');
    await waitFor(() => expect(ganttQueries.length).toBeGreaterThan(0));
    typeSearch('needle');
    await waitFor(() => expect(last(ganttQueries).$search).toBe('needle'));
    typeSearch('');
    await waitFor(() => expect(last(ganttQueries)).not.toHaveProperty('$search'));
  });

  it('STABILITY: an unchanged term does not re-query the chart when ListView re-renders', async () => {
    const { rerenderUnrelated } = mount('gantt', { searchableFields: ['subject'] });
    await waitFor(() => expect(ganttQueries.length).toBeGreaterThan(0));
    typeSearch('needle');
    await waitFor(() => expect(last(ganttQueries).$search).toBe('needle'));
    await settle();
    const settled = ganttQueries.length;
    rerenderUnrelated('second');
    rerenderUnrelated('third');
    await settle();
    expect(ganttQueries.length).toBe(settled);
  });
});
