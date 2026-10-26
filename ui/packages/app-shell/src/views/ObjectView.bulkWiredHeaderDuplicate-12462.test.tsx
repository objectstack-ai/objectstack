/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12462 (ruling A-narrow) — the list page's header does not draw a
 * duplicate of a `list_toolbar` action that the ACTIVE view wires to its
 * selection bar AND that is record-scoped.
 *
 * Measured on HotCRM's Leads list: `create_campaign` ("Add to Campaign",
 * `locations: ['list_toolbar', 'list_item']`) is wired by the `all_leads`
 * view's `bulkActions`, so the selection bar already carried it with rows
 * ticked while the header also drew it at every selection. The selection bar is
 * the list toolbar in its selection mode, so the action stays at its declared
 * placement there; what leaves is the header's permanent copy, and with it the
 * `?runAction=` deep-link arming, which arms only what the header draws.
 *
 * The real chain throughout: the real `ObjectView`, the real `ObjectGrid` and
 * its `BulkActionBar` (fed by `resolveBulkActions` from the view's own keys),
 * the real `action:bar`. Every case is a differential on the view's wiring or
 * the action's placement, with the same object and the same rows.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { NAV_RUN_ACTION_PARAM } from '@object-ui/layout';
// Module scope, per AGENTS.md's test-discipline rule: the param dialog reaches
// its widgets through `React.lazy` factories inside `@object-ui/fields`.
import '@object-ui/fields';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
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

/** HotCRM's `CreateCampaignAction`, the keys this chain reads: record-scoped. */
const CREATE_CAMPAIGN = {
  name: 'create_campaign',
  label: 'Add to Campaign',
  objectName: 'crm_lead',
  type: 'script',
  locations: ['list_toolbar', 'list_item'],
  params: [{ name: 'campaign', type: 'text', label: 'Campaign', required: true }],
};

/** A plain `list_toolbar` action: object-level, it runs with nothing selected. */
const REFRESH_SCORES = {
  name: 'refresh_scores',
  label: 'Refresh Scores',
  objectName: 'crm_lead',
  type: 'script',
  locations: ['list_toolbar'],
};

const LIST_VIEWS = {
  // HotCRM's wiring: the default Leads view names the action in `bulkActions`.
  all_leads: { name: 'all_leads', label: 'All Leads', type: 'grid', columns: ['name'], bulkActions: ['create_campaign'] },
  // The same action, wired through an authored `bulkActionDefs` entry instead.
  campaign_defs: {
    name: 'campaign_defs',
    label: 'Campaign Defs',
    type: 'grid',
    columns: ['name'],
    bulkActionDefs: [{ name: 'create_campaign', operation: 'custom', execution: 'aggregate' }],
  },
  // CONTROL: a view that does not wire it (HotCRM's `my_leads`).
  my_leads: { name: 'my_leads', label: 'My Leads', type: 'grid', columns: ['name'], selection: { type: 'multiple' } },
  // CONTROL: an OBJECT-LEVEL action wired as bulk.
  scoring: { name: 'scoring', label: 'Scoring', type: 'grid', columns: ['name'], bulkActions: ['refresh_scores'] },
};

const LEADS = [
  { id: 'lead_1', name: 'Ada' },
  { id: 'lead_2', name: 'Grace' },
  { id: 'lead_3', name: 'Linus' },
];

const OBJECTS = [
  {
    name: 'crm_lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    actions: [CREATE_CAMPAIGN, REFRESH_SCORES],
    listViews: LIST_VIEWS,
  },
];

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function mountLeads(viewName: keyof typeof LIST_VIEWS) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: LEADS, total: LEADS.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ConsoleToaster />
      <ExpressionProvider user={{ id: 'u1', name: 'Sales Manager' }}>
        <MemoryRouter initialEntries={[`/apps/crm/crm_lead/view/${viewName}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

/** The page header, once its schema-driven toolbar has drawn the plain action. */
async function headerWithToolbar(): Promise<HTMLElement> {
  const header = await screen.findByTestId('page-header', undefined, { timeout: 5000 });
  await within(header).findByRole('button', { name: /Refresh Scores/ }, { timeout: 5000 });
  return header;
}

/** The grid's row checkboxes, once it has drawn its rows. */
async function rowBoxes(): Promise<HTMLElement[]> {
  return waitFor(() => {
    const found = Array.from(document.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];
    expect(found).toHaveLength(LEADS.length);
    return found;
  }, { timeout: 5000 });
}

async function tickRows(n: number): Promise<void> {
  const boxes = await rowBoxes();
  for (const box of boxes.slice(0, n)) {
    await act(async () => { fireEvent.click(box); });
  }
}

const addToCampaignIn = (el: HTMLElement) => within(el).queryByRole('button', { name: /Add to Campaign/ });

describe('objectui#12462 — a bulk-wired, record-scoped list_toolbar action leaves the header for the selection bar', () => {
  it('the view wires it in `bulkActions`: the plain action stays in the header, Add to Campaign is only in the bar', async () => {
    mountLeads('all_leads');
    const header = await headerWithToolbar();
    await rowBoxes();

    // Zero rows: the header has the plain action and not the duplicate; no bar.
    expect(addToCampaignIn(header)).toBeNull();
    expect(screen.queryByTestId('bulk-actions-bar')).toBeNull();

    // Two rows: the bar floats carrying the action; the header still lacks it.
    await tickRows(2);
    const bar = await screen.findByTestId('bulk-actions-bar', undefined, { timeout: 5000 });
    expect(within(bar).getByTestId('bulk-action-create_campaign')).toHaveTextContent('Add to Campaign');
    expect(addToCampaignIn(header)).toBeNull();
    expect(within(header).getByRole('button', { name: /Refresh Scores/ })).toBeInTheDocument();

    // Clearing the selection hides the bar.
    await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: /Clear/ })); });
    await waitFor(() => expect(screen.queryByTestId('bulk-actions-bar')).toBeNull(), { timeout: 5000 });
  });

  it('the view wires it in a `bulkActionDefs` entry: the header lacks it, the bar carries it', async () => {
    mountLeads('campaign_defs');
    const header = await headerWithToolbar();
    expect(addToCampaignIn(header)).toBeNull();

    await tickRows(2);
    const bar = await screen.findByTestId('bulk-actions-bar', undefined, { timeout: 5000 });
    expect(within(bar).getByTestId('bulk-action-create_campaign')).toBeInTheDocument();
  });

  it('CONTROL — a view that does not wire it keeps the header button, and its bar does not carry it', async () => {
    mountLeads('my_leads');
    const header = await headerWithToolbar();
    expect(addToCampaignIn(header)).not.toBeNull();

    await tickRows(2);
    const bar = await screen.findByTestId('bulk-actions-bar', undefined, { timeout: 5000 });
    expect(within(bar).queryByTestId('bulk-action-create_campaign')).toBeNull();
    expect(addToCampaignIn(header)).not.toBeNull();
  });

  it('CONTROL — an object-level action wired as bulk keeps its header button (and is in the bar too)', async () => {
    mountLeads('scoring');
    const header = await headerWithToolbar();
    // The record-scoped action is not wired by this view, so it stays as well.
    expect(addToCampaignIn(header)).not.toBeNull();

    await tickRows(2);
    const bar = await screen.findByTestId('bulk-actions-bar', undefined, { timeout: 5000 });
    expect(within(bar).getByTestId('bulk-action-refresh_scores')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /Refresh Scores/ })).toBeInTheDocument();
  });
});

/**
 * What an ARMED link shows. `create_campaign` is record-scoped and the link
 * runs it as the page mounts, with no row selected, so the run is refused for
 * its row count before its param dialog opens (objectui#13384). This toast is
 * the run's observable: the link armed and the action ran.
 */
const ZERO_ROW_REFUSAL = 'This action runs on a single record — select a row first.';

describe('objectui#12462 — the deep link arms only what the header draws', () => {
  const linkTo = (viewName: string) =>
    window.history.replaceState(null, '', `/apps/crm/crm_lead/view/${viewName}?${NAV_RUN_ACTION_PARAM}=create_campaign`);
  const linkStillInUrl = () => new URLSearchParams(window.location.search).get(NAV_RUN_ACTION_PARAM);

  it('on the view that wires it as bulk, the link is not armed: nothing runs and the link stays in the URL', async () => {
    linkTo('all_leads');
    mountLeads('all_leads');
    // The header has drawn its toolbar and the grid its rows, so an armed link
    // would have run by now. `hidden: true`: an open param dialog takes the
    // page out of the accessibility tree, and this wait must not be what fails.
    const header = await screen.findByTestId('page-header', undefined, { timeout: 5000 });
    await within(header).findByRole('button', { name: /Refresh Scores/, hidden: true }, { timeout: 5000 });
    await rowBoxes();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(ZERO_ROW_REFUSAL)).toBeNull();
    expect(linkStillInUrl()).toBe('create_campaign');
  });

  it('CONTROL — on a view that does not wire it, the same link arms: the action runs and the link is consumed', async () => {
    linkTo('my_leads');
    mountLeads('my_leads');

    // It ran: with no row selected, the record-scoped action is refused before
    // its param dialog (objectui#13384), so no dialog opens.
    expect(await screen.findByText(ZERO_ROW_REFUSAL, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(linkStillInUrl()).toBeNull(), { timeout: 5000 });
  });
});
