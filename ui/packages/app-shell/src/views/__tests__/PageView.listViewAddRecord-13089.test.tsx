/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13089 — a page `list-view` node's `addRecord` opens the create the
 * object list opens.
 *
 * `ListViewBlock` routes `addRecord.enabled` to the `onCreate` a
 * `RelatedRecordActionsContext` provider serves for the listed object
 * (`resolve({ objectName })`, objectui#13074), and the console's page host
 * answered every parent-less resolve with no handlers, so on a console page
 * the button was withheld. `pageRelatedHandlers` now serves the bridge's
 * create pair, `onCreate` / `createDisabled` and nothing else, to an
 * object-scoped list: one that names no `relationshipField` and no parent.
 *
 * Every case mounts the real `PageView`, the real console action runtime, the
 * real page renderer, `@object-ui/plugin-list`'s and `@object-ui/plugin-detail`'s
 * registrations, and reads the DOM or the location the click pushes.
 *
 * The CONTROLS are the other lists on a page, whose served set must not move:
 *  - an unbound `record:related_list` (it names its `relationshipField`, its
 *    parent did not resolve) draws no "+ New", which would open a child form
 *    linked to no parent;
 *  - no Edit, Delete, row click, "View all" or action executor is served to a
 *    parent-less resolve, read off the served handler set by a probe block on
 *    the page;
 *  - under a parent the served set is the objectui#12870 executors, as before
 *    (`PageView.relatedListActions-12870.test.tsx` keeps its own CONTROL row).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';

const { createGrant } = vi.hoisted(() => ({ createGrant: { value: true } }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: the bridge and the list name `perms` in memo deps. The
  // create grant is read per call, so one case can withdraw it.
  const perms = {
    check: (_object: string, action: string) => ({ allowed: action === 'create' ? createGrant.value : true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: (_object: string, action: string) => (action === 'create' ? createGrant.value : true),
    cannot: (_object: string, action: string) => (action === 'create' ? !createGrant.value : false),
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [], readableFields: (f: string[]) => f };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

const APP = 'cloud';
const PARENT = 'sys_organization';
/** Created through the record-form overlay (no `editMode`). */
const CHILD = 'sys_member';
/** Created on the full-page create route (`editMode: 'page'`). */
const PAGE_MODE = 'sys_contract';
/** Its create is greyed for every record (`userActions.create.disabledWhen`). */
const GREYED = 'sys_ledger';

const FIELDS = {
  name: { name: 'name', type: 'text', label: 'Name' },
  organization_id: { name: 'organization_id', type: 'lookup', reference: PARENT, label: 'Organization' },
};
const OBJECTS = [
  { name: PARENT, label: 'Organization', fields: { name: FIELDS.name } },
  {
    name: CHILD,
    label: 'Member',
    fields: FIELDS,
    // One of each placement, so a served executor would show up as a key.
    actions: [
      { name: 'invite_user', label: 'Invite user', type: 'api', target: '/api/v1/org/invite', locations: ['list_toolbar'] },
      { name: 'remove', label: 'Remove', type: 'api', target: '/api/v1/members/{id}/remove', locations: ['list_item'] },
    ],
  },
  { name: PAGE_MODE, label: 'Contract', editMode: 'page', fields: { name: FIELDS.name } },
  { name: GREYED, label: 'Ledger', userActions: { create: { disabledWhen: 'true' } }, fields: { name: FIELDS.name } },
];

/** The page's blocks, varied per case. */
let blocks: Array<Record<string, unknown>> = [];

/** A page `list-view` node over `object`. */
const listView = (object: string, extra: Record<string, unknown> = {}) => ({
  type: 'list-view',
  id: `list-${object}`,
  properties: { data: { provider: 'object', object }, columns: ['name'], ...extra },
});
/** A `record:related_list` with no parent bound: it names its relationship, its parent does not resolve. */
const unboundRelatedList = {
  type: 'record:related_list',
  id: 'members',
  properties: { objectName: CHILD, relationshipField: 'organization_id', title: 'Members', columns: ['name'] },
};

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    pages: [{ name: 'team', label: 'Team', type: 'app', regions: [{ name: 'main', components: blocks }] }],
    objects: OBJECTS,
    getTypeStatus: () => 'ready',
  }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

import { ComponentRegistry } from '@object-ui/core';
import {
  AdapterCtx,
  MetadataCtx,
  SchemaRendererProvider,
  useRelatedRecordActions,
  type MetadataContextValue,
  type ResolveRelatedRecordActionsInput,
} from '@object-ui/react';
// The real page renderer and the two list blocks (module scope, AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/plugin-list';
import '@object-ui/plugin-detail';
import { PageView } from '../PageView';

/**
 * A page block that prints the handler set the page serves for each input
 * shape a list resolves with: its keys, sorted, per input.
 */
const PROBE = 'probe-page-served-handlers-13089';
const PROBE_INPUTS: Record<string, ResolveRelatedRecordActionsInput> = {
  objectScoped: { objectName: CHILD },
  unboundRelated: { objectName: CHILD, relationshipField: 'organization_id', parentId: null },
  emptyRelationship: { objectName: CHILD, relationshipField: '', parentId: '' },
  boundRelated: { objectName: CHILD, relationshipField: 'organization_id', parentId: 'org-1' },
};
function ServedHandlersProbe() {
  const host = useRelatedRecordActions();
  return (
    <ul>
      {Object.entries(PROBE_INPUTS).map(([name, input]) => (
        <li key={name} data-testid={`served-${name}`}>
          {host ? Object.keys(host.resolve(input)).sort().join(',') : 'NO-HOST'}
        </li>
      ))}
    </ul>
  );
}
ComponentRegistry.register(PROBE, ServedHandlersProbe as never);

const METADATA: MetadataContextValue = {
  apps: [],
  objects: OBJECTS,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: (async (type: string, name: string) =>
    type === 'object' ? OBJECTS.find((o) => o.name === name) ?? null : null) as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function makeDataSource() {
  return {
    find: vi.fn(async (object: string) =>
      object === PARENT
        ? { data: [], total: 0 }
        : { data: [{ id: `${object}-1`, name: 'Alice', organization_id: 'org-1' }], total: 1 },
    ),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 1),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name)),
    getObjects: vi.fn(async () => OBJECTS),
    onMutation: () => () => {},
  };
}

/** Where the router is: what a click pushed. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function mount(nodes: Array<Record<string, unknown>>) {
  blocks = nodes;
  const ds = makeDataSource();
  render(
    <MetadataCtx.Provider value={METADATA}>
      <AdapterCtx.Provider value={ds as never}>
        <SchemaRendererProvider dataSource={ds as never}>
          <MemoryRouter initialEntries={[`/apps/${APP}/page/team`]}>
            <LocationProbe />
            <Routes>
              <Route path="/apps/:appName/page/:pageName" element={<PageView />} />
              <Route path="*" element={null} />
            </Routes>
          </MemoryRouter>
        </SchemaRendererProvider>
      </AdapterCtx.Provider>
    </MetadataCtx.Provider>,
  );
  return ds;
}

const location = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x');
const addButtons = () => screen.queryAllByTestId('add-record-button');
/** The list's toolbar is up: the Add button, when offered, is drawn in it. */
const listDrawn = () => screen.findByTestId('toolbar-filter-trigger', undefined, { timeout: 5000 });

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
  createGrant.value = true;
});

describe('objectui#13089 — a page `list-view` node’s `addRecord` opens the object list’s create', () => {
  it('draws the Add button, and clicking it opens the record-form create for the listed object', async () => {
    const ds = mount([listView(CHILD, { addRecord: { enabled: true } })]);
    await listDrawn();
    await waitFor(() => expect(addButtons()).toHaveLength(1));

    fireEvent.click(addButtons()[0]);
    await waitFor(() => expect(location().searchParams.get('form')).toBe('new'));
    expect(location().pathname).toBe(`/apps/${APP}/page/team`);
    expect(location().searchParams.get('formObject')).toBe(CHILD);
    // An object-scoped create links no parent.
    expect(location().searchParams.get('formLink')).toBeNull();
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('an `editMode: \'page\'` object opens its full-page create route, as the object list does', async () => {
    mount([listView(PAGE_MODE, { addRecord: { enabled: true } })]);
    await listDrawn();
    await waitFor(() => expect(addButtons()).toHaveLength(1));

    fireEvent.click(addButtons()[0]);
    await waitFor(() => expect(location().pathname).toBe(`/apps/${APP}/${PAGE_MODE}/new`));
    expect(location().searchParams.get('form')).toBeNull();
  });

  it('a viewer with no create grant gets no Add button: withheld, not drawn dead', async () => {
    createGrant.value = false;
    mount([listView(CHILD, { addRecord: { enabled: true } })]);
    await listDrawn();
    expect(addButtons()).toHaveLength(0);
  });

  it('a create the object greys (`createDisabled`) withholds the Add button', async () => {
    mount([listView(GREYED, { addRecord: { enabled: true } })]);
    await listDrawn();
    expect(addButtons()).toHaveLength(0);
  });

  it('CONTROL: a node without `addRecord` draws no Add button', async () => {
    mount([listView(CHILD)]);
    await listDrawn();
    expect(addButtons()).toHaveLength(0);
  });

  it('CONTROL: an unbound related list on the same page draws no “+ New”', async () => {
    mount([unboundRelatedList, listView(CHILD, { addRecord: { enabled: true } })]);
    await screen.findByText('Members');
    // The list-view beside it is served, so the page host is answering.
    await waitFor(() => expect(addButtons()).toHaveLength(1));
    expect(screen.queryByTestId('related-list-new')).toBeNull();
  });

  it('CONTROL: a parent-less resolve is served the create pair only, and an unbound related list nothing; under a parent the executors, as before', async () => {
    mount([{ type: PROBE, id: 'probe' }]);
    // No Edit, Delete, row click, "View all" or executor parent-less.
    await waitFor(() => expect(screen.getByTestId('served-objectScoped')).toHaveTextContent(/^onCreate$/));
    // An empty `relationshipField` names no relationship: the object-scoped case.
    expect(screen.getByTestId('served-emptyRelationship')).toHaveTextContent(/^onCreate$/);
    expect(screen.getByTestId('served-unboundRelated')).toHaveTextContent(/^$/);
    expect(screen.getByTestId('served-boundRelated')).toHaveTextContent(/^onRowAction,onToolbarAction$/);
  });
});
