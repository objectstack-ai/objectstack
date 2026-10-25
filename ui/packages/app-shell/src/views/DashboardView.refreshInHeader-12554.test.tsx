/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12554 — a dashboard's "Refresh All" is drawn among the console page
 * header's actions, at the right of its one row, and the renderer draws no
 * second one below it.
 *
 * `DashboardView` keeps handing `DashboardRenderer` its `onRefresh`, which arms
 * the authored `refreshIntervalSeconds` timer (objectui#11062, pinned unchanged
 * by `DashboardView.autoRefresh-11062.test.tsx`), and takes the button with
 * `onRefreshStateChange`: the renderer reports the state of its one refresh,
 * and the view draws the button from it.
 *
 * What this file pins, through the real `DashboardView`, the real
 * `DashboardRenderer`, the real refresh hook and the real bus:
 *   - the page carries ONE refresh button, and it is inside `page-header`;
 *   - a click declares one unscoped change on the bus and, while the run is
 *     pending, disables the button, spins its icon and swaps its label; it
 *     returns to idle when the indicator clears;
 *   - a timed run lights the header's button too;
 *   - its copy is the three pack keys the renderer's button reads: a zh session
 *     reads the zh pack.
 *
 * Only the route, metadata, adapter and inspector seams around the view are
 * stubbed, as in the sibling `DashboardView.*.test.tsx` files.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
import { MetadataCtx, subscribeDataChanges, type DataChange } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

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

/** One served dashboard with a static KPI tile, so no widget reads data. */
function dashboard(extra: Record<string, unknown> = {}) {
  return {
    name: 'ops_board',
    label: 'Operations (12554)',
    header: { showTitle: true, showDescription: true },
    widgets: [{ id: 'widget_total', type: 'kpi', title: 'Total (12554)', options: { value: 42 } }],
    ...extra,
  };
}

function metadataWith(doc: Record<string, unknown>) {
  return {
    apps: [],
    objects: [],
    dashboards: [doc],
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
}

// Module constant: `I18nProvider` rebuilds its i18next instance when its
// `config` changes identity.
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false };

function mount(doc: Record<string, unknown>, i18n?: typeof ZH) {
  meta.value = metadataWith(doc);
  const tree = (
    <MetadataCtx.Provider value={meta.value as React.ContextType<typeof MetadataCtx>}>
      <DashboardView />
    </MetadataCtx.Provider>
  );
  return render(i18n ? <I18nProvider config={i18n} persistLanguage={false}>{tree}</I18nProvider> : tree);
}

const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

let busEvents: DataChange[] = [];
let unsubscribeBus: () => void = () => {};

beforeEach(() => {
  busEvents = [];
  unsubscribeBus = subscribeDataChanges((change) => {
    busEvents.push(change);
  });
  window.localStorage.clear();
});

afterEach(() => {
  unsubscribeBus();
  cleanup();
  vi.useRealTimers();
});

describe('DashboardView draws Refresh All in the page header (objectui#12554)', () => {
  describe('under fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('one refresh button on the page, inside the page header', async () => {
      mount(dashboard());
      await advance(0);
      await advance(0);

      const header = screen.getByTestId('page-header');
      const buttons = screen.getAllByRole('button', { name: 'Refresh dashboard' });
      expect(buttons, 'the renderer drew a second refresh button').toHaveLength(1);
      expect(header.contains(buttons[0]), 'the refresh button is not in the page header').toBe(true);
      expect(buttons[0].textContent).toBe('Refresh All');
    });

    it('a click re-reads once, and the button is disabled and spinning while the run is pending', async () => {
      mount(dashboard());
      await advance(0);
      await advance(0);

      const button = within(screen.getByTestId('page-header')).getByRole('button', { name: 'Refresh dashboard' });
      expect(button.hasAttribute('disabled')).toBe(false);
      await act(async () => {
        fireEvent.click(button);
      });

      expect(busEvents, 'the click did not declare one unscoped change').toEqual([{ objectName: '*' }]);
      expect(button.hasAttribute('disabled'), 'the button stayed enabled while refreshing').toBe(true);
      expect(button.textContent).toBe('Refreshing…');
      expect(button.querySelector('svg')?.getAttribute('class') ?? '').toContain('animate-spin');

      await advance(600);
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.textContent).toBe('Refresh All');
      expect(button.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('animate-spin');
      expect(busEvents).toHaveLength(1);
    });

    it('a timed run lights the header button too', async () => {
      mount(dashboard({ refreshIntervalSeconds: 60 }));
      await advance(0);
      await advance(0);
      const button = within(screen.getByTestId('page-header')).getByRole('button', { name: 'Refresh dashboard' });

      await advance(60_000);
      expect(busEvents, 'the authored timer did not run').toEqual([{ objectName: '*' }]);
      expect(button.textContent).toBe('Refreshing…');
      expect(button.hasAttribute('disabled')).toBe(true);
    });
  });

  it('control: the zh pack carries real translations of the three keys', () => {
    expect(zh.dashboard.refreshAll).not.toBe(en.dashboard.refreshAll);
    expect(zh.dashboard.refreshDashboard).not.toBe(en.dashboard.refreshDashboard);
    expect(zh.dashboard.refreshing).not.toBe(en.dashboard.refreshing);
  });

  it('zh: the header button reads the three dashboard pack keys', async () => {
    mount(dashboard(), ZH);
    const button = await screen.findByRole('button', { name: zh.dashboard.refreshDashboard });
    expect(screen.getByTestId('page-header').contains(button)).toBe(true);
    expect(button.textContent).toBe(zh.dashboard.refreshAll);

    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.textContent).toBe(zh.dashboard.refreshing);
  });
});
