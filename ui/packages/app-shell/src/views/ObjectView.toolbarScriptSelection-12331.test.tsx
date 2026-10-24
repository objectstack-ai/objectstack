/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12331 — a single-record script action placed in a list's
 * `list_toolbar` never drops a click.
 *
 * Filed from a browser pass of HotCRM's Leads list: "Add to Campaign", a
 * `type: 'script'` action with one param (a campaign picker), launched from the
 * HEADER toolbar. With 0 or 2 rows ticked the dialog closed and nothing
 * happened; with 1 row it dispatched and showed nothing.
 *
 * Everything here is the real chain: the real `ObjectView`, the real grid
 * publishing its checkbox selection into the runner context, the real
 * `action:bar` → `action:button` → `ActionRunner`, the real console action
 * runtime and its `script` handler (`@object-ui/core`'s
 * `resolveServerActionRecordId` decides the selection), the real
 * `ActionParamDialog` and the real `ConsoleToaster` (sonner is NOT mocked: what
 * is asserted is the toast in the DOM).
 *
 * What the measurement found: on this chain nothing drops the click. A
 * record-scoped action refuses 0 and 2 rows with a toast and sends nothing; one
 * row sends one request, and its result reaches the user through the runner's
 * success toast — the action's own copy, filled from the answer's
 * `${result.*}`, or the runner's generic line when it declares none.
 *
 * The last block replays HotCRM's own declaration: a `list_item` placement and
 * a FIELD-BACKED param, so the dialog draws a record picker and the toast
 * comes after a picker was used. It refuses and reports exactly as the plain
 * fixture does.
 *
 * objectui#13384 moved the refusal in front of the dialog: a launch the
 * dispatch would refuse for its row count is refused before the param dialog
 * opens (the runner asks the console handler's forwarded
 * `refuseBeforeInput`), so the 0- and 2-row cases below assert that no dialog
 * opened, beside the toast and the absent request. One row still opens it.
 *
 * "Record-scoped" is a declaration, not a guess: an action is single-record
 * when its `locations` include a record placement (`isRecordScopedAction`). An
 * action declared at `list_toolbar` alone is object-level, so zero rows
 * dispatches it with no record — pinned below as the control.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
// Module scope, per AGENTS.md's test-discipline rule: the dialog reaches `LookupField` through a
// `React.lazy` factory inside `@object-ui/fields`; this barrel statically
// re-exports the widget modules, so no `findBy` budget is spent loading one.
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
  // The script handler's authenticated fetch, routed to the stubbed global.
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

const ACTION_URL = '/api/v1/actions/crm_lead/create_campaign';

/** A record-scoped placement: the toolbar plus a record placement. */
const RECORD_SCOPED = ['list_toolbar', 'record_header'];
/** The declaration the card measured: the toolbar alone, i.e. object-level. */
const TOOLBAR_ONLY = ['list_toolbar'];

function crmLead(locations: string[], successMessage?: string) {
  return {
    name: 'crm_lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    actions: [
      {
        name: 'create_campaign',
        label: 'Add to Campaign',
        type: 'script',
        locations,
        ...(successMessage ? { successMessage } : {}),
        params: [{ name: 'campaign', type: 'text', label: 'Campaign', required: true }],
      },
    ],
    listViews: {
      all: { name: 'all', label: 'All', type: 'grid', columns: ['name'], selection: { type: 'multiple' } },
    },
  };
}

const LEADS = [
  { id: 'lead_1', name: 'Ada' },
  { id: 'lead_2', name: 'Grace' },
  { id: 'lead_3', name: 'Linus' },
];

const MULTI_ROW_REFUSAL = 'This action runs on a single record — select exactly one row.';
const ZERO_ROW_REFUSAL = 'This action runs on a single record — select a row first.';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The card's one-row answer: the lead was already a member, so the action
  // added none and skipped one.
  fetchSpy = vi.fn(async (url: unknown) => {
    const body = String(url).includes(ACTION_URL)
      ? { success: true, data: { count: 0, skipped: 1 } }
      : { data: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
  vi.unstubAllGlobals();
});

function mountLeads(locations: string[], successMessage?: string) {
  const objects = [crmLead(locations, successMessage)];
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: LEADS, total: LEADS.length })),
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
        <MemoryRouter initialEntries={['/apps/crm/crm_lead/view/all']}>
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

const actionCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes(ACTION_URL));
const postedBody = (i: number) => JSON.parse(String((actionCalls()[i][1] as RequestInit).body));

/** Tick the first `n` row checkboxes once the grid has drawn its rows. */
async function tickRows(n: number): Promise<void> {
  const boxes = await waitFor(() => {
    const found = Array.from(document.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];
    expect(found).toHaveLength(LEADS.length);
    return found;
  }, { timeout: 5000 });
  for (const box of boxes.slice(0, n)) {
    await act(async () => { fireEvent.click(box); });
  }
}

/** Click the HEADER toolbar's "Add to Campaign", fill the param, Confirm. */
async function launchFromHeader(): Promise<void> {
  const header = await screen.findByRole('toolbar', undefined, { timeout: 5000 });
  fireEvent.click(await within(header).findByRole('button', { name: /Add to Campaign/ }, { timeout: 5000 }));
  const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
  await waitFor(() => expect(dialog.querySelector('input')).not.toBeNull(), { timeout: 5000 });
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'cmp_webinar' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' })); });
}

/**
 * Click the HEADER toolbar's "Add to Campaign" for a launch that is refused for
 * its row count (objectui#13384): the refusal shows, and no dialog opened.
 */
async function launchRefusedFromHeader(refusal: string): Promise<void> {
  const toolbars = await screen.findAllByRole('toolbar', undefined, { timeout: 5000 });
  fireEvent.click(await within(toolbars[0]).findByRole('button', { name: /Add to Campaign/ }, { timeout: 5000 }));
  expect(await screen.findByText(refusal, undefined, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
}

describe('objectui#12331 — a record-scoped script action at list_toolbar, with a param', () => {
  it('0 rows: the refusal shows before any dialog, and no request is sent', async () => {
    mountLeads(RECORD_SCOPED);
    await tickRows(0);
    await launchRefusedFromHeader(ZERO_ROW_REFUSAL);

    expect(actionCalls()).toHaveLength(0);
  });

  it('2 rows: the refusal shows before any dialog, and no request is sent', async () => {
    mountLeads(RECORD_SCOPED);
    await tickRows(2);
    await launchRefusedFromHeader(MULTI_ROW_REFUSAL);

    expect(actionCalls()).toHaveLength(0);
  });

  it('1 row: exactly one request carries that row, and the result reaches the user', async () => {
    mountLeads(RECORD_SCOPED, `Added \${result.count}, skipped \${result.skipped}`);
    await tickRows(1);
    await launchFromHeader();

    expect(await screen.findByText('Added 0, skipped 1', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(actionCalls()).toHaveLength(1);
    expect(postedBody(0)).toEqual({ recordId: 'lead_1', params: { campaign: 'cmp_webinar' } });
  });

  it('1 row, an action that declares no copy: the runner\'s generic success line still shows', async () => {
    mountLeads(RECORD_SCOPED);
    await tickRows(1);
    await launchFromHeader();

    expect(await screen.findByText('Action completed successfully', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(actionCalls()).toHaveLength(1);
  });
});

describe('objectui#12331 — the refusal follows the `locations` declaration', () => {
  it('declared at list_toolbar alone, 2 rows: one dispatch cannot name two records, so it refuses before any dialog', async () => {
    mountLeads(TOOLBAR_ONLY);
    await tickRows(2);
    await launchRefusedFromHeader(MULTI_ROW_REFUSAL);

    expect(actionCalls()).toHaveLength(0);
  });

  it('control — declared at list_toolbar alone, 0 rows: object-level, so it dispatches with no record', async () => {
    mountLeads(TOOLBAR_ONLY);
    await tickRows(0);
    await launchFromHeader();

    expect(await screen.findByText('Action completed successfully', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(actionCalls()).toHaveLength(1);
    expect(postedBody(0)).toEqual({ params: { campaign: 'cmp_webinar' } });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* HotCRM's own declaration                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * HotCRM's `CreateCampaignAction` (objectstack-ai/hotcrm, `src/sales/actions/
 * lead.actions.ts`), with the keys this chain reads. It differs from the
 * fixture above in the two ways the card's reading could hinge on: the record
 * placement is `list_item`, and its one param is FIELD-BACKED, so the dialog
 * draws a record picker (a lookup to `crm_campaign`) instead of a text box.
 */
const HOTCRM_CREATE_CAMPAIGN = {
  name: 'create_campaign',
  label: 'Add to Campaign',
  objectName: 'crm_lead',
  type: 'script',
  locations: ['list_toolbar', 'list_item'],
  successMessage: 'Leads added to campaign!',
  refreshAfter: true,
  params: [{ field: 'crm_campaign', objectOverride: 'crm_campaign_member', label: 'Campaign', required: true }],
};

const CAMPAIGNS = [
  { id: 'cmp_webinar', name: 'Cloud Migration Webinar' },
  { id: 'cmp_summit', name: 'Partner Summit' },
];

const HOTCRM_OBJECTS = [
  {
    name: 'crm_lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    actions: [HOTCRM_CREATE_CAMPAIGN],
    listViews: {
      all: { name: 'all', label: 'All', type: 'grid', columns: ['name'], selection: { type: 'multiple' } },
    },
  },
  {
    name: 'crm_campaign_member',
    label: 'Campaign Member',
    fields: {
      crm_campaign: { type: 'lookup', label: 'Campaign', reference: 'crm_campaign', required: true },
      crm_lead: { type: 'lookup', label: 'Lead', reference: 'crm_lead' },
    },
  },
  {
    name: 'crm_campaign',
    label: 'Campaign',
    pluralLabel: 'Campaigns',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

/**
 * The page as the console mounts it: `ConsoleShell` puts a
 * `SchemaRendererProvider` carrying the data adapter above every route, and
 * that is where the dialog's record picker finds the source it queries.
 */
function mountHotcrmLeads() {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const rowsOf = (name: string) => (name === 'crm_campaign' ? CAMPAIGNS : name === 'crm_lead' ? LEADS : []);
  const dataSource = {
    find: vi.fn(async (name: string) => ({ data: rowsOf(name), total: rowsOf(name).length })),
    findOne: vi.fn(async (name: string, id: string) => rowsOf(name).find((r) => r.id === id) ?? null),
    getObjectSchema: vi.fn(async (name: string) => HOTCRM_OBJECTS.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  render(
    <I18nProvider instance={i18n}>
      <ConsoleToaster />
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ExpressionProvider user={{ id: 'u1', name: 'Sales Manager' }}>
          <MemoryRouter initialEntries={['/apps/crm/crm_lead/view/all']}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={<ObjectView dataSource={dataSource as never} objects={HOTCRM_OBJECTS} onEdit={() => {}} />}
              />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  return dataSource;
}

/**
 * Click the HEADER toolbar's "Add to Campaign", pick "Cloud Migration Webinar"
 * in the record picker, Confirm — the card's steps. `list_item` also draws the
 * action on every row, so the header's toolbar is the first one on the page.
 */
async function launchHotcrmFromHeader(): Promise<void> {
  const toolbars = await screen.findAllByRole('toolbar', undefined, { timeout: 5000 });
  fireEvent.click(await within(toolbars[0]).findByRole('button', { name: /Add to Campaign/ }, { timeout: 5000 }));
  const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
  fireEvent.click(await within(dialog).findByTestId('lookup-trigger-crm_campaign', undefined, { timeout: 5000 }));
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: /Cloud Migration Webinar/ }, { timeout: 5000 }));
  });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' })); });
}

describe('objectui#12331 — HotCRM\'s declaration: list_item placement, a field-backed record-picker param', () => {
  it('0 rows: the refusal shows before any dialog, and no request is sent', async () => {
    mountHotcrmLeads();
    await tickRows(0);
    // `list_item` also draws the action on every row; the header's toolbar is the first.
    await launchRefusedFromHeader(ZERO_ROW_REFUSAL);

    expect(actionCalls()).toHaveLength(0);
  });

  it('2 rows: the refusal shows before any dialog, and no request is sent', async () => {
    mountHotcrmLeads();
    await tickRows(2);
    await launchRefusedFromHeader(MULTI_ROW_REFUSAL);

    expect(actionCalls()).toHaveLength(0);
  });

  it('1 row: exactly one request carries the row and the picked campaign, and the declared successMessage shows', async () => {
    mountHotcrmLeads();
    await tickRows(1);
    await launchHotcrmFromHeader();

    expect(await screen.findByText('Leads added to campaign!', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(actionCalls()).toHaveLength(1);
    expect(postedBody(0)).toEqual({ recordId: 'lead_1', params: { crm_campaign: 'cmp_webinar' } });
  });
});
