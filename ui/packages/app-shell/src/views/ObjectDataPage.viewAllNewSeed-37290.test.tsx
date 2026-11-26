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
 * A read refused, empty or past `TRAIL_NEW_PARENT_READ_TIMEOUT_MS` opens the
 * form with the parent pair alone; New is pending while the read runs; a read
 * that settles after the address moved on opens nothing.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
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

import { ObjectDataPage, TRAIL_NEW_PARENT_READ_TIMEOUT_MS } from './ObjectDataPage';
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

const readParent = async (object: string, id: string) =>
  (object === 'opportunity' && id === 'O-1' ? { id: 'O-1', name: 'Big deal', account: 'A-1' } : null);

function makeDataSource(findOne: (object: string, id: string) => Promise<unknown> = readParent) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(findOne),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function Probe() {
  const location = useLocation();
  return h('output', { 'data-testid': 'probe' }, `${location.pathname}${location.search}`);
}

/** Moves the address on (a filter change made while New's read is pending). */
function Mover() {
  const navigate = useNavigate();
  const location = useLocation();
  return h('button', { 'data-testid': 'move', onClick: () => navigate(`${location.pathname}${location.search}&moved=1`) }, 'move');
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
          element: h(React.Fragment, null, h(ObjectDataPage, { dataSource, objects: OBJECTS }), h(Probe), h(Mover)),
        })),
      ),
    }),
  );
}

const params = () => new URLSearchParams((screen.getByTestId('probe').textContent ?? '').split('?')[1] ?? '');
const newButton = () => document.querySelector('[data-testid="object-data-new-button"]') as HTMLButtonElement;
const clickNew = () => fireEvent.click(newButton());

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
});

afterEach(() => {
  vi.useRealTimers();
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

  it('a refused parent read opens the form with the parent pair alone', async () => {
    const ds = makeDataSource(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); });
    renderAt('contract', ds);
    clickNew();
    await waitFor(() => expect(params().get('form')).toBe('new'));
    expect(params().getAll('formLink')).toEqual(['opportunity:O-1']);
    expect(ds.findOne).toHaveBeenCalledWith('opportunity', 'O-1');
    expect(newButton().disabled).toBe(false);
  });

  it('a parent read that finds nothing opens the form with the parent pair alone', async () => {
    const ds = makeDataSource(async () => null);
    renderAt('contract', ds);
    clickNew();
    await waitFor(() => expect(params().get('form')).toBe('new'));
    expect(params().getAll('formLink')).toEqual(['opportunity:O-1']);
    expect(ds.findOne).toHaveBeenCalledWith('opportunity', 'O-1');
  });

  it('New is pending while the read runs, and a read that never settles opens the parent pair alone after the bound', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ds = makeDataSource(() => new Promise(() => {}));
    renderAt('contract', ds);
    clickNew();
    await waitFor(() => expect(newButton().disabled).toBe(true));
    expect(newButton().getAttribute('aria-busy')).toBe('true');
    expect(params().get('form')).toBeNull();
    await vi.advanceTimersByTimeAsync(TRAIL_NEW_PARENT_READ_TIMEOUT_MS);
    await waitFor(() => expect(params().get('form')).toBe('new'));
    expect(params().getAll('formLink')).toEqual(['opportunity:O-1']);
    expect(newButton().disabled).toBe(false);
  });

  it('a read that settles after the address moved on opens nothing and keeps the new address', async () => {
    let settle: (rec: unknown) => void = () => {};
    const ds = makeDataSource(() => new Promise((resolve) => { settle = resolve; }));
    renderAt('contract', ds);
    clickNew();
    await waitFor(() => expect(newButton().disabled).toBe(true));
    fireEvent.click(screen.getByTestId('move'));
    await waitFor(() => expect(params().get('moved')).toBe('1'));
    settle({ id: 'O-1', account: 'A-1' });
    await waitFor(() => expect(newButton().disabled).toBe(false));
    expect(params().get('form')).toBeNull();
    expect(params().getAll('formLink')).toEqual([]);
    expect(params().get('moved')).toBe('1');
  });
});
