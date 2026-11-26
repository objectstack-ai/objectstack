/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37290 — New on a list opened from a related list's "View all"
 * (the record trail, objectstack#35601) seeds the child as the related tab's
 * New does (objectstack#37246, `relatedCreateSeedOf`): beside the parent pair,
 * each `dependsOn` field of the link takes the source record's value. The
 * trail holds the record's id alone, so the page reads the record once.
 *
 * Control: a link with no `dependsOn` writes the parent pair and reads nothing.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
// The page reaches `@objectstack/lint` through a dynamic import; its first load is paid at collection, not inside a case.
import '@objectstack/lint';

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

// Heavy children, all orthogonal to the New path under test and each dragging in
// a plugin bundle — the same posture as the sibling create-affordance test on
// this page.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { ObjectDataPage } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { RECORD_TRAIL_PARAM } from '../urlParams';

const h = React.createElement;

const OBJECTS = [
  {
    name: 'contract',
    label: 'Contract',
    pluralLabel: 'Contracts',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      account: { type: 'lookup', reference: 'account', label: 'Account' },
      opportunity: { type: 'lookup', reference: 'opportunity', label: 'Opportunity', dependsOn: ['account'] },
    },
  },
  {
    name: 'task',
    label: 'Task',
    pluralLabel: 'Tasks',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      opportunity: { type: 'lookup', reference: 'opportunity', label: 'Opportunity' },
    },
  },
  { name: 'opportunity', label: 'Opportunity', pluralLabel: 'Opportunities', managedBy: 'platform', fields: { name: { type: 'text', label: 'Name' }, account: { type: 'lookup', reference: 'account', label: 'Account' } } },
  { name: 'account', label: 'Account', pluralLabel: 'Accounts', managedBy: 'platform', fields: { name: { type: 'text', label: 'Name' } } },
];

const TRAIL = encodeURIComponent(JSON.stringify([{ o: 'opportunity', i: 'O-1', t: 'Big deal' }]));

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async (object: string, id: string) => (object === 'opportunity' && id === 'O-1' ? { id: 'O-1', name: 'Big deal', account: 'A-1' } : null)),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function Probe() {
  const location = useLocation();
  return h('output', { 'data-testid': 'probe' }, `${location.pathname}${location.search}`);
}

function renderAt(objectName: string, dataSource: any) {
  return render(
    h(ExpressionProvider, {
      user: { id: 'u1', name: 'Ada', profile: 'admin' },
      children: h(
        MemoryRouter,
        { initialEntries: [`/apps/demo/${objectName}/data?filter[opportunity]=O-1&${RECORD_TRAIL_PARAM}=${TRAIL}`] },
        h(Routes, null, h(Route, {
          path: '/apps/:appName/:objectName/data',
          element: h(React.Fragment, null, h(ObjectDataPage, { dataSource, objects: OBJECTS }), h(Probe)),
        })),
      ),
    }),
  );
}

const params = () => new URLSearchParams((screen.getByTestId('probe').textContent ?? '').split('?')[1] ?? '');
const clickNew = () => fireEvent.click(document.querySelector('[data-testid="object-data-new-button"]')!);

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('New from a record trail seeds the dependsOn fields (objectstack#37290)', () => {
  it('opens the child form with the parent pair, then the dependsOn value read from the source record', async () => {
    const ds = makeDataSource();
    renderAt('contract', ds);
    clickNew();
    await waitFor(() => expect(params().get('form')).toBe('new'));
    expect(params().get('formObject')).toBe('contract');
    expect(params().getAll('formLink')).toEqual(['opportunity:O-1', 'account:A-1']);
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith('opportunity', 'O-1');
  });

  it('CONTROL — a link with no dependsOn writes the parent pair alone and reads nothing', async () => {
    const ds = makeDataSource();
    renderAt('task', ds);
    clickNew();
    await waitFor(() => expect(params().get('form')).toBe('new'));
    expect(params().getAll('formLink')).toEqual(['opportunity:O-1']);
    expect(ds.findOne).not.toHaveBeenCalledWith('opportunity', 'O-1');
  });
});
