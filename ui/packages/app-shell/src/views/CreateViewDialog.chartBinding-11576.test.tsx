// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11576: the Create View dialog authors the spec's ADR-0021 chart
 * binding (`chartType` + `dataset` + `values`, plus `dimensions` where the
 * chosen dataset declares any), and nothing else.
 *
 * ## The defect this pins
 *
 * The dialog wrote a chart view as `chart: { chartType, xAxisField,
 * yAxisFields }`. `@objectstack/spec`'s `ListChartConfigSchema` is a strict
 * object that requires `dataset` and `values` and refuses those two keys by
 * name, so the platform's view write door refused every chart view the console
 * created. Measured before the fix through the "Save as view" door (the last
 * describe below, which replays the spec's own view gate at the network
 * boundary): the PUT answered 422, the dialog had already closed, the page did
 * not move, and nothing told the user.
 *
 * ## The source of the dataset list
 *
 * The picker reads `useDatasetCatalog` (every dataset the metadata client
 * lists) and offers only the datasets whose base `object` is this view's
 * object, then resolves the chosen dataset's measures and dimensions through
 * `useDatasetSemantics`, the dashboard widget editor's pair. The fixtures
 * below serve one dataset for this object and one for ANOTHER object; the
 * foreign one must never be offered.
 *
 * ## What the pins assert, and the direction written before the run
 *
 * The payload pins assert the spec's verdict (`ListViewSchema`, and the record
 * gate `ViewItemSchema` on the envelope) and the absence of the two legacy
 * keys. Predicted on the unmodified tree: every case that opens the chart
 * picker goes RED (there is no dataset picker, and the payload carries the
 * axis keys), the door case goes RED on its 422, and the fixture control stays
 * GREEN in both worlds. The `ObjectView.handleViewCreate` door and the render
 * on the object page are pinned next door, in
 * `ObjectView.createChartView-11576.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { DatasetSchema, ListViewSchema, ViewItemSchema } from '@objectstack/spec/ui';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { MetadataClient } from '@object-ui/data-objectstack';

/** A served dataset over THIS view's object: one dimension, two measures. */
const DEAL_METRICS = {
  name: 'deal_metrics',
  label: 'Deal metrics',
  object: 'crm_deal',
  dimensions: [{ name: 'stage', label: 'Stage', field: 'stage' }],
  measures: [
    { name: 'total_amount', label: 'Total amount', aggregate: 'sum', field: 'amount' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
  ],
};
/** A served dataset over ANOTHER object: never offered on a `crm_deal` view. */
const ACCOUNT_METRICS = {
  name: 'account_metrics',
  label: 'Account metrics',
  object: 'crm_account',
  dimensions: [{ name: 'industry', field: 'industry' }],
  measures: [{ name: 'account_count', aggregate: 'count' }],
};
/** A served dataset over this object that declares no dimension. */
const DEAL_TOTALS = {
  name: 'deal_totals',
  label: 'Deal totals',
  object: 'crm_deal',
  dimensions: [],
  measures: [{ name: 'pipeline_value', aggregate: 'sum', field: 'amount' }],
};

let servedDatasets: Array<Record<string, unknown>> = [];
const puts: Array<{ url: string; body: any; status: number }> = [];
const datasetLists: string[] = [];

/**
 * The metadata wire, replayed: `GET …/meta/dataset` lists the served
 * documents, `GET …/meta/dataset/NAME` answers one, and `PUT …/meta/view/NAME`
 * runs the installed spec's view gate, answering the dispatcher's 422
 * `INVALID_METADATA` envelope on refusal, as the platform's write door does.
 */
function wire() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname;
    if (init?.method === 'PUT' && path.includes('/meta/view/')) {
      const body = JSON.parse(String(init.body));
      const verdict = getMetadataTypeSchema('view')!.safeParse(body);
      puts.push({ url: input, body, status: verdict.success ? 200 : 422 });
      return verdict.success
        ? new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(
            JSON.stringify({
              success: false,
              error: { code: 'INVALID_METADATA', message: 'view failed validation', details: { code: 'INVALID_METADATA', issues: verdict.error.issues } },
            }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          );
    }
    if (path.endsWith('/meta/dataset')) {
      datasetLists.push(path);
      return new Response(JSON.stringify(servedDatasets), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const one = path.match(/\/meta\/dataset\/([^/]+)$/);
    if (one) {
      const doc = servedDatasets.find((d) => d.name === decodeURIComponent(one[1]));
      return new Response(JSON.stringify(doc ?? null), { status: doc ? 200 : 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
let wireFetch: ReturnType<typeof wire>;
/** One client per test, as `useMetadataClient` memoises one per mount. */
let client: MetadataClient;

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }), checkField: () => true, getFieldPermissions: () => [],
      getRowFilter: () => undefined, getObjectApiOperations: () => undefined, roles: [], isLoaded: false,
      hasCapabilities: () => true, can: () => true, cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { CreateViewDialog } from './CreateViewDialog';
import { toCatalogEntry } from './metadata-admin/previews/useDatasetCatalog';
import { ObjectDataPage, buildSaveAsViewSpec } from './ObjectDataPage';
import { viewEnvelope } from './runtime-metadata-persistence';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const DEAL = {
  name: 'crm_deal',
  label: 'Deal',
  managedBy: 'platform',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
    amount: { type: 'number', label: 'Amount' },
  },
};
const COLUMNS = ['name', 'stage', 'amount'];
const LEGACY_KEYS = ['xAxisField', 'yAxisFields'];

/** The config pick for `key`: the shared Select's trigger (objectui#11865). */
const picker = (key: string) => screen.getByTestId(`create-view-required-${key}`);

/** The labels `key`'s picker lists, in order, read by opening it from the keyboard; it is closed again after. */
async function optionLabels(key: string): Promise<string[]> {
  fireEvent.keyDown(picker(key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return labels;
}

/** Pick the option labelled `label` in `key`'s picker, once the picker is enabled. */
async function pick(key: string, label: string) {
  await waitFor(() => expect(picker(key)).toBeEnabled());
  fireEvent.keyDown(picker(key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const option = within(listbox).getAllByRole('option').find((o) => o.textContent === label);
  if (!option) throw new Error(`${key} lists no "${label}"`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

/** Open the dialog on `crm_deal`, pick Chart, and wait for this object's catalog. */
async function openChartPicker(onCreate = vi.fn()) {
  render(<CreateViewDialog open onOpenChange={() => {}} onCreate={onCreate} objectDef={DEAL} />);
  await waitFor(() => expect((screen.getByTestId('create-view-type-chart') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('create-view-type-chart'));
  return onCreate;
}

/** Pick the measure labelled `measure` in the open chart picker and press Create. */
async function pickMeasureAndCreate(measure: string) {
  await pick('values', measure);
  const submit = screen.getByTestId('create-view-submit') as HTMLButtonElement;
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
}

/** Pick the measure labelled `measure`, submit, and return the payload the dialog handed `onCreate`. */
async function submitWithMeasure(onCreate: ReturnType<typeof vi.fn>, measure: string) {
  await pickMeasureAndCreate(measure);
  expect(onCreate).toHaveBeenCalledTimes(1);
  return onCreate.mock.calls[0][0] as Record<string, any>;
}

/** Assert the spec accepts `body`, surfacing its issues when it does not. */
function expectAccepted(schema: { safeParse: (v: unknown) => any }, body: unknown) {
  const verdict = schema.safeParse(body);
  expect(verdict.success, `refused by the spec: ${JSON.stringify(verdict.error?.issues)}\nbody=${JSON.stringify(body)}`).toBe(true);
}

beforeEach(() => {
  cleanup();
  servedDatasets = [DEAL_METRICS, ACCOUNT_METRICS];
  puts.length = 0;
  datasetLists.length = 0;
  wireFetch = wire();
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wireFetch as any });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the served fixtures are datasets the spec accepts (control, objectui#11576)', () => {
  it.each([DEAL_METRICS, ACCOUNT_METRICS, DEAL_TOTALS])('$name parses as a DatasetSchema document', (doc) => {
    expectAccepted(DatasetSchema, doc);
  });
});

describe('the catalog reader carries each dataset\'s base object (objectui#11576)', () => {
  it('keeps the served `object`, and leaves it absent when none is served', () => {
    expect(toCatalogEntry(DEAL_METRICS, 'en-US')?.object).toBe('crm_deal');
    const bare = toCatalogEntry({ name: 'names_only' }, 'en-US');
    expect(bare).not.toBeNull();
    expect(bare && 'object' in bare).toBe(false);
  });
});

describe('the chart picker offers only the datasets this object exposes (objectui#11576)', () => {
  it('lists the dataset over crm_deal, never the one over crm_account', async () => {
    await openChartPicker();
    // The one dataset this object exposes is picked for the user, as a single
    // eligible field is for every other view type.
    await waitFor(() => expect(picker('dataset')).toHaveTextContent('Deal metrics (deal_metrics)'));
    const datasets = await optionLabels('dataset');
    expect(datasets).toContain('Deal metrics (deal_metrics)');
    expect(datasets.filter((label) => label.includes('account_metrics'))).toEqual([]);
  });

  it('offers the chosen dataset\'s own measures and dimensions', async () => {
    await openChartPicker();
    await waitFor(() => expect(picker('values')).toBeEnabled());
    expect(await optionLabels('values')).toEqual(['console.objectView.selectOption', 'Total amount', 'Deals']);
    expect(await optionLabels('dimensions')).toEqual(['console.objectView.selectOption', 'Stage']);
    expect(screen.queryByTestId('create-view-required-xAxisField')).toBeNull();
    expect(screen.queryByTestId('create-view-required-yAxisFields')).toBeNull();
  });

  it('disables the chart type when the object exposes no dataset, through the "type unavailable" path', async () => {
    servedDatasets = [ACCOUNT_METRICS];
    render(<CreateViewDialog open onOpenChange={() => {}} onCreate={vi.fn()} objectDef={DEAL} />);
    await waitFor(() => expect(datasetLists.length).toBeGreaterThan(0));
    const card = screen.getByTestId('create-view-type-chart') as HTMLButtonElement;
    await waitFor(() => expect(card.disabled).toBe(true));
    // The reason is on the card and is its accessible description, not a
    // `title` on a disabled button (objectui#13141).
    expect(within(card).getByText('console.objectView.viewTypeUnavailableDataset')).toBeTruthy();
    expect(card).toHaveAccessibleDescription('console.objectView.viewTypeUnavailableDataset');
  });

  it('fetches no catalog while the dialog is closed', async () => {
    render(<CreateViewDialog open={false} onOpenChange={() => {}} onCreate={vi.fn()} objectDef={DEAL} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(datasetLists).toEqual([]);
  });
});

describe('the chart payload is the spec ListView chart block (objectui#11576)', () => {
  it('writes chartType + dataset + values + dimensions, and no legacy axis key', async () => {
    const payload = await submitWithMeasure(await openChartPicker(), 'Total amount');
    expect(payload.type).toBe('chart');
    expect(payload.chart).toEqual({
      chartType: 'bar',
      dataset: 'deal_metrics',
      values: ['total_amount'],
      dimensions: ['stage'],
    });
    for (const key of LEGACY_KEYS) expect(Object.keys(payload.chart)).not.toContain(key);
  });

  it('omits `dimensions` when the chosen dataset declares none', async () => {
    servedDatasets = [DEAL_TOTALS];
    const payload = await submitWithMeasure(await openChartPicker(), 'pipeline_value');
    expectAccepted(ListViewSchema, buildSaveAsViewSpec(payload, COLUMNS, []));
    expect(screen.queryByTestId('create-view-required-dimensions')).toBeNull();
    expect(payload.chart).toEqual({ chartType: 'bar', dataset: 'deal_totals', values: ['pipeline_value'] });
  });

  it('DOOR 1, ObjectDataPage.buildSaveAsViewSpec: the spec ListViewSchema and the ViewItem gate accept it', async () => {
    const payload = await submitWithMeasure(await openChartPicker(), 'Total amount');
    const spec = buildSaveAsViewSpec(payload, COLUMNS, []);
    expectAccepted(ListViewSchema, spec);
    expectAccepted(ViewItemSchema, viewEnvelope('crm_deal', spec, { name: payload.name, label: payload.label }));
    for (const key of LEGACY_KEYS) expect(Object.keys(spec.chart)).not.toContain(key);
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

describe('the save door answers 2xx for a chart view created through "Save as view" (objectui#11576)', () => {
  it('PUTs the ADR-0021 block, the spec view gate accepts it, and the user lands on the new draft', async () => {
    render(
      <ExpressionProvider user={{ id: 'u1', name: 'Ada' }}>
        <MemoryRouter initialEntries={['/apps/demo/crm_deal/data']}>
          <Routes>
            <Route path="/apps/:appName/:objectName/data" element={<ObjectDataPage dataSource={{ find: vi.fn(async () => ({ data: [] })) }} objects={[DEAL]} />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>,
    );
    fireEvent.click(screen.getByTestId('object-data-save-as-view'));
    await waitFor(() => expect((screen.getByTestId('create-view-type-chart') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('create-view-type-chart'));
    await pickMeasureAndCreate('Total amount');
    await waitFor(() => expect(puts).toHaveLength(1));
    // The door's verdict first: before this card it answered 422 here.
    expect(puts[0].status).toBe(200);
    expect(puts[0].body.config.chart).toEqual({
      chartType: 'bar',
      dataset: 'deal_metrics',
      values: ['total_amount'],
      dimensions: ['stage'],
    });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/\/view\/crm_deal\.[a-z0-9_]+\?preview=draft$/));
  });
});
