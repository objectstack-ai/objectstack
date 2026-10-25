// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11576, the dialog's SECOND persisting door: `ObjectView`'s
 * `handleViewCreate`, reached from the view tab bar's add button. The first
 * door (`ObjectDataPage.buildSaveAsViewSpec`, "Save as view") is pinned in
 * `CreateViewDialog.chartBinding-11576.test.tsx`; the two doors assemble the
 * spec separately, so each is pinned on its own.
 *
 * The real `ObjectView` and the real dialog run; only the metadata client is a
 * stub, so the body asserted is the one `createRuntimeMetadata` hands
 * `metadataClient.save`. Then the saved view is mounted as the object's list
 * view and the `object-chart` node `ObjectView` builds for it is captured: a
 * created chart view must render through the ADR-0021 dataset branch, with the
 * binding the dialog wrote.
 *
 * Direction, written before the run: on the unmodified tree the door case goes
 * RED (no dataset picker; the saved block carries `xAxisField` /
 * `yAxisFields` and fails `ListViewSchema`), and the render case goes RED
 * because it renders what the door saved.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ListViewSchema, ViewItemSchema } from '@objectstack/spec/ui';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: `ListView` names `perms` in its fetch dependencies.
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
  // The add-view button and the dialog are admin-only.
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
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

/** The `object-chart` node `ObjectView` builds, captured on its way in. */
let capturedChartSchema: any = null;
vi.mock('@object-ui/plugin-charts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectChart: (props: any) => {
    capturedChartSchema = props.schema;
    return null;
  },
  ChartRenderer: () => null,
}));

/** A served dataset over `crm_deal`, and one over another object. */
const DATASETS = [
  {
    name: 'deal_metrics',
    label: 'Deal metrics',
    object: 'crm_deal',
    dimensions: [{ name: 'stage', field: 'stage' }],
    measures: [
      { name: 'total_amount', aggregate: 'sum', field: 'amount' },
      { name: 'deal_count', aggregate: 'count' },
    ],
  },
  {
    name: 'account_metrics',
    label: 'Account metrics',
    object: 'crm_account',
    dimensions: [{ name: 'industry', field: 'industry' }],
    measures: [{ name: 'account_count', aggregate: 'count' }],
  },
];

// The metadata seam's client: `createRuntimeMetadata` writes through `save`;
// the dialog's catalog reads through `list` / `get`.
const metadataClient = {
  save: vi.fn(async () => ({})),
  get: vi.fn(async (type: string, name: string) =>
    type === 'dataset' ? (DATASETS.find((d) => d.name === name) ?? null) : null),
  list: vi.fn(async (type: string) => (type === 'dataset' ? DATASETS : [])),
};
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => metadataClient,
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'crm_deal';
const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
  amount: { type: 'number', label: 'Amount' },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
  } as any;
}

function mount(listViews: Record<string, unknown>) {
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/*"
            element={
              <ObjectView
                dataSource={makeDataSource()}
                objects={[{ name: OBJECT_NAME, label: 'Deal', fields: FIELDS, listViews }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
/** The config pick for `key`: the shared Select's trigger (objectui#11865). */
const picker = (key: string) => screen.getByTestId(`create-view-required-${key}`);

/** Open `key`'s picker from the keyboard and return the options it lists. */
async function openPicker(key: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(picker(key), { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

/** The labels `key`'s picker lists, in order; it is closed again after. */
async function optionLabels(key: string): Promise<string[]> {
  const labels = (await openPicker(key)).map((o) => o.textContent ?? '');
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return labels;
}

/** Create a chart view through the tab bar's add button; return the saved body. */
async function createChartViewThroughTheTabBar() {
  mount({ [`${OBJECT_NAME}.all`]: { name: `${OBJECT_NAME}.all`, label: 'All', type: 'grid', columns: ['name'] } });
  await settle();
  fireEvent.click(screen.getByTestId('view-tab-add'));
  const card = await screen.findByTestId('create-view-type-chart');
  await waitFor(() => expect((card as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(card);
  await waitFor(() => expect(picker('values')).toBeEnabled());
  expect((await optionLabels('dataset')).filter((label) => label.includes('account_metrics'))).toEqual([]);
  const measure = (await openPicker('values')).find((o) => o.textContent === 'total_amount');
  if (!measure) throw new Error('the measure picker lists no "total_amount"');
  fireEvent.click(measure);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  await act(async () => {
    fireEvent.click(screen.getByTestId('create-view-submit'));
  });
  await waitFor(() => expect(metadataClient.save).toHaveBeenCalledTimes(1));
  const [type, , body, opts] = metadataClient.save.mock.calls[0] as unknown as [string, string, any, any];
  expect(type).toBe('view');
  expect(opts).toEqual({ mode: 'draft' });
  return body;
}

beforeEach(() => {
  cleanup();
  capturedChartSchema = null;
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

describe('ObjectView.handleViewCreate saves the ADR-0021 chart block the dialog wrote (objectui#11576)', () => {
  it('DOOR 2: the saved config passes the spec ListViewSchema, the envelope the ViewItem gate, and no legacy key rides', async () => {
    const body = await createChartViewThroughTheTabBar();
    // The spec's verdict first: it is the claim this pin exists for.
    const listView = ListViewSchema.safeParse(body.config);
    expect(listView.success, JSON.stringify(listView.error?.issues)).toBe(true);
    const item = ViewItemSchema.safeParse(body);
    expect(item.success, JSON.stringify(item.error?.issues)).toBe(true);
    expect(body.config.chart).toEqual({
      chartType: 'bar',
      dataset: 'deal_metrics',
      values: ['total_amount'],
      dimensions: ['stage'],
    });
    expect(Object.keys(body.config.chart)).not.toContain('xAxisField');
    expect(Object.keys(body.config.chart)).not.toContain('yAxisFields');
  });

  it('the saved view renders on the object page through the dataset branch', async () => {
    const body = await createChartViewThroughTheTabBar();
    cleanup();
    capturedChartSchema = null;
    mount({ [body.name]: { name: body.name, label: body.label, ...body.config } });
    await waitFor(() => expect(capturedChartSchema?.type).toBe('object-chart'));
    expect(capturedChartSchema).toMatchObject({
      dataset: 'deal_metrics',
      values: ['total_amount'],
      dimensions: ['stage'],
      chartType: 'bar',
    });
    // The dataset branch carries no object binding of its own; the legacy
    // inline branch would have (`objectName` + `aggregate`).
    expect(capturedChartSchema.objectName).toBeUndefined();
    expect(capturedChartSchema.aggregate).toBeUndefined();
  });
});
