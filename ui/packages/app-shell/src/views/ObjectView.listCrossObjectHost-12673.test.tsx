/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12673 — the real `ObjectView` publishes, to everything its list
 * renders, a record-URL builder that answers ANY routable object, and it is
 * the record page's builder: the same route the record page's
 * `RelatedRecordActionsBridge` hands its lookups, minus the `?from=` trail a
 * list page has no parent record for.
 *
 * The list body is a probe (the `ObjectView.listLinksPlural-11733` harness)
 * that reads `recordHref` / `openRecord` off the context the page publishes,
 * so what is pinned is the page's wiring, under a router mounted at
 * `/_console`. The cells that consume it are pinned with the real grid in
 * `__tests__/listCrossObjectCells-12673.test.tsx`.
 *
 * CONTROL: the record page's bridge, mounted on the same objects, keeps its
 * `?from=` trail and its answer for an unroutable object.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useRelatedRecordActions } from '@object-ui/react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
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

/** What the probe reads off the page's record-link context. */
function HrefProbe({ objectName, recordId, testId }: { objectName: string; recordId: string; testId: string }) {
  const host = useRelatedRecordActions();
  return (
    <>
      <output data-testid={`${testId}-href`}>{host?.recordHref?.(objectName, recordId) ?? '(null)'}</output>
      <button type="button" data-testid={`${testId}-open`} onClick={() => host?.openRecord?.(objectName, recordId)} />
    </>
  );
}

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const ListProbe = () => (
    <>
      <HrefProbe objectName="crm_account" recordId="acc-1" testId="account" />
      <HrefProbe objectName="legacy_ledger" recordId="led-1" testId="ledger" />
    </>
  );
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ObjectView: ListProbe,
    ViewTabBar: () => null,
    ManageViewsDialog: () => null,
  };
});

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { RelatedRecordActionsBridge } from './RelatedRecordActionsBridge';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const BASENAME = '/_console';
const FIELDS = { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } };
const LIST_VIEW = { grid: { type: 'grid', label: 'All', columns: ['name'] } };
/** The console's object definitions; `legacy_ledger` is not among them. */
const OBJECTS = [
  { name: 'crm_opportunity', label: 'Opportunity', fields: FIELDS, listViews: LIST_VIEW },
  { name: 'crm_account', label: 'Account', fields: FIELDS, listViews: LIST_VIEW },
];

/** The record route: where an in-app open landed. */
function LandedProbe() {
  const location = useLocation();
  return <div data-testid="landed">{`${location.pathname}${location.search}`}</div>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mountList(): Promise<void> {
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
      <MemoryRouter basename={BASENAME} initialEntries={[`${BASENAME}/apps/hotcrm/crm_opportunity`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
          />
          <Route path="/apps/:appName/:objectName/record/:recordId" element={<LandedProbe />} />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await screen.findByTestId('account-href', {}, { timeout: 5000 });
}

function mountRecordPageBridge() {
  render(
    <MemoryRouter basename={BASENAME} initialEntries={[`${BASENAME}/apps/hotcrm/crm_opportunity/record/opp-1`]}>
      <RelatedRecordActionsBridge
        appName="hotcrm"
        objects={OBJECTS}
        dataSource={null}
        parentObjectName="crm_opportunity"
        parentRecordId="opp-1"
        parentTitle="Globex Manufacturing Suite"
      >
        <HrefProbe objectName="crm_account" recordId="acc-1" testId="account" />
        <HrefProbe objectName="legacy_ledger" recordId="led-1" testId="ledger" />
      </RelatedRecordActionsBridge>
    </MemoryRouter>,
  );
}

const text = (testId: string) => screen.getByTestId(testId).textContent ?? '';

describe('ObjectView publishes the record page builder to its list (objectui#12673)', () => {
  it('another routable object: the href carries the basename and the app, with no `?from=` trail', async () => {
    await mountList();
    expect(text('account-href')).toBe('/_console/apps/hotcrm/crm_account/record/acc-1');
  });

  it('another routable object: a left click opens that record in-app', async () => {
    await mountList();
    fireEvent.click(screen.getByTestId('account-open'));
    expect(text('landed')).toBe('/apps/hotcrm/crm_account/record/acc-1');
  });

  it('an object the console cannot route to: no href, and opening it goes nowhere', async () => {
    await mountList();
    expect(text('ledger-href')).toBe('(null)');
    fireEvent.click(screen.getByTestId('ledger-open'));
    expect(screen.queryByTestId('landed')).toBeNull();
  });

  it('one builder: the list page addresses the same route the record page does', async () => {
    await mountList();
    const fromList = text('account-href');
    cleanup();
    mountRecordPageBridge();
    expect(text('account-href').split('?')[0]).toBe(fromList);
  });
});

describe('CONTROL — the record page links are unchanged (objectui#12673)', () => {
  it('the record page keeps its `?from=` trail for the parent record', () => {
    mountRecordPageBridge();
    const href = text('account-href');
    expect(href.startsWith('/_console/apps/hotcrm/crm_account/record/acc-1?from=')).toBe(true);
  });

  it('the record page still answers no href for an object it cannot route to', () => {
    mountRecordPageBridge();
    expect(text('ledger-href')).toBe('(null)');
  });
});
