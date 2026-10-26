/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11013 — the relays of a stored view read it by the spec's declared
 * spellings, and drop the reads nothing writes (ruling 甲 on
 * objectstack#20051, stage ii).
 *
 * ## What changed, and what each case measures
 *
 * Both relays of a view into the `list-view` node — `plugin-view`'s
 * `renderListView` composition (HOST 1) and the object page's relay over it
 * (HOST 2) — read nine keys off the view that no producer writes:
 * `allowExport` and the renderer flags `wrapHeaders`,
 * `clickIntoRecordDetails`, `addRecordViaForm`, `addDeleteRecordsInline`,
 * `collapseAllByDefault`, `fieldTextColor`, `prefixField` (both hosts), and
 * `editRecordsInline` as a second spelling of `inlineEdit` (HOST 2). The
 * producer census on the card found no console surface and no authored view
 * writing any of them, and the spec's view schema refuses each by name. So a
 * view carrying one of them now hands `ListView` nothing for it:
 *
 *   - THE CHANGE cases put every one of the nine on the view and read what
 *     `ListView` is handed.
 *   - The CONTROL cases put the node's own value on the object-view node (the
 *     objectui#5097 host-composition read, which stays) and a relayed neighbour
 *     on the same view, so an absence below is a reading and not a relay that
 *     stopped running.
 *
 * The toolbar policy is read as `userActions.search` / `.sort` / `.filter`,
 * the declared spelling, where the bare `showSearch` / `showSort` /
 * `showFilters` flags used to be read off the view: on the object page's
 * `object-view` node, and on `plugin-view`'s non-grid route. A view that still
 * carries a bare flag is folded onto `userActions` by `normalizeListViewSchema`,
 * so it keeps its answer.
 *
 * ## Direction, written before the reverse-verification run
 *
 * Restoring the dropped view reads is PREDICTED to turn the `THE CHANGE` and
 * `DECLARED SPELLING` cases red and to leave every `CONTROL` and `SAME ANSWER`
 * case green.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
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
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
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

/** The list schema the object page hands down — captured, not rendered. */
let captured: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    captured = props.schema;
    return null;
  },
}));

/** The `object-view` node the object page builds for the real plugin view. */
let objectViewNode: any = null;
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-view')>();
  const Real = actual.ObjectView as React.ComponentType<any>;
  return {
    ...actual,
    ObjectView: (props: any) => {
      objectViewNode = props.schema;
      return <Real {...props} />;
    },
  };
});

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

/** The eight keys both hosts read off a view until objectui#11013, each with a value it would carry. */
const DROPPED = {
  allowExport: false,
  wrapHeaders: true,
  clickIntoRecordDetails: false,
  addRecordViaForm: true,
  addDeleteRecordsInline: true,
  collapseAllByDefault: true,
  fieldTextColor: 'name',
  prefixField: 'name',
} as const;

function objectsWith(view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'text', label: 'Stage' },
      },
      listViews: {
        probe: { label: 'Probe', type: 'grid', columns: ['name'], ...view },
      },
    },
  ];
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** HOST 2 — the object page over the real plugin-view: the schema `ListView` receives. */
async function objectPageSchema(view: Record<string, unknown>): Promise<any> {
  captured = null;
  objectViewNode = null;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={makeDataSource()} objects={objectsWith(view)} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  // `options` is written by the relay literal unconditionally, so its arrival
  // is the signal the relay ran.
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
  return captured;
}

/** HOST 1 — plugin-view's `renderListView` composition, as a third-party host receives it. */
function pluginViewSchema(view: Record<string, unknown>, node: Record<string, unknown> = {}): any {
  let handed: any = null;
  const renderListView = vi.fn(({ schema }: any) => {
    handed = schema;
    return null;
  });
  render(
    <PluginObjectView
      schema={{ type: 'object-view', objectName: OBJECT_NAME, ...node } as any}
      dataSource={makeDataSource()}
      views={[{ id: 'probe', label: 'Probe', type: 'grid', columns: ['name'], ...view }]}
      activeViewId="probe"
      renderListView={renderListView}
    />,
  );
  expect(renderListView).toHaveBeenCalled();
  return handed;
}

/** `plugin-view`'s non-grid route: the kanban node it hands the registry. */
let kanbanNode: any = null;
let prevKanban: unknown;
beforeAll(() => {
  prevKanban = ComponentRegistry.get('object-kanban');
  ComponentRegistry.register('object-kanban', ((props: { schema?: unknown }) => {
    kanbanNode = props.schema;
    return null;
  }) as never);
});
afterAll(() => {
  if (prevKanban) ComponentRegistry.register('object-kanban', prevKanban as never);
  else ComponentRegistry.unregister('object-kanban');
});

async function kanbanRouteNode(view: Record<string, unknown>, node: Record<string, unknown> = {}): Promise<any> {
  kanbanNode = null;
  render(
    <PluginObjectView
      schema={{ type: 'object-view', objectName: OBJECT_NAME, ...node } as any}
      dataSource={makeDataSource()}
      views={[{ id: 'board', label: 'Board', type: 'kanban', kanban: { groupByField: 'stage' }, ...view }]}
      activeViewId="board"
    />,
  );
  await waitFor(() => expect(kanbanNode).toBeTruthy());
  return kanbanNode;
}

beforeEach(() => {
  cleanup();
  captured = null;
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

describe('objectui#11013 — HOST 1: the plugin-view composition drops the view reads nothing writes', () => {
  it('THE CHANGE: none of the eight reaches `ListView` from the view', () => {
    const schema = pluginViewSchema({ ...DROPPED, exportOptions: { formats: ['csv'] } });
    for (const key of Object.keys(DROPPED)) {
      expect(schema[key], `\`${key}\` still arrives from the view`).toBeUndefined();
    }
    // CONTROL on the same view: a relayed neighbour still arrives.
    expect(schema.exportOptions).toEqual({ formats: ['csv'] });
  });

  it('CONTROL: the object-view node\'s own value still reaches `ListView` (objectui#5097)', () => {
    const schema = pluginViewSchema({}, { ...DROPPED });
    for (const [key, value] of Object.entries(DROPPED)) {
      expect(schema[key], `\`${key}\` no longer arrives from the node`).toEqual(value);
    }
  });
});

describe('objectui#11013 — HOST 2: the object page relays none of the nine off the view', () => {
  it('THE CHANGE: none of the eight, and no `editRecordsInline`, reaches `ListView`', async () => {
    const schema = await objectPageSchema({ ...DROPPED, editRecordsInline: true });
    for (const key of Object.keys(DROPPED)) {
      expect(schema[key], `\`${key}\` still arrives from the view`).toBeUndefined();
    }
    expect(schema.editRecordsInline).toBeUndefined();
    expect(schema.inlineEdit).toBeUndefined();
  });

  it('THE CHANGE: a view\'s `allowExport: false` no longer withholds its `exportOptions`', async () => {
    const schema = await objectPageSchema({ allowExport: false, exportOptions: { formats: ['csv'] } });
    expect(schema.exportOptions).toEqual({ formats: ['csv'] });
    expect(schema.allowExport).toBeUndefined();
  });

  it('CONTROL: the declared neighbours on the same view are still relayed', async () => {
    const schema = await objectPageSchema({ ...DROPPED, inlineEdit: true, rowColor: { field: 'stage' } });
    expect(schema.inlineEdit).toBe(true);
    expect(schema.rowColor).toEqual({ field: 'stage' });
  });
});

describe('objectui#11013 — the toolbar policy is read as `userActions`', () => {
  it('DECLARED SPELLING: the object page\'s `object-view` node hears `userActions.search: false`', async () => {
    await objectPageSchema({ userActions: { search: false, sort: false, filter: false } });
    expect(objectViewNode.showSearch).toBe(false);
    expect(objectViewNode.showSort).toBe(false);
    expect(objectViewNode.showFilters).toBe(false);
  });

  it('SAME ANSWER: a legacy bare flag still switches the control off, through the fold', async () => {
    await objectPageSchema({ showSearch: false });
    expect(objectViewNode.showSearch).toBe(false);
    expect(objectViewNode.showSort).toBe(true);
  });

  it('CONTROL: a view that says nothing leaves all three on', async () => {
    await objectPageSchema({});
    expect(objectViewNode.showSearch).toBe(true);
    expect(objectViewNode.showSort).toBe(true);
    expect(objectViewNode.showFilters).toBe(true);
  });

  it('DECLARED SPELLING: plugin-view\'s non-grid route hears `userActions.search: false`', async () => {
    const node = await kanbanRouteNode({ userActions: { search: false } }, { showSearch: true });
    expect(node.showSearch).toBe(false);
  });

  it('SAME ANSWER: a legacy bare flag on the view still wins over the node there, through the fold', async () => {
    const node = await kanbanRouteNode({ showSearch: false }, { showSearch: true });
    expect(node.showSearch).toBe(false);
  });

  it('CONTROL: a view that says nothing takes the node\'s value there', async () => {
    const node = await kanbanRouteNode({}, { showSearch: true, showSort: true });
    expect(node.showSearch).toBe(true);
    expect(node.showSort).toBe(true);
  });
});
