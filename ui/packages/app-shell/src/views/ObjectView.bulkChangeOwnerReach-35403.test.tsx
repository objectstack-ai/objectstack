/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
import { __clearObjectTransferVerdicts } from './changeOwner';
import { createI18n, I18nProvider } from '@object-ui/i18n';
// Module scope, per AGENTS.md's test-discipline rule: the param dialog reaches
// its widgets through `React.lazy` factories inside `@object-ui/fields`.
import '@object-ui/fields';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
  const perms = {
    // This user may edit but not delete: no bulk Delete, so nothing but
    // Change Owner could give the rows a selection.
    check: (_object: string, operation?: string) => ({ allowed: operation !== 'delete' }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: (_object: string, grant?: string) => grant !== 'delete',
    cannot: (_object: string, grant?: string) => grant === 'delete',
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Sales Manager' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => fetch(url, init),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { ConsoleToaster } from '../chrome/ConsoleToaster';

/**
 * objectstack#35403 — the list's bulk Change Owner is reachable for a user who
 * holds transfer but not delete, on an object with no authored bulk actions.
 *
 * The page asks the object-level `transfer` verdict only once a selection is
 * open, so the rows must take a selection before that answer exists: wherever
 * the object offers the action (structure and switch, read client-side), the
 * grid draws its checkboxes; the verdict asked on the first tick decides
 * whether the bar draws the entry. Opening the list asks nothing.
 */

const OBJECTS = [
  {
    name: 'crm_deal',
    label: 'Deal',
    pluralLabel: 'Deals',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    listViews: { all: { name: 'all', label: 'All Deals', type: 'grid', columns: ['name'] } },
  },
];

const DEALS = [
  { id: 'deal_1', name: 'Alpha' },
  { id: 'deal_2', name: 'Beta' },
];

let transferAsks: unknown[];

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
  vi.unstubAllGlobals();
  __clearObjectTransferVerdicts();
  window.history.replaceState(null, '', '/');
});

function mountDeals(allowed: boolean, objects: any[] = OBJECTS) {
  transferAsks = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('/api/v1/security/explain')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.operation === 'transfer' && body.recordId === undefined && body.recordIds === undefined) {
        transferAsks.push(body);
        return new Response(JSON.stringify({ allowed }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: DEALS, total: DEALS.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ConsoleToaster />
      <ExpressionProvider user={{ id: 'u1', name: 'Sales Manager' }}>
        <MemoryRouter initialEntries={['/apps/crm/crm_deal/view/all']}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

async function rowBoxes(): Promise<HTMLElement[]> {
  return waitFor(() => {
    const found = Array.from(document.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];
    expect(found, 'the rows take a selection').toHaveLength(DEALS.length);
    return found;
  }, { timeout: 5000 });
}

/** Every bulk entry the bar carries, its More included. */
async function barNames(): Promise<string[]> {
  const bar = await screen.findByTestId('bulk-actions-bar', undefined, { timeout: 5000 });
  const names = within(bar).queryAllByTestId(/^bulk-action-/).map((el) => el.getAttribute('data-testid')!.slice('bulk-action-'.length));
  const more = within(bar).queryByTestId('selection-actions-more');
  if (more) {
    await act(async () => { fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' }); });
    const menu = await screen.findByRole('menu');
    names.push(...within(menu).queryAllByTestId(/^row-context-bulk-/).map((el) => el.getAttribute('data-testid')!.slice('row-context-bulk-'.length)));
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
  }
  return names;
}

/** Tick both rows: on a list page the bar's bulk entries are a multi-row selection's. */
async function tickBoth(boxes: HTMLElement[]): Promise<void> {
  for (const box of boxes) await act(async () => { fireEvent.click(box); });
}

describe('objectstack#35403 — bulk Change Owner is reachable without bulk Delete or authored bulk actions', () => {
  it('transfer, no delete, no authored bulk actions: checkboxes on open with no request; the first tick asks once and draws Change Owner', async () => {
    mountDeals(true);
    const boxes = await rowBoxes();
    await act(async () => {});
    expect(transferAsks, 'opening the list asks nothing').toEqual([]);

    await tickBoth(boxes);
    await waitFor(() => expect(transferAsks).toHaveLength(1), { timeout: 5000 });
    await act(async () => {});
    const names = await barNames();
    expect(names).toContain('sys_change_owner');
    expect(names, 'this user has no bulk Delete').not.toContain('delete');
    expect(transferAsks).toEqual([{ object: 'crm_deal', operation: 'transfer' }]);
  });

  it('a refused transfer verdict: the rows still select, and the bar draws no Change Owner', async () => {
    mountDeals(false);
    await tickBoth(await rowBoxes());
    await waitFor(() => expect(transferAsks).toHaveLength(1), { timeout: 5000 });
    await act(async () => {});
    expect(await barNames()).not.toContain('sys_change_owner');
  });

  it('CONTROL: an object that does not offer Change Owner draws no checkboxes and asks nothing', async () => {
    mountDeals(true, [{ ...OBJECTS[0], ownership: 'none' }]);
    await screen.findByText('Alpha', undefined, { timeout: 5000 });
    await act(async () => {});
    expect(document.querySelectorAll('tbody [role="checkbox"]')).toHaveLength(0);
    expect(transferAsks).toEqual([]);
  });
});
