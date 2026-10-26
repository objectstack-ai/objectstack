/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7924, ruling A′ — `densityMode` is retired on `NamedListView`, and
 * BOTH relays of a named view read the density THROUGH the fold.
 *
 * ## The chain this pins, end to end
 *
 * A stored view's density reaches `ListView` through two hops and one terminal
 * consumer: `objectDef.listViews` → `buildViewTabs` → `mergedViews` → the
 * `renderListView` composition in `plugin-view`'s `ObjectView` (hop 1) → this
 * package's object-page relay over that composition (hop 2) → `ListView`, which
 * runs `normalizeListViewSchema` before it reads anything. Before the ruling,
 * both hops relayed `densityMode` BY NAME and only the fold turned it into
 * `rowHeight`. After it, each hop hands its view to `normalizeListViewSchema`
 * and relays the result's `rowHeight`; the fold is the one place left that
 * names the retired key.
 *
 * ⭐ So this file mounts the REAL `plugin-view` `ObjectView` under the REAL
 * object page, and stubs only `ListView` to capture the schema it is handed.
 * Mocking `plugin-view` (what the sibling relay pins do) would stand in for
 * hop 1 and leave half the chain unmeasured. The plugin-view host is pinned on
 * its own as well, through a spy `renderListView`, because a third-party host
 * receives exactly that composition.
 *
 * ## What "behaves identically" means here, and how it is measured
 *
 * The renderer's density is `normalizeListViewSchema(schema).rowHeight` — the
 * value `ListView` reads after its own fold. That is computed from the captured
 * schema below, so the EFFECTIVE density is compared, not the key it travelled
 * under. Stored views must render the same density as before the ruling; what
 * changes is only that the retired key is no longer handed down by name.
 *
 * ## Direction, written before the reverse-verification run
 *
 * Restoring the two by-name hop lines on top of this change is PREDICTED to
 * turn exactly the cases titled `THE CHANGE` red (a `densityMode` key arrives,
 * and the pre-fold `rowHeight` is absent) and to leave every `SAME DENSITY` and
 * `CONTROL` case green — the fold inside `ListView` answered the same density
 * on either shape, which is the whole claim that stored views are unaffected.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { normalizeListViewSchema } from '@object-ui/core';

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

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

function objectsWith(view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      listViews: {
        dense: { label: 'Dense', type: 'grid', columns: ['name'], ...view },
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
  // `options` is written by the same relay literal unconditionally, so its
  // arrival is the signal the relay ran; waiting on the density itself would
  // hang rather than fail on a regression.
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
  return captured;
}

/** HOST 1 — plugin-view's `renderListView` composition, as a third-party host receives it. */
function pluginViewSchema(view: Record<string, unknown>): any {
  let handed: any = null;
  const renderListView = vi.fn(({ schema }: any) => {
    handed = schema;
    return null;
  });
  render(
    <PluginObjectView
      schema={{ type: 'object-view', objectName: OBJECT_NAME }}
      dataSource={makeDataSource()}
      views={[{ id: 'dense', label: 'Dense', type: 'grid', columns: ['name'], ...view }]}
      activeViewId="dense"
      renderListView={renderListView}
    />,
  );
  expect(renderListView).toHaveBeenCalled();
  return handed;
}

/** The density `ListView` renders: its own fold over what it was handed. */
const effectiveRowHeight = (schema: any): unknown =>
  (normalizeListViewSchema(schema) as { rowHeight?: unknown }).rowHeight;

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

describe('objectui#7924 ruling A′ — the plugin-view host reads the density through the fold', () => {
  it('SAME DENSITY: a stored `densityMode: compact` view renders `compact`, as before the ruling', () => {
    expect(effectiveRowHeight(pluginViewSchema({ densityMode: 'compact' }))).toBe('compact');
  });

  it('THE CHANGE: the composition hands down `rowHeight`, and never the retired key by name', () => {
    const schema = pluginViewSchema({ densityMode: 'spacious' });
    expect(schema.rowHeight).toBe('tall');
    expect(schema).not.toHaveProperty('densityMode');
  });

  it('SAME DENSITY: an authored `rowHeight` still wins over a legacy `densityMode` on the same view', () => {
    const schema = pluginViewSchema({ rowHeight: 'extra_tall', densityMode: 'compact' });
    expect(schema.rowHeight).toBe('extra_tall');
    expect(effectiveRowHeight(schema)).toBe('extra_tall');
  });

  it('CONTROL: a view with no density hands down none, and an off-vocabulary `densityMode` is not coerced', () => {
    expect(effectiveRowHeight(pluginViewSchema({}))).toBeUndefined();
    expect(effectiveRowHeight(pluginViewSchema({ densityMode: 'cozy' }))).toBeUndefined();
  });
});

describe('objectui#7924 ruling A′ — the object page, over the real plugin-view, reads the density through the fold', () => {
  it('SAME DENSITY: a stored `densityMode: compact` view renders `compact`, as before the ruling', async () => {
    expect(effectiveRowHeight(await objectPageSchema({ densityMode: 'compact' }))).toBe('compact');
  });

  it('THE CHANGE: the relay hands `ListView` `rowHeight`, and never the retired key by name', async () => {
    const schema = await objectPageSchema({ densityMode: 'spacious' });
    expect(schema.rowHeight).toBe('tall');
    expect(schema.densityMode).toBeUndefined();
  });

  it('SAME DENSITY: an authored `rowHeight` still wins over a legacy `densityMode` on the same view', async () => {
    expect(effectiveRowHeight(await objectPageSchema({ rowHeight: 'short', densityMode: 'spacious' }))).toBe('short');
  });

  it('CONTROL: a canonical `rowHeight` view is relayed unchanged, and no density stays absent', async () => {
    expect((await objectPageSchema({ rowHeight: 'medium' })).rowHeight).toBe('medium');
    cleanup();
    expect(effectiveRowHeight(await objectPageSchema({}))).toBeUndefined();
  });
});
