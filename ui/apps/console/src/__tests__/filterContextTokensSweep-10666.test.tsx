/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10666 — the family closure pin: EVERY data node that sends its own
 * authored `filter` into a data-source query resolves the spec's context
 * tokens (`{current_user_id}`, `{current_org_id}`) first, through
 * `@object-ui/core`'s ONE shared `resolveFilterPlaceholders`, against the
 * session scope the host provides (`FilterScopeProvider` / `useFilterScope`),
 * and HOLDS the resolved value so that no query fires again on a re-render.
 *
 * One enumeration table, one row per node (and per query path where a node
 * has two). Each row renders the node DIRECTLY AUTHORED, through the real
 * `SchemaRenderer` and the node's own package registration, under a
 * `FilterScopeProvider`, over a data source that records every query it is
 * asked. The inline (`provider: 'value'`) paths query a `ValueDataSource`
 * built inside the node, so those rows record its `find` instead.
 *
 * The four cells per row:
 * - `{current_user_id}` goes out as the signed-in user id;
 * - `{current_org_id}` goes out as the active organization id;
 * - a token-free filter goes out unchanged: the query equals, member for
 *   member, the one the same node sends for the literal filter;
 * - re-renders that rebuild an equal (token-carrying) filter add no query.
 *
 * `object-grid`, `list-view` and `object-gallery` are regression rows: they
 * were fixed by objectui#10607 and by the first half of objectui#10666, and
 * their own pins live in their packages.
 *
 * ## Why this file lives in `apps/console`
 *
 * It renders nodes from nine packages in one table, so it must live in a
 * package that declares all of them (the objectui#4409 dependency-direction
 * method). `app-shell` lacks `plugin-gantt`, `plugin-map`, `plugin-timeline`
 * and `plugin-tree`; this app declares every one.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No WebGL in the test env: the stub the `plugin-map` tests use, under the
// same bare specifier `ObjectMap` imports. Vitest keys a mock on the RESOLVED
// module id, so the specifier has to resolve from this file to the very file
// `plugin-map`'s import resolves to. This app therefore declares `react-map-gl`
// as a devDependency at `plugin-map`'s own range: pnpm links both packages to
// one store instance (the optional `maplibre-gl` peer is deduplicated), and the
// two resolutions meet on one real path.
//
// objectui#10731: the previous spelling reached into
// `packages/plugin-map/node_modules/...` by relative path. That file exists
// only after `pnpm install`, so the pre-install `Inert vi.mock Specifier Check`
// read it as a mock that resolves to no file, and `main` went red. A bare
// specifier is outside that gate's scope (objectui#5646) and resolves through
// the package map, which is what this mock needs.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: { children?: React.ReactNode }) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-testid="map-popup">{children}</div>,
}));
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry, ValueDataSource } from '@object-ui/core';
import {
  AdapterCtx,
  FilterScopeProvider,
  RecordContextProvider,
  SchemaRenderer,
  SchemaRendererProvider,
} from '@object-ui/react';
// Each import registers its package's nodes, the way the console loads them.
import '@object-ui/components';
import '@object-ui/plugin-calendar';
import '@object-ui/plugin-detail';
import '@object-ui/plugin-form';
import '@object-ui/plugin-gantt';
import '@object-ui/plugin-grid';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-list';
import '@object-ui/plugin-map';
import '@object-ui/plugin-timeline';
import '@object-ui/plugin-tree';

const USER = 'usr_42';
const ORG = 'org_7';
const OBJECT = 'task';

const ROW = {
  id: '1',
  name: 'Acme',
  owner: USER,
  org: ORG,
  status: 'open',
  parent_id: null,
  account_id: 'ACC-1',
  invoice: 'inv-1',
  starts_at: '2026-09-01T09:00:00Z',
  ends_at: '2026-09-01T10:00:00Z',
  start: '2026-09-01',
  end: '2026-09-02',
  due: '2026-09-01',
  lat: 10,
  lng: 20,
};

const OBJECT_SCHEMA = {
  name: OBJECT,
  fields: {
    name: { type: 'text' },
    owner: { type: 'text' },
    org: { type: 'text' },
    status: { type: 'text' },
    parent_id: { type: 'text' },
    account_id: { type: 'text' },
    invoice: { type: 'text' },
    starts_at: { type: 'datetime' },
    ends_at: { type: 'datetime' },
    start: { type: 'date' },
    end: { type: 'date' },
    due: { type: 'date' },
    lat: { type: 'number' },
    lng: { type: 'number' },
  },
};

/** One query the node issued: which call, and its whole parameter object. */
interface Query {
  via: 'find' | 'aggregate' | 'inline';
  params: Record<string, unknown>;
}

/** A data source (and adapter) that records every query against `OBJECT`. */
function makeDataSource(opts: { aggregate: boolean }) {
  const queries: Query[] = [];
  const ds: Record<string, unknown> = {
    queries,
    find: vi.fn(async (object: string, params?: Record<string, unknown>) => {
      if (object === OBJECT) queries.push({ via: 'find', params: params ?? {} });
      return { data: [{ ...ROW }], total: 1 };
    }),
    findOne: vi.fn(async () => ({ ...ROW })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: vi.fn(async () => ({ data: [] })),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  };
  if (opts.aggregate) {
    ds.aggregate = vi.fn(async (object: string, params?: Record<string, unknown>) => {
      if (object === OBJECT) queries.push({ via: 'aggregate', params: params ?? {} });
      return [{ count: 1 }];
    });
  }
  return ds as Record<string, unknown> & { queries: Query[] };
}

type Filter = unknown;
type FilterShape = 'tuple' | 'rule';

/** The filter in the member shape the node's contract takes. */
function filterFor(shape: FilterShape, field: string, value: string): Filter {
  return shape === 'tuple' ? [[field, '=', value]] : [{ field, operator: 'equals', value }];
}

interface NodeRow {
  /** Row label: the node type, and the query path where a node has two. */
  node: string;
  shape: FilterShape;
  /** The node schema carrying `filter` where this node reads it. */
  withFilter: (filter: Filter) => Record<string, unknown>;
  /** Where the node's query is recorded. */
  path: 'dataSource' | 'inline';
  /** `element:number` aggregates when the adapter can; `false` forces the `find` fallback. */
  aggregate?: boolean;
  /** Mounted under a record (the parent a related list scopes to). */
  record?: boolean;
  /** Stub the child grid a `list-view` renders, so only the list's own query counts. */
  stubChildGrid?: boolean;
  /** Which recorded parameter carries the filter. */
  filterParam: '$filter' | 'filter';
}

const top = (base: Record<string, unknown>) => (filter: Filter) => ({ ...base, filter });
// `element:number`, `element:record_picker` and `element:repeater` read their
// query from the node-level `dataSource` binding only (objectui#11880,
// objectui#12345), so the filter and the object ride there.
const bound = (base: { type: string; id: string; properties: Record<string, unknown> }) => (filter: Filter) => ({
  ...base,
  dataSource: { object: OBJECT, filter },
});

const INLINE = { provider: 'value', items: [{ ...ROW }] };

const CALENDAR = { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' };
const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' };

// ⭐ The enumeration. Every census node is a row; the three regression rows
// close the table.
const ROWS: NodeRow[] = [
  { node: 'object-calendar (object)', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-calendar', objectName: OBJECT, calendar: CALENDAR }) },
  { node: 'object-calendar (inline)', shape: 'tuple', path: 'inline', filterParam: '$filter',
    // `staticData` is the rung that wraps into `{ provider: 'value', items }` on
    // this block (objectui#8348); its `data` row is the array arm.
    withFilter: top({ type: 'object-calendar', calendar: CALENDAR, staticData: [{ ...ROW }] }) },
  { node: 'object-gantt', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-gantt', objectName: OBJECT, titleField: 'name', startDateField: 'start', endDateField: 'end' }) },
  { node: 'object-kanban', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-kanban', objectName: OBJECT, groupBy: 'status', columns: [{ id: 'open', title: 'Open' }] }) },
  { node: 'object-map (object)', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-map', objectName: OBJECT, map: MAP }) },
  { node: 'object-map (inline)', shape: 'tuple', path: 'inline', filterParam: '$filter',
    withFilter: top({ type: 'object-map', map: MAP, data: INLINE }) },
  { node: 'object-timeline', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-timeline', objectName: OBJECT, timeline: { titleField: 'name', startDateField: 'due' } }) },
  { node: 'object-tree (object)', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-tree', objectName: OBJECT, parentField: 'parent_id', labelField: 'name' }) },
  { node: 'object-tree (inline)', shape: 'tuple', path: 'inline', filterParam: '$filter',
    withFilter: top({ type: 'object-tree', parentField: 'parent_id', labelField: 'name', data: INLINE }) },
  { node: 'record:related_list', shape: 'rule', path: 'dataSource', filterParam: '$filter', record: true,
    withFilter: top({ type: 'record:related_list', objectName: OBJECT, relationshipField: 'account_id', columns: ['name'] }) },
  { node: 'record:line_items', shape: 'rule', path: 'dataSource', filterParam: '$filter',
    withFilter: top({
      type: 'record:line_items', childObject: OBJECT, relationshipField: 'invoice', parentId: 'inv-1',
      columns: [{ name: 'name', label: 'Name', type: 'text' }],
    }) },
  { node: 'element:repeater', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: bound({ type: 'element:repeater', id: 'rep', properties: { fields: ['name'] } }) },
  { node: 'element:number (aggregate)', shape: 'tuple', path: 'dataSource', filterParam: 'filter', aggregate: true,
    withFilter: bound({ type: 'element:number', id: 'num', properties: { aggregate: 'count' } }) },
  { node: 'element:number (find fallback)', shape: 'tuple', path: 'dataSource', filterParam: '$filter', aggregate: false,
    withFilter: bound({ type: 'element:number', id: 'num', properties: { aggregate: 'count' } }) },
  { node: 'element:record_picker', shape: 'rule', path: 'dataSource', filterParam: '$filter',
    withFilter: bound({ type: 'element:record_picker', id: 'rp', properties: {} }) },
  // Regression rows (objectui#10607, objectui#10666 part 1).
  { node: 'object-gallery (regression)', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-gallery', objectName: OBJECT, gallery: { titleField: 'name' } }) },
  { node: 'object-grid (regression)', shape: 'tuple', path: 'dataSource', filterParam: '$filter',
    withFilter: top({ type: 'object-grid', objectName: OBJECT, columns: ['name'] }) },
  { node: 'list-view (regression)', shape: 'tuple', path: 'dataSource', filterParam: '$filter', stubChildGrid: true,
    withFilter: top({ type: 'list-view', data: { provider: 'object', object: OBJECT }, columns: ['name'] }) },
];

type DS = ReturnType<typeof makeDataSource>;

interface HostHandle {
  rerender: () => void;
}

/**
 * Mounts one node. Every render builds the filter afresh from `makeFilter`,
 * so a re-render hands the node an EQUAL filter at a NEW identity; the rest of
 * the schema is rebuilt around it the same way on every pass.
 */
const Host = React.forwardRef<HostHandle, { row: NodeRow; ds: DS; makeFilter: () => Filter }>(
  function Host({ row, ds, makeFilter }, ref) {
    const [, setPass] = React.useState(0);
    React.useImperativeHandle(ref, () => ({ rerender: () => setPass((n) => n + 1) }), []);
    const node = <SchemaRenderer schema={row.withFilter(makeFilter()) as never} />;
    return (
      <FilterScopeProvider currentUserId={USER} currentOrgId={ORG}>
        <SchemaRendererProvider dataSource={ds as never}>
          <AdapterCtx.Provider value={ds as never}>
            {row.record ? (
              <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as never}>
                {node}
              </RecordContextProvider>
            ) : node}
          </AdapterCtx.Provider>
        </SchemaRendererProvider>
      </FilterScopeProvider>
    );
  },
);

/** Let every pending effect and resolved promise land. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

let inlineQueries: Query[] = [];

/** Mount a row and wait for its first query; returns the recorder and the host handle. */
async function mount(row: NodeRow, makeFilter: () => Filter) {
  const ds = makeDataSource({ aggregate: row.aggregate !== false });
  const recorded = () => (row.path === 'inline' ? inlineQueries : ds.queries);
  const ref = React.createRef<HostHandle>();
  render(<Host ref={ref} row={row} ds={ds} makeFilter={makeFilter} />);
  await waitFor(() => expect(recorded().length, `${row.node} issued no query`).toBeGreaterThan(0));
  await settle();
  return { recorded, ref };
}

/** The filter the node sent on its first recorded query. */
function sentFilter(row: NodeRow, queries: Query[]) {
  return queries[0].params[row.filterParam];
}

const STUBBED_GRID = () => <div data-testid="child-grid-stub" />;
let restoreGrid: (() => void) | null = null;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  inlineQueries = [];
  const realFind = ValueDataSource.prototype.find;
  vi.spyOn(ValueDataSource.prototype, 'find').mockImplementation(function (this: ValueDataSource<any>, resource, params) {
    inlineQueries.push({ via: 'inline', params: (params ?? {}) as Record<string, unknown> });
    return realFind.call(this, resource, params);
  });
});

afterEach(() => {
  cleanup();
  restoreGrid?.();
  restoreGrid = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubChildGridFor(row: NodeRow) {
  if (!row.stubChildGrid) return;
  const prev = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', STUBBED_GRID);
  restoreGrid = () => {
    if (prev) ComponentRegistry.register('object-grid', prev as never);
  };
}

describe.each(ROWS)('$node — its own filter reaches the query resolved (objectui#10666)', (row) => {
  it('sends the signed-in user id for {current_user_id}, and the same query the literal id sends', async () => {
    stubChildGridFor(row);
    const token = await mount(row, () => filterFor(row.shape, 'owner', '{current_user_id}'));
    const sent = JSON.stringify(sentFilter(row, token.recorded()));
    expect(sent, `${row.node} sent the literal token`).not.toContain('{current_user_id}');
    expect(sent).toContain(USER);
    const tokenQuery = token.recorded()[0];
    cleanup();
    inlineQueries = [];

    const literal = await mount(row, () => filterFor(row.shape, 'owner', USER));
    expect(tokenQuery).toEqual(literal.recorded()[0]);
  });

  it('sends the active organization id for {current_org_id}', async () => {
    stubChildGridFor(row);
    const { recorded } = await mount(row, () => filterFor(row.shape, 'org', '{current_org_id}'));
    const sent = JSON.stringify(sentFilter(row, recorded()));
    expect(sent, `${row.node} sent the literal token`).not.toContain('{current_org_id}');
    expect(sent).toContain(ORG);
  });

  it('CONTROL: a token-free filter reaches the query unchanged', async () => {
    stubChildGridFor(row);
    const authored = filterFor(row.shape, 'owner', 'usr_literal');
    const { recorded } = await mount(row, () => filterFor(row.shape, 'owner', 'usr_literal'));
    const sent = sentFilter(row, recorded());
    if (row.shape === 'tuple') {
      // A pass-through node: the members go out as authored.
      expect(sent).toEqual(authored);
    } else {
      // A node that composes its own filter with the parent scope, or lowers
      // rule objects first: the authored condition is inside what it sends.
      expect(JSON.stringify(sent)).toContain('"usr_literal"');
      expect(JSON.stringify(sent)).toContain('"owner"');
    }
  });

  it('re-renders that rebuild an equal filter add no query', async () => {
    stubChildGridFor(row);
    const { recorded, ref } = await mount(row, () => filterFor(row.shape, 'owner', '{current_user_id}'));
    const before = recorded().length;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        ref.current!.rerender();
      });
      await settle();
    }
    expect(recorded().length, `${row.node} re-queried on a re-render that changed nothing`).toBe(before);
  });
});
