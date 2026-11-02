/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29078 — the dashboard page's "Refresh All" is a 44 px touch
 * target at phone width.
 *
 * Measured on a real Console at 375 and 390 px, on every example dashboard,
 * the button was 36 px tall (`size="sm"`), under the 44 px floor the #29040
 * phone-width audit holds every control to. jsdom has no layout, so the floor
 * is pinned as drawn: `min-h-11` below `sm`, released from `sm` up so the
 * desktop header keeps its compact button.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'ops_board' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/apps/crm/dashboard/ops_board', search: '' }),
}));
vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));

import { DashboardView } from './DashboardView';

const DOC = {
  name: 'ops_board',
  label: 'Operations (29078)',
  widgets: [{ id: 'widget_total', type: 'kpi', title: 'Total (29078)', options: { value: 42 } }],
};

afterEach(() => cleanup());

describe('#29078 — Refresh All is 44 px tall on a phone', () => {
  it('carries the phone floor, released from sm up', async () => {
    meta.value = {
      apps: [], objects: [], dashboards: [DOC], reports: [], pages: [],
      loading: false, error: null,
      refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
      getItem: vi.fn(async () => null), getItemsByType: () => [], getTypeStatus: () => 'ready',
    };
    render(
      <MetadataCtx.Provider value={meta.value as React.ContextType<typeof MetadataCtx>}>
        <DashboardView />
      </MetadataCtx.Provider>,
    );
    await act(async () => {});
    const button = await within(screen.getByTestId('page-header')).findByRole('button', { name: 'Refresh dashboard' });
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('sm:min-h-0');
  });
});
