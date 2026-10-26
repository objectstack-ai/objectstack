/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10684 — the report view's runtime rows belong to the CURRENT run of
 * its data effect only.
 *
 * The effect read `dataSource.find(…)` and committed `setReportRuntimeData`
 * with no current-run check, so when the report changed while a read was in
 * flight (here: another report on the same route, which keeps the view
 * mounted), the earlier report's answer could land AFTER the current one and
 * replace its rows.
 *
 * Measured at the one seam this view owns: the `rows` it hands the report
 * renderer. The renderer, the config panel and the drill drawer are stubbed
 * the way `ReportView.dataSourceObjectKey.test.tsx` stubs them. Every `find`
 * is held open by hand and settled in the order each case names, so no case
 * depends on a timer.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

/** Props the (stubbed) report renderer was handed last. */
const cap = vi.hoisted(() => ({ renderer: null as any }));

vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: (props: any) => {
    cap.renderer = props;
    return null;
  },
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: () => null,
}));
vi.mock('./ReportConfigPanel', () => ({ ReportConfigPanel: () => null }));

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

/** The route's `reportName`, moved by hand the way a navigation moves it. */
const route = vi.hoisted(() => ({ reportName: 'report_a' }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: route.reportName }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: `/reports/${route.reportName}`, search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({ get: vi.fn() }) }));
vi.mock('./runtime-metadata-persistence', () => ({ persistRuntimeMetadata: vi.fn() }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string) => k }),
  createSafeTranslation: (defaults: Record<string, string>) => () => ({
    t: (k: string) => defaults?.[k] ?? k,
  }),
}));

import { ReportView } from './ReportView';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every `find` returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const finds: Deferred<any>[] = [];
  const find = vi.fn((_objectName: string, _params?: Record<string, unknown>) => {
    const d = deferred<any>();
    finds.push(d);
    return d.promise;
  });
  return { dataSource: { find }, finds };
}

async function answer(d: Deferred<any>, name: string) {
  await act(async () => {
    d.resolve({ data: [{ id: name, name }] });
    await Promise.resolve();
  });
}

const REPORTS = [
  { name: 'report_a', label: 'Report A', dataSource: { object: 'acct' } },
  { name: 'report_b', label: 'Report B', dataSource: { object: 'other' } },
];

beforeEach(() => {
  cap.renderer = null;
  route.reportName = 'report_a';
  meta.value = {
    apps: [],
    objects: [
      { name: 'acct', label: 'Account', fields: {} },
      { name: 'other', label: 'Other', fields: {} },
    ],
    dashboards: [],
    reports: REPORTS,
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
});
afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

/** The row names the view handed the report renderer last. */
const rowsHanded = () => ((cap.renderer?.rows ?? []) as Array<{ name: string }>).map((r) => r.name);

describe('ReportView: only the current run commits its rows (objectui#10684)', () => {
  it('the previous report\'s answer that lands AFTER the current report\'s does not replace its rows', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    const view = render(<ReportView dataSource={dataSource as any} />);
    await waitFor(() => expect(finds).toHaveLength(1));
    expect(dataSource.find.mock.calls[0][0]).toBe('acct');

    // Another report on the same route while the first read is in flight.
    route.reportName = 'report_b';
    view.rerender(<ReportView dataSource={dataSource as any} />);
    await waitFor(() => expect(finds).toHaveLength(2));
    expect(dataSource.find.mock.calls[1][0]).toBe('other');

    await answer(finds[1], 'Current row');
    await answer(finds[0], 'Superseded row');
    await waitFor(() => expect(cap.renderer).not.toBeNull());

    const currentShown = rowsHanded().includes('Current row');
    const supersededShown = rowsHanded().includes('Superseded row');
    expect({ currentShown, supersededShown }).toEqual({ currentShown: true, supersededShown: false });
  });

  it('control: a single read hands its rows to the renderer, as before', async () => {
    const { dataSource, finds } = makeDeferredDataSource();
    render(<ReportView dataSource={dataSource as any} />);
    await waitFor(() => expect(finds).toHaveLength(1));

    await answer(finds[0], 'Only row');

    await waitFor(() => expect(rowsHanded()).toEqual(['Only row']));
    expect(dataSource.find).toHaveBeenCalledTimes(1);
  });
});
