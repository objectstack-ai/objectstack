/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A report's card follows its content (objectui#11694).
 *
 * The console report view wrapped every report in a bordered card carrying
 * `min-h-150` (37.5rem), so a five-row summary table sat at the top of a mostly
 * empty frame. Nothing inside needs a floor: the loading and not-found states
 * return before the card is drawn, and the embedded chart has its own plot
 * height. The before/after real-layout reading is on the pull request for
 * objectui#11694; a layout-free DOM cannot measure heights, so this pins the
 * mechanism: no element between the scroll region and the report body declares
 * a minimum height.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DataSource } from '@object-ui/types';

vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: () => <div data-testid="report-body" />,
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: () => null,
}));
vi.mock('./ReportConfigPanel', () => ({ ReportConfigPanel: () => null }));

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'hours_by_status' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/report/hours_by_status', search: '' }),
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

import { ReportView } from './ReportView';

afterEach(cleanup);

/** A dataset-bound summary report, shaped like the showcase's "Hours by Status". */
const REPORT = {
  name: 'hours_by_status',
  label: 'Hours by Status',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['status'],
  values: ['est_hours'],
};

describe('ReportView report card height (objectui#11694)', () => {
  it('declares no minimum height between the scroll region and the report body', async () => {
    meta.value = {
      apps: [],
      objects: [],
      dashboards: [],
      reports: [REPORT],
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
    const dataSource = { find: vi.fn(async () => ({ data: [] })) } as unknown as DataSource;
    render(<ReportView dataSource={dataSource} />);

    const body = await screen.findByTestId('report-body');

    // Walk up to the scroll region, recording every wrapper on the way.
    const wrappers: Element[] = [];
    let node = body.parentElement;
    while (node && !node.classList.contains('overflow-auto')) {
      wrappers.push(node);
      node = node.parentElement;
    }
    expect(node, 'the walk must reach the view scroll region').not.toBeNull();
    // Non-vacuity: the bordered card is among the wrappers walked.
    expect(wrappers.some((el) => el.matches('.shadow-sm.border'))).toBe(true);

    const floored = wrappers.filter((el) => /(^|\s)min-h-/.test(el.className));
    expect(floored.map((el) => el.className)).toEqual([]);
  });
});
