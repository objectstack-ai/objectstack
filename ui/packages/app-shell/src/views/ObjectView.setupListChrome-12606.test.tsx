/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12606 — a `sys_*` record list under the Setup app drops the grid's
 * `#` row numbers. The Display control stays on every list, under Setup too
 * (the maintainer's ruling C on the card withdrew the Display hide rule).
 *
 * Measured from a real `ObjectView` → `ListView` → `ObjectGrid` mount (the
 * `ObjectView.listUrlState-11860` harness). "Under Setup" is the route's own
 * `:appName` (`setup` / `com.objectstack.setup`); the control is the same
 * object under another app, which keeps its numbers and its Display.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { perms } = vi.hoisted(() => ({
  // ONE stable object: `ListView` names `perms` in its fetch dependency list.
  perms: {
    check: () => ({ allowed: true }),
    checkField: () => true as boolean,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
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
// The grid registers `object-grid` on import.
import '@object-ui/plugin-grid';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};
const view = (label: string) => ({ label, type: 'grid', columns: ['name'] });

const OBJECTS = [
  // Two views: four or fewer, and Display still draws under Setup.
  { name: 'sys_team_12606', label: 'Team', pluralLabel: 'Teams', fields: FIELDS, listViews: { all: view('All'), mine: view('Mine') } },
];

const ROWS = [{ id: '1', name: 'Core' }, { id: '2', name: 'Ops' }];

beforeEach(() => {
  // The page's side reads (`/security/explain` and the like) answer empty.
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
  cleanup();
  vi.unstubAllGlobals();
});

async function mount(appName: string, objectName: string) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/${appName}/${objectName}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={dataSource as never} objects={OBJECTS as any} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await screen.findByText('Core', {}, { timeout: 8000 });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
}

const rowNumberCells = () => document.querySelectorAll('[data-slot="row-number"]').length;

describe('a record list under Setup drops the `#` column and keeps Display (objectui#12606)', () => {
  it.each(['setup', 'com.objectstack.setup'])('under /apps/%s the grid renders no `#` column, and Display still draws', async (app) => {
    await mount(app, 'sys_team_12606');
    expect(rowNumberCells()).toBe(0);
    expect(screen.getByTestId('toolbar-display-trigger')).toBeTruthy();
  });

  it('CONTROL — the same list under another app numbers its rows and draws Display', async () => {
    await mount('crm', 'sys_team_12606');
    expect(rowNumberCells()).toBe(ROWS.length);
    expect(screen.getByTestId('toolbar-display-trigger')).toBeTruthy();
  });
});
