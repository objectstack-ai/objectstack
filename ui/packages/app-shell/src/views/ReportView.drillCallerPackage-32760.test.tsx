/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#32760 — the report drill's definition read, on
 * the path where no exact drill filter arrives, is made as the report's reader
 * (ADR-0150 D3, `callerPackage`), the dataset the report's own queries resolve.
 *
 * ## Why the path is live
 *
 * `ReportView.handleDatasetDrill` navigates straight away when the renderer
 * hands it an `objectFilter`. Without one it reads the dataset definition and
 * rebuilds the filter from the clicked group. That path is not only an older
 * server's: the current server names the `object` on every dataset answer but
 * sends no drill metadata for a `type: 'date'` dimension with no
 * `dateGranularity` (no equality field, no range), so a click on a report
 * grouped by one lands there. The legs below drive the REAL report renderer
 * with that answer and click the row, so the path is reached the way a user
 * reaches it. The definition read used to name no package: for a report in
 * package P it read the bare name, which another holder of the name answers,
 * or which is refused when two packages hold it.
 *
 * ## Discrimination
 *
 * `READS_AS_THE_REPORTS_READER` reds on the bare read the fix replaced.
 * `ENVIRONMENT_REPORT_READS_BARE` reds if a package-less report sent one.
 * `REFUSAL_IS_NO_DRILL` reds on a bare retry after a refusal.
 * `FAST_PATH_CONTROL`: an answer with drill metadata reads no definition.
 */

import '@testing-library/jest-dom/vitest';
// The report body sits behind `ReportView`'s `React.lazy` boundary: import it
// at module scope (same specifier) so the lazy factory resolves at once.
import '@object-ui/plugin-report';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { DataSource } from '@object-ui/types';

vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: ({ open, objectName, filter }: { open: boolean; objectName: string; filter?: unknown }) =>
    open ? <div data-testid="drill-target">{JSON.stringify({ objectName, filter })}</div> : null,
}));
vi.mock('./ReportConfigPanel', () => ({ ReportConfigPanel: () => null }));

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

const client = vi.hoisted(() => ({ get: undefined as unknown as ReturnType<typeof vi.fn> }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => client }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'task_due_report' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/report/task_due_report', search: '' }),
}));
vi.mock('./useOpenRecordList', () => ({
  useRecordListDrillNavigation: () => ({ openRecordList: vi.fn(), canOpenRecordList: () => true }),
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('./runtime-metadata-persistence', () => ({ persistRuntimeMetadata: vi.fn() }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

import { ReportView } from './ReportView';

// The report body's own metadata probes (the dimension option read of the
// answer's `object`) answer from this double, never the network. Installed
// once for the whole file and never torn down, so no read that settles after a
// test body returns can reach a real socket. It answers no document, so the
// labels stay raw.
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));

/** A report grouped by a date dimension with no granularity, served from package `com.acme.app`. */
const PACKAGE_REPORT = {
  name: 'task_due_report',
  label: 'Tasks by due date',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['due'],
  values: ['task_count'],
  _packageId: 'com.acme.app',
};

/** The definition the reader's read resolves: `due` is a `type: 'date'` dimension with no granularity. */
const DEFINITION = {
  name: 'task_metrics',
  object: 'task',
  dimensions: [{ name: 'due', field: 'due_date', type: 'date' }],
  measures: [{ name: 'task_count', aggregate: 'count' }],
};

/**
 * The current server's answer for that report: the `object` and the measure's
 * drill scope, but no `dimensionFields` / `drillRawRows` (a date dimension is
 * not an equality drill) and no `drillRanges` (it has no granularity).
 */
const DATE_DIM_ANSWER = {
  rows: [{ due: '2026-03-01', task_count: 3 }],
  fields: [{ name: 'due', label: 'Due' }, { name: 'task_count', label: 'Tasks' }],
  object: 'task',
  drillScopes: { task_count: {} },
};

function renderReport(report: Record<string, unknown>, answer: Record<string, unknown>) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [report],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    queryDataset: vi.fn(async () => answer),
  } as unknown as DataSource;
  return render(<ReportView dataSource={dataSource} />);
}

beforeEach(() => {
  client.get = vi.fn(async () => DEFINITION);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectstack#32760 — the report drill reads its dataset as the report\'s reader', () => {
  it('READS_AS_THE_REPORTS_READER — a click on a date-grouped row reads the definition with callerPackage and drills', async () => {
    renderReport(PACKAGE_REPORT, DATE_DIM_ANSWER);
    fireEvent.click(await screen.findByTestId('dataset-drill-row'));
    const target = await screen.findByTestId('drill-target');
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('dataset', 'task_metrics', { callerPackage: 'com.acme.app' });
    expect(JSON.parse(target.textContent ?? '')).toEqual({ objectName: 'task', filter: { due_date: '2026-03-01' } });
  });

  it('ENVIRONMENT_REPORT_READS_BARE — a report authored in the environment names no package', async () => {
    const { _packageId: _omit, ...environmentReport } = PACKAGE_REPORT;
    renderReport(environmentReport, DATE_DIM_ANSWER);
    fireEvent.click(await screen.findByTestId('dataset-drill-row'));
    await screen.findByTestId('drill-target');
    expect(client.get).toHaveBeenCalledWith('dataset', 'task_metrics', {});
  });

  it('REFUSAL_IS_NO_DRILL — a refused read opens nothing and is never retried bare', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    client.get = vi.fn(async () => {
      throw Object.assign(new Error('held by 2 packages'), { status: 409, code: 'RESOURCE_CONFLICT' });
    });
    renderReport(PACKAGE_REPORT, DATE_DIM_ANSWER);
    fireEvent.click(await screen.findByTestId('dataset-drill-row'));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('ReportView: drill failed', expect.any(Error)));
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('dataset', 'task_metrics', { callerPackage: 'com.acme.app' });
    expect(screen.queryByTestId('drill-target')).toBeNull();
  });

  it('FAST_PATH_CONTROL — an answer with drill metadata drills with no definition read', async () => {
    renderReport(
      { ...PACKAGE_REPORT, rows: ['status'] },
      {
        rows: [{ status: 'Open', task_count: 3 }],
        fields: [{ name: 'status', label: 'Status' }, { name: 'task_count', label: 'Tasks' }],
        object: 'task',
        dimensionFields: { status: 'status' },
        drillRawRows: [{ status: 'open' }],
        drillScopes: { task_count: {} },
      },
    );
    fireEvent.click(await screen.findByTestId('dataset-drill-row'));
    const target = await screen.findByTestId('drill-target');
    expect(JSON.parse(target.textContent ?? '')).toEqual({ objectName: 'task', filter: { status: 'open' } });
    expect(client.get).not.toHaveBeenCalled();
  });
});
