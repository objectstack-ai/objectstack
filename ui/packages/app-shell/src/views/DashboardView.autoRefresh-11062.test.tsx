/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console honours a dashboard's authored `refreshIntervalSeconds`
 * (objectui#11062).
 *
 * `DashboardView` mounted `DashboardRenderer` with no `onRefresh`, and
 * `useDashboardAutoRefresh` arms its interval only when a host wires one. So a
 * period an author set in Studio never started a timer in the console. The view
 * now wires a handler that declares an unscoped change on the data-invalidation
 * bus, and the widgets re-read in place through the subscription they already
 * hold.
 *
 * ## What is counted
 *
 * The claim is the widget's DATA being read again, once per period. So the
 * cases count the adapter's `queryDataset` calls made by a real dataset widget,
 * mounted through the real `DashboardView` and the real `DashboardRenderer`,
 * under fake timers. The bus events are counted too, as the second half of the
 * seam: an event with no re-read would mean the widget stopped listening, and a
 * re-read with no event would mean something other than the bus drove it.
 *
 * Only the route, metadata, adapter and inspector seams around the view are
 * stubbed, as in the sibling `DashboardView.*.test.tsx` files. The renderer, the
 * widget, the refresh hook and the bus are the shipped modules.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MetadataCtx, subscribeDataChanges, type DataChange } from '@object-ui/react';

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'pipeline' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard/pipeline', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));

import { DashboardView } from './DashboardView';

/** A dataset-bound table widget: `DashboardRenderer` hands it to `DatasetWidget`. */
const TABLE_WIDGET = {
  id: 'by_stage',
  type: 'table',
  title: 'By stage',
  dataset: 'deals',
  dimensions: ['stage'],
  values: ['deal_count'],
};

/**
 * A `queryDataset`-capable adapter. Its answer names the dataset's base object
 * (`deal`), which is what `DatasetWidget` subscribes to the bus on.
 */
function makeDatasetSource() {
  return {
    queryDataset: vi.fn(async () => ({
      rows: [{ stage: 'Won', deal_count: 3 }],
      fields: [
        { name: 'stage', type: 'string', label: 'Stage' },
        { name: 'deal_count', type: 'number', label: 'Deals' },
      ],
      object: 'deal',
      dimensionFields: { stage: 'stage' },
    })),
  };
}

/** Let the view's loading microtask, the widget's query and its effects settle. */
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

/** Advance fake time, running every timer and promise it releases. */
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

let busEvents: DataChange[] = [];
let unsubscribeBus: () => void = () => {};

/** Mount the console view over one stored dashboard carrying `root`'s keys. */
async function mountDashboard(root: Record<string, unknown>) {
  const ds = makeDatasetSource();
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [{ name: 'pipeline', label: 'Pipeline', widgets: [TABLE_WIDGET], ...root }],
    reports: [],
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
  const view = render(
    <MetadataCtx.Provider value={meta.value as React.ContextType<typeof MetadataCtx>}>
      <DashboardView dataSource={ds} />
    </MetadataCtx.Provider>,
  );
  await flush();
  await flush();
  return { ds, view };
}

/** The widget's table node, which a remount would replace. */
const widgetTable = () => screen.getByText('Won').closest('table');

beforeEach(() => {
  vi.useFakeTimers();
  // The dimension-label metadata probe falls back to the global fetch when no
  // `apiFetch` is provided; answer it locally. Not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  busEvents = [];
  unsubscribeBus = subscribeDataChanges((change) => {
    busEvents.push(change);
  });
});

afterEach(() => {
  unsubscribeBus();
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DashboardView honours an authored refreshIntervalSeconds (objectui#11062)', () => {
  it('re-reads the widget once per authored 60s period, in place', async () => {
    const { ds } = await mountDashboard({ refreshIntervalSeconds: 60 });
    const table = widgetTable();
    expect(table, 'the dataset widget never rendered its first answer').not.toBeNull();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    await advance(59_999);
    expect(ds.queryDataset, 'a re-read ran before the first period ended').toHaveBeenCalledTimes(1);
    expect(busEvents).toHaveLength(0);

    await advance(1);
    expect(ds.queryDataset, 'the widget was not re-read when the authored period ended').toHaveBeenCalledTimes(2);
    expect(busEvents, 'the re-read was not driven by one unscoped bus event').toEqual([{ objectName: '*' }]);

    await advance(60_000);
    expect(ds.queryDataset).toHaveBeenCalledTimes(3);
    expect(busEvents).toHaveLength(2);

    // In place (AGENTS.md #8): the same table node, so the widget was not remounted.
    expect(widgetTable(), 'the refresh remounted the widget').toBe(table);
  });

  it.each([
    ['a period of 0', { refreshIntervalSeconds: 0 }],
    ['no authored period', {}],
  ])('%s refreshes nothing', async (_label, root) => {
    const { ds } = await mountDashboard(root);
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    await advance(180_000);
    expect(busEvents).toHaveLength(0);
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
  });

  it('clears the timer when the dashboard unmounts', async () => {
    const { ds, view } = await mountDashboard({ refreshIntervalSeconds: 60 });
    await advance(60_000);
    // The timer was running, so what follows is a stop, not a timer that never started.
    expect(ds.queryDataset, 'the timer never ran, so its stop cannot be measured').toHaveBeenCalledTimes(2);
    expect(busEvents).toHaveLength(1);

    view.unmount();
    await advance(180_000);
    expect(busEvents, 'the interval outlived the dashboard').toHaveLength(1);
  });

  it('shows the manual refresh button, which re-reads the widget once, in place', async () => {
    const { ds } = await mountDashboard({});
    const table = widgetTable();

    const button = screen.getByRole('button', { name: 'Refresh dashboard' });
    await act(async () => {
      fireEvent.click(button);
    });
    await flush();

    expect(ds.queryDataset, 'the button did not re-read the widget').toHaveBeenCalledTimes(2);
    expect(busEvents).toEqual([{ objectName: '*' }]);
    expect(widgetTable(), 'the manual refresh remounted the widget').toBe(table);
  });
});
