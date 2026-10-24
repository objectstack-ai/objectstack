/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10380 — one stored view renders the same on the interface page and
 * on the object page.
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s flattened list overlay declares a legacy `options` bag
 * (`ListViewOverlayOptionsSchema`). The view write door judges each
 * `options.KIND` block key by key with that kind's block schema, refuses an
 * out-of-contract key by name, and stores what it accepts. Every row below is
 * one that door accepts. `InterfaceListPage` forwarded the bag to `ListView`,
 * and `ObjectView` dropped it. So the same stored row handed the renderer two
 * different configs: a timeline grouped by `region` on one page and ungrouped
 * on the other, a kanban card titled by `region` on one page and by `name` on
 * the other, and a map with a location binding on one page and none on the
 * other.
 *
 * Ruling A (comment 5824043998 on the card) keeps the interface page's forward
 * ("what passes the door is legal"), so the object page now forwards the bag
 * too. `ListView`'s existing per-key merge lays the top-level block over the
 * bag, which is the precedence the spec declares for it. This file pins that
 * the two pages hand the RENDERER the same config.
 *
 * ## Why the renderer, and not the `ListView` schema
 *
 * The two pages build different `ListView` schemas on purpose. The object page
 * relays the view's blocks under `options.KIND`, while the interface page sends
 * them at the top level. So comparing the two schemas proves nothing. Each case
 * captures the schema a page hands `ListView`, mounts the REAL `ListView` on it
 * with a spy renderer registered for the kind, and compares what the renderer
 * receives. That is what reaches the screen.
 *
 * ## Direction, written before the run, and what was observed
 *
 * On `origin/main` (before the fix), the four bag rows were predicted RED and
 * the no-bag control GREEN. The two collision cases were predicted GREEN there
 * too: the object page ignored the bag and the interface page let the
 * top-level block win, so both answered with the top-level value.
 *
 * Observed on `origin/main`: the four bag rows RED, the control GREEN and the
 * timeline collision GREEN, as predicted. The kanban collision went RED, which
 * was not predicted. Its lane agreed ('region' on both pages). It failed on the
 * card title: the object page floored `titleField: 'name'` in
 * `kanbanViewOptions`, and the interface page sent no title for a row whose
 * bag carries a kanban block. With the fix, a kind the bag carries takes the
 * bag's block in place of the synthesized one, so that floor no longer applies.
 *
 * Ablation on the fixed tree: the declared block was merged UNDER the bag in
 * app-shell (`{ ...viewDef.KIND, ...legacyOptions.KIND }` at the top level, for
 * timeline and kanban). That is the second merge, with the wrong precedence,
 * that this fix must not write. Predicted: the two collision cases RED.
 * Observed: those two RED, and the `options.timeline.groupByField` row RED as
 * well. `ListView` reads `groupByField` as a flat timeline key off the
 * top-level block only, so the merged block exposed the bag's key on the object
 * page alone. Both runs are quoted in the PR body.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

/** The `ListView` schema each page builds, captured on the way in. */
let capturedListSchema: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    capturedListSchema = props.schema;
    return null;
  },
}));

vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: { ...(props.schema ?? {}) },
      dataSource: props.dataSource,
      onEdit: props.onEdit,
      className: '',
      refreshKey: 0,
    }) ?? null,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

/** `InterfaceListPage` reads its objects from the metadata provider. */
let metadataObjects: any[] = [];
vi.mock('../providers/MetadataProvider.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: metadataObjects }),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAdapter: () => ({}) };
});

import { ComponentRegistry } from '@object-ui/core';
import { ObjectView, storedLegacyOptions } from './ObjectView';
import { InterfaceListPage } from './InterfaceListPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'parity_task';
const VIEW_KEY = `${OBJECT_NAME}.ops`;

/** One stored flat list overlay, as the console merges it into `listViews`. */
function objectsWith(row: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        region: { type: 'text', label: 'Region' },
        status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
        start_date: { type: 'date', label: 'Start' },
        location: { type: 'location', label: 'Location' },
      },
      listViews: { [VIEW_KEY]: { name: VIEW_KEY, columns: ['name', 'region'], ...row } },
    },
  ];
}

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({
      data: [{ id: '1', name: 'Alpha', region: 'EMEA', status: 'open', start_date: '2099-01-01' }],
      total: 1,
    })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => metadataObjects[0]),
  }) as any;

async function objectPageSchema(row: Record<string, unknown>): Promise<any> {
  capturedListSchema = null;
  metadataObjects = objectsWith(row);
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={makeDataSource()} objects={metadataObjects} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  // `options` is written by the same literal as every rung under test, so its
  // arrival says the relay ran.
  await waitFor(() => expect(capturedListSchema?.options).toBeTruthy());
  const schema = capturedListSchema;
  cleanup();
  return schema;
}

async function interfacePageSchema(row: Record<string, unknown>, visualization: string): Promise<any> {
  capturedListSchema = null;
  metadataObjects = objectsWith(row);
  const page = {
    name: 'parity_page',
    label: 'Parity',
    interfaceConfig: {
      source: OBJECT_NAME,
      sourceView: 'ops',
      recordAction: 'none',
      appearance: { allowedVisualizations: [visualization] },
    },
  };
  render(
    <MemoryRouter>
      <InterfaceListPage page={page as any} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(capturedListSchema).toBeTruthy());
  const schema = capturedListSchema;
  cleanup();
  return schema;
}

/** Props each spy renderer received, newest last. */
const received: Record<string, any[]> = { 'object-timeline': [], 'object-kanban': [], 'object-map': [] };
for (const type of Object.keys(received)) {
  ComponentRegistry.register(
    type,
    (props: any) => {
      received[type].push(props);
      return <div data-testid={`${type}-spy`} />;
    },
    { namespace: 'parity-10380', label: type, category: 'view' },
  );
}

/** Mount the REAL `ListView` on `schema` and return the props `rendererType` receives. */
async function rendererProps(schema: any, viewType: string, rendererType: string): Promise<any> {
  const { ListView } = await vi.importActual<typeof import('@object-ui/plugin-list')>('@object-ui/plugin-list');
  const { SchemaRendererProvider } = await vi.importActual<any>('@object-ui/react');
  received[rendererType] = [];
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...schema, viewType }} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(received[rendererType].length).toBeGreaterThan(0));
  const props = received[rendererType][received[rendererType].length - 1];
  cleanup();
  return props.schema;
}

/** The timeline config the renderer reads: the nested block and the flat keys. */
const timelineConfig = (node: any) => ({
  timeline: node.timeline,
  startDateField: node.startDateField,
  endDateField: node.endDateField,
  titleField: node.titleField,
  groupByField: node.groupByField,
  colorField: node.colorField,
  scale: node.scale,
});
const kanbanConfig = (node: any) => ({ groupBy: node.groupBy, titleField: node.titleField, cardFields: node.cardFields });
const mapConfig = (node: any) => ({
  locationField: node.locationField,
  titleField: node.titleField,
  latitudeField: node.latitudeField,
  longitudeField: node.longitudeField,
  zoom: node.zoom,
  center: node.center,
});

const RENDERERS: Record<string, { rendererType: string; project: (node: any) => Record<string, any> }> = {
  timeline: { rendererType: 'object-timeline', project: timelineConfig },
  kanban: { rendererType: 'object-kanban', project: kanbanConfig },
  map: { rendererType: 'object-map', project: mapConfig },
};

/** What each page's renderer receives for one stored row. */
async function bothPages(row: Record<string, unknown>) {
  const viewType = row.type as string;
  const { rendererType, project } = RENDERERS[viewType];
  const objectSchema = await objectPageSchema(row);
  const interfaceSchema = await interfacePageSchema(row, viewType);
  return {
    objectPage: project(await rendererProps(objectSchema, viewType, rendererType)),
    interfacePage: project(await rendererProps(interfaceSchema, viewType, rendererType)),
  };
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('objectui#10380 — a stored row with a legacy `options` bag renders the same on both pages', () => {
  it('a timeline block carried only in the bag (`options.timeline.titleField`)', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'timeline',
      options: { timeline: { titleField: 'region' } },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage.titleField).toBe('region');
  });

  it('a map block carried only in the bag (the legacy `options.map` path)', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'map',
      options: { map: { locationField: 'location', titleField: 'region' } },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage).toMatchObject({ locationField: 'location', titleField: 'region' });
  });

  it('a bag key under a declared top-level timeline block (`options.timeline.groupByField`)', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'timeline',
      timeline: { startDateField: 'start_date', titleField: 'name' },
      options: { timeline: { groupByField: 'region' } },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage.timeline).toMatchObject({ startDateField: 'start_date', titleField: 'name', groupByField: 'region' });
  });

  it('a bag key under a declared top-level kanban block (`options.kanban.titleField`)', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'kanban',
      kanban: { groupByField: 'region', columns: ['name'] },
      options: { kanban: { titleField: 'region' } },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage).toMatchObject({ groupBy: 'region', titleField: 'region', cardFields: ['name'] });
  });

  it('CONTROL: a row with no bag renders the same on both pages', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'timeline',
      timeline: { startDateField: 'start_date', titleField: 'name' },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage.timeline).toEqual({ startDateField: 'start_date', titleField: 'name' });
  });
});

describe('objectui#10380 — the top-level block wins per key over the bag, on both pages', () => {
  it('timeline: the declared `titleField` beats the bag’s', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'timeline',
      timeline: { startDateField: 'start_date', titleField: 'name' },
      options: { timeline: { titleField: 'region' } },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage.titleField).toBe('name');
    expect(objectPage.timeline.titleField).toBe('name');
  });

  it('kanban: the declared lane beats the bag’s', async () => {
    const { objectPage, interfacePage } = await bothPages({
      type: 'kanban',
      kanban: { groupByField: 'region', columns: ['name'] },
      options: { kanban: { groupByField: 'status' } },
    });
    expect(objectPage).toEqual(interfacePage);
    expect(objectPage.groupBy).toBe('region');
  });
});

describe('storedLegacyOptions — what counts as a bag', () => {
  it('a plain object is the bag; anything else is no bag', () => {
    const bag = { kanban: { titleField: 'region' } };
    expect(storedLegacyOptions({ options: bag })).toBe(bag);
    expect(storedLegacyOptions({})).toEqual({});
    expect(storedLegacyOptions(undefined)).toEqual({});
    expect(storedLegacyOptions({ options: ['kanban'] })).toEqual({});
    expect(storedLegacyOptions({ options: 'kanban' })).toEqual({});
  });
});
