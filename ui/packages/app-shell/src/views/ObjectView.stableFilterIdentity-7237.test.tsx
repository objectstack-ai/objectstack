/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7237 (the C half) — the object page handed `ListView` a NEW filter
 * array of identical content on every re-render.
 *
 * ## The defect this pins
 *
 * `renderListView` resolves the view's filter through `substituteFilterTokens`
 * (`resolveFilterPlaceholders`), which returns a fresh array even when nothing
 * was substituted. `ListView` names `schema.filter` BY IDENTITY in its fetch
 * effect, so every host re-render that changed nothing re-issued the identical
 * list query — for any view that declares a filter. Same class and same
 * producer-side fix as objectui#10046 (`options`), through the same value
 * comparison (`isSameOptionsValue`) and the same component-level ref.
 *
 * ## The gantt node seam, measured rather than assumed
 *
 * The card's census measured 2 filter identities against 1 sort identity at
 * the gantt node. On the tree this fix was written against that reading is
 * already 1 against 1 in BOTH worlds: `ListView`'s `selfQueryFilter` hold
 * (objectui#10037) re-derives the node's filter and keeps its identity while
 * the serialised value is unchanged, so the producer's churn stops one layer
 * above the chart. The node-seam case below is therefore a regression pin that
 * is green on the defect too, and it says so; the cases that can fail on the
 * defect are the list-query counts.
 *
 * ## Why everything here is real
 *
 * The page, `plugin-view`'s `ObjectView` and `plugin-list`'s `ListView` render
 * for real; only the `object-gantt` renderer is a recording stand-in, so the
 * node `ListView` builds is observed exactly as the chart would receive it.
 * The host re-render is FORCED (a parent state bump).
 *
 * ## Direction, written before the reverse run
 *
 * Reverting the producer hold is predicted to turn the two FIX cases RED (each
 * bare re-render re-issues one list query; mount issues two where one is
 * asserted) and to leave the node-seam pin and the real-change control green.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // STABLE identities, on purpose: `ListView` names `perms` in the same fetch
  // dependency list, so a fresh object per call would measure the mock.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

/**
 * Shared across fixtures, so swapping the object definition in the
 * real-change control moves the FILTER and nothing else `ListView` names by
 * identity.
 */
const COLUMNS = ['name', 'stage'];
const SORT = [{ field: 'name', order: 'asc' }];
const GANTT = { startDateField: 'start', endDateField: 'end' };

function objectsWith(filter: unknown, type: 'gantt' | 'grid') {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'select', label: 'Stage', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
        start: { type: 'date', label: 'Start' },
        end: { type: 'date', label: 'End' },
      },
      listViews: {
        all: { label: 'All', type, columns: COLUMNS, sort: SORT, filter, gantt: GANTT },
      },
    },
  ];
}

/** What the gantt node carried, across every render of the chart. */
const node = {
  filters: new Set<unknown>(),
  sorts: new Set<unknown>(),
  renders: 0,
  lastFilter: undefined as unknown,
};

function GanttRecorder({ schema }: { schema: { filter?: unknown; sort?: unknown } }) {
  node.renders++;
  node.filters.add(schema.filter);
  node.sorts.add(schema.sort);
  node.lastFilter = schema.filter;
  return <div data-testid="gantt-recorder" />;
}

/** The list queries `ListView` issued; the page's `$top: 0` count probe is excluded. */
let listQueries = 0;
function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      if (params?.$top !== 0) listQueries++;
      return { data: [], total: 0 };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

async function mountHost(filter: unknown, type: 'gantt' | 'grid') {
  const dataSource = makeDataSource();
  let bump: () => void = () => {};
  let swap: (objects: any[]) => void = () => {};
  function Harness() {
    const [, setTick] = React.useState(0);
    const [objects, setObjects] = React.useState<any[]>(() => objectsWith(filter, type));
    // Handles are published from an effect, not during render
    // (react-hooks/globals); both setters are stable, so one publish holds.
    React.useEffect(() => {
      bump = () => setTick((n) => n + 1);
      swap = setObjects;
    }, []);
    // A FRESH element every Harness render, so a bump re-renders the page.
    const page = <ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />;
    return (
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/all`]}>
          <Routes>
            <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    );
  }
  render(<Harness />);
  await settle();
  return {
    rerender: async () => {
      await act(async () => bump());
      await settle();
    },
    setObjects: async (objects: any[]) => {
      await act(async () => swap(objects));
      await settle();
    },
  };
}

beforeEach(() => {
  cleanup();
  listQueries = 0;
  node.filters = new Set();
  node.sorts = new Set();
  node.renders = 0;
  node.lastFilter = undefined;
  ComponentRegistry.register('object-gantt', GanttRecorder as any);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const FILTER = [['stage', '=', 'a']];

describe('ObjectView keeps the resolved filter identity while its content is unchanged (objectui#7237)', () => {
  it('THE FIX: a gantt view with a declared filter settles on ONE list query, and bare host re-renders issue none', async () => {
    const host = await mountHost(FILTER, 'gantt');
    expect(node.renders).toBeGreaterThan(0);
    expect(listQueries).toBe(1);
    await host.rerender();
    await host.rerender();
    expect(listQueries).toBe(1);
  });

  it('THE FIX: a grid view with a declared filter re-issues no list query on a bare host re-render', async () => {
    const host = await mountHost(FILTER, 'grid');
    const before = listQueries;
    await host.rerender();
    await host.rerender();
    expect(listQueries - before).toBe(0);
  });

  it('THE NODE SEAM: across host re-renders the gantt node sees ONE filter identity, with sort as the control', async () => {
    // Green on the defect as well — see "The gantt node seam" in the header.
    const host = await mountHost(FILTER, 'gantt');
    await host.rerender();
    await host.rerender();
    expect(node.renders).toBeGreaterThan(1);
    expect(node.sorts.size).toBe(1);
    expect(node.filters.size).toBe(1);
  });

  it('CONTROL: a REAL filter change still reaches the gantt node as a new identity and still refetches', async () => {
    // The other direction: equal content keeps identity, a changed value must
    // never be withheld. A hold that kept the old value whatever arrived turns
    // this red.
    const host = await mountHost(FILTER, 'gantt');
    const before = listQueries;
    const first = node.lastFilter;
    await host.setObjects(objectsWith([['stage', '=', 'b']], 'gantt'));
    expect(node.lastFilter).not.toBe(first);
    expect(JSON.stringify(node.lastFilter)).toContain('"b"');
    expect(node.filters.size).toBe(2);
    expect(node.sorts.size).toBe(1);
    expect(listQueries - before).toBeGreaterThanOrEqual(1);
  });
});
