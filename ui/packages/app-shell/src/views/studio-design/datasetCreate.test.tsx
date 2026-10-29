// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27518 — Studio's New dataset, beside the New report dialog's
 * dataset picker (`ReportCreateFields`) and the dashboard widget inspector's.
 *
 *  - what the dialog writes, judged by the spec (`buildDatasetSkeleton`);
 *  - the picker entry, and the empty-state line's condition: no dataset reads
 *    one of this package's objects, whatever else the catalog holds;
 *  - the post-create selection: the draft is saved in this package through
 *    the draft door, the catalog is read again, and the picker binds it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DatasetSchema } from '@objectstack/spec/ui';

const PKG = 'field_service';

let datasets: Array<Record<string, unknown>>;
let objects: Array<Record<string, unknown>>;
const WORK_ORDER = {
  name: 'fs_work_order',
  label: 'Work Order',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'select', label: 'Status', options: [{ value: 'new', label: 'New Request' }] },
    estimated_hours: { type: 'number', label: 'Estimated Hours' },
    site: { type: 'lookup', label: 'Site', reference: 'fs_site' },
    organization_id: { type: 'text', system: true, hidden: true },
  },
};

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'object' ? objects : datasets)),
  listDrafts: vi.fn(async () => [] as unknown[]),
  get: vi.fn(async (type: string, name: string) =>
    type === 'object' && name === WORK_ORDER.name ? WORK_ORDER : null,
  ),
  save: vi.fn(async (_type: string, _name: string, body: Record<string, unknown>) => {
    // The draft-overlaid list serves the draft from now on, as the server does.
    datasets = [...datasets, { ...body, _packageId: PKG, _draft: true }];
    return {};
  }),
  withPreviewDrafts: vi.fn(() => mockClient),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { buildDatasetSkeleton, datasetCandidateFields, StudioDatasetAuthoringContext } from './datasetCreate';
import { NO_REPORT_BINDING, ReportCreateFields, type ReportBinding } from './interfaceCreate';
import { DashboardWidgetInspector } from '../metadata-admin/inspectors/DashboardWidgetInspector';
import type { ObjectFieldInfo } from '../metadata-admin/previews/useObjectFields';
import { t } from '../metadata-admin/i18n';

const PLATFORM_DATASET = {
  name: 'sys_login_metrics',
  label: 'Logins',
  object: 'sys_user',
  measures: [{ name: 'count', aggregate: 'count' }],
  dimensions: [],
};

beforeEach(() => {
  datasets = [PLATFORM_DATASET];
  objects = [
    { name: WORK_ORDER.name, label: WORK_ORDER.label, _packageId: PKG, _draft: true },
    { name: 'sys_user', label: 'User', isSystem: true },
  ];
  vi.clearAllMocks();
});
afterEach(cleanup);

const FIELDS: ObjectFieldInfo[] = [
  { name: 'name', label: 'Name', type: 'text', hidden: false },
  { name: 'status', label: 'Status', type: 'select', hidden: false },
  { name: 'site', label: 'site', type: 'lookup', hidden: false },
  { name: 'estimated_hours', label: 'Estimated Hours', type: 'number', hidden: false },
  { name: 'count', label: 'Count', type: 'number', hidden: false },
  { name: '__search', label: '__search', type: 'select', hidden: true, system: true },
];

describe('what New dataset writes (objectstack#27518)', () => {
  it('the create seed, the author identity and object, a dimension per group-by field and a sum per total', () => {
    const { groupBy, totals } = datasetCandidateFields(FIELDS);
    expect(groupBy.map((f) => f.name)).toEqual(['status', 'site']);
    expect(totals.map((f) => f.name)).toEqual(['estimated_hours', 'count']);

    const body = buildDatasetSkeleton('work_orders', 'Work orders', 'fs_work_order', groupBy, totals);
    expect(body).toEqual({
      name: 'work_orders',
      label: 'Work orders',
      object: 'fs_work_order',
      dimensions: [
        { name: 'status', label: 'Status', field: 'status', type: 'string' },
        // A field with no label of its own writes none.
        { name: 'site', field: 'site', type: 'lookup' },
      ],
      measures: [
        // The seed's own count, label-less so the renderer names it.
        { name: 'count', aggregate: 'count' },
        { name: 'estimated_hours', label: 'Estimated Hours', aggregate: 'sum', field: 'estimated_hours' },
        // A measure name the seed holds is suffixed: names are unique.
        { name: 'count_sum', label: 'Count', aggregate: 'sum', field: 'count' },
      ],
    });
    expect(DatasetSchema.safeParse(body).success).toBe(true);
  });

  it('with no field picked it is a count over the object, and the spec takes it', () => {
    const body = buildDatasetSkeleton('work_orders', 'Work orders', 'fs_work_order', [], []);
    expect(body.dimensions).toEqual([]);
    expect(body.measures).toEqual([{ name: 'count', aggregate: 'count' }]);
    expect(DatasetSchema.safeParse(body).success).toBe(true);
  });

  it('CONTROL: the spec refuses a dataset with no object, which is why the dialog asks for one', () => {
    const { object: _object, ...noObject } = buildDatasetSkeleton('work_orders', 'Work orders', 'fs_work_order', [], []);
    expect(DatasetSchema.safeParse(noObject).success).toBe(false);
  });
});

const authoring = { packageId: PKG, onDraftSaved: vi.fn() };

function ReportHost() {
  const [value, setValue] = React.useState<ReportBinding>(NO_REPORT_BINDING);
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}`]}>
      <ReportCreateFields value={value} onChange={setValue} authoring={authoring} locale="en-US" />
      <output data-testid="binding">{JSON.stringify(value)}</output>
    </MemoryRouter>
  );
}

async function listed(testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

/** Open New dataset from `entry`, name it, group by Status, and save. */
async function createWorkOrders(entry: string) {
  fireEvent.click(await screen.findByTestId(`${entry}-open`));
  const dialog = await screen.findByRole('dialog', { name: t('engine.studio.interfaces.newDataset.title', 'en-US') });
  fireEvent.change(within(dialog).getByLabelText(t('engine.studio.interfaces.newDataset.nameLabel', 'en-US')), {
    target: { value: 'Work orders' },
  });
  // The package's one object is preselected; its draft fields are offered.
  fireEvent.click(await within(dialog).findByRole('checkbox', { name: /^Status\b/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: t('engine.studio.createDraft', 'en-US') }));
  await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
}

describe('the report dialog\'s New dataset entry (objectstack#27518)', () => {
  it('reads the draft-overlaid catalog and offers the entry under the picker', async () => {
    render(<ReportHost />);
    expect(await screen.findByTestId('create-report-dataset')).toBeInTheDocument();
    expect(screen.getByTestId('create-report-new-dataset-open')).toHaveTextContent(
      t('engine.studio.interfaces.newDataset.open', 'en-US'),
    );
    expect(mockClient.withPreviewDrafts).toHaveBeenCalledWith(true);
  });

  it('says no dataset reads this package\'s objects while only other datasets exist', async () => {
    render(<ReportHost />);
    expect(await screen.findByTestId('create-report-new-dataset-hint')).toHaveTextContent(
      t('engine.studio.interfaces.newDataset.noPackageDatasets', 'en-US'),
    );
    // The picker still offers the datasets there are.
    expect(screen.getByTestId('create-report-dataset')).toBeInTheDocument();
  });

  it('says nothing once a dataset reads one of the package\'s objects, and lists the package\'s first', async () => {
    datasets = [
      PLATFORM_DATASET,
      { name: 'work_orders', label: 'Work orders', object: WORK_ORDER.name, _packageId: PKG, _draft: true, measures: [], dimensions: [] },
    ];
    render(<ReportHost />);
    await screen.findByTestId('create-report-new-dataset-open');
    await waitFor(() => expect(mockClient.list).toHaveBeenCalledWith('object'));
    expect(screen.queryByTestId('create-report-new-dataset-hint')).toBeNull();
    const options = (await listed('create-report-dataset')).map((o) => o.textContent);
    expect(options).toEqual([
      t('engine.studio.interfaces.create.datasetPlaceholder', 'en-US'),
      'Work orders (work_orders)',
      'Logins (sys_login_metrics)',
    ]);
  });

  it('with no dataset at all, offers the entry and its line in place of the picker', async () => {
    datasets = [];
    render(<ReportHost />);
    expect(await screen.findByTestId('create-report-new-dataset-hint')).toBeInTheDocument();
    expect(screen.getByTestId('create-report-new-dataset-open')).toBeInTheDocument();
    expect(screen.queryByTestId('create-report-dataset')).toBeNull();
  });

  it('saves the draft in this package, re-reads the catalog and binds the new dataset', async () => {
    render(<ReportHost />);
    await createWorkOrders('create-report-new-dataset');
    expect(mockClient.save).toHaveBeenCalledWith(
      'dataset',
      'work_orders',
      {
        name: 'work_orders',
        label: 'Work orders',
        object: WORK_ORDER.name,
        dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
        measures: [{ name: 'count', aggregate: 'count' }],
      },
      { mode: 'draft', packageId: PKG, ifNoneMatch: '*', surface: 'studio' },
    );
    expect(authoring.onDraftSaved).toHaveBeenCalledWith({ type: 'dataset', name: 'work_orders' });
    await waitFor(() =>
      expect(screen.getByTestId('binding')).toHaveTextContent('{"dataset":"work_orders","measure":""}'),
    );
    expect(await screen.findByTestId('create-report-dataset')).toHaveTextContent('Work orders (work_orders)');
    // Its measure is offered at once: the re-read catalog carries the draft's body.
    expect((await listed('create-report-measure')).map((o) => o.textContent)).toContain('count');
    expect(screen.queryByTestId('create-report-new-dataset-hint')).toBeNull();
  });

  it('refuses a name a dataset already holds, and writes nothing', async () => {
    mockClient.listDrafts.mockResolvedValueOnce([{ name: 'work_orders', packageId: 'other' }]);
    render(<ReportHost />);
    fireEvent.click(await screen.findByTestId('create-report-new-dataset-open'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('engine.studio.interfaces.newDataset.nameLabel', 'en-US')), {
      target: { value: 'Work orders' },
    });
    await within(dialog).findByRole('checkbox', { name: /^Status\b/ });
    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.studio.createDraft', 'en-US') }));
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument();
    expect(mockClient.save).not.toHaveBeenCalled();
  });
});

describe('the widget inspector\'s New dataset entry (objectstack#27518)', () => {
  function renderWidget(onPatch: (patch: Record<string, unknown>) => void, inStudio: boolean) {
    const inspector = (
      <DashboardWidgetInspector
        type="dashboard"
        name="ops"
        locale="en-US"
        readOnly={false}
        draft={{ widgets: [{ id: 'w1', type: 'bar', title: 'Hours' }] }}
        selection={{ kind: 'widget', id: 'w1' }}
        onPatch={onPatch}
        onClearSelection={vi.fn()}
      />
    );
    return render(
      <MemoryRouter initialEntries={[`/studio/${PKG}`]}>
        {inStudio ? (
          <StudioDatasetAuthoringContext.Provider value={authoring}>{inspector}</StudioDatasetAuthoringContext.Provider>
        ) : (
          inspector
        )}
      </MemoryRouter>,
    );
  }

  it('creates a dataset in the package and binds the widget to it', async () => {
    const onPatch = vi.fn();
    renderWidget(onPatch, true);
    expect(await screen.findByTestId('widget-new-dataset-hint')).toBeInTheDocument();
    await createWorkOrders('widget-new-dataset');
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({ widgets: [{ id: 'w1', type: 'bar', title: 'Hours', dataset: 'work_orders' }] }),
    );
  });

  it('outside the Studio there is no entry, and the catalog is the published one', async () => {
    renderWidget(vi.fn(), false);
    await waitFor(() => expect(mockClient.list).toHaveBeenCalledWith('dataset'));
    expect(screen.queryByTestId('widget-new-dataset-open')).toBeNull();
    expect(mockClient.withPreviewDrafts).not.toHaveBeenCalled();
  });
});
