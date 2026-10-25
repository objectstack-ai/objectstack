/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12112 — a dashboard the server refuses this caller, opened by its
 * direct URL, says it was refused.
 *
 * Since objectstack#22731 `GET /api/v1/meta/dashboard` lists only the
 * dashboards the caller may open, so a dashboard gated by `requiredPermissions`
 * is simply absent from the list this page reads, exactly like a name that
 * does not exist. The page used to say "Dashboard Not Found" over both. The
 * by-name read tells them apart: `403 PERMISSION_DENIED`, with the sentence
 * `You do not have permission to open the 'NAME' dashboard.`
 *
 * The probe is the adapter's `probeMetaItemAccess`, whose own reading of the
 * wire is pinned in `@object-ui/data-objectstack`; here it is a stub answering
 * the verdict each case needs. The translation is a pass-through, so a title
 * reads as the KEY it was drawn from.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DashboardRenderer: () => null,
}));

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

const route = vi.hoisted(() => ({ dashboardName: 'legal_board' }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: route.dashboardName }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: `/dashboards/${route.dashboardName}`, search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
const adapterRef = vi.hoisted(() => ({ value: {} as unknown }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => adapterRef.value }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string) => k }),
}));

import { DashboardView } from './DashboardView';
import { PreviewModeProvider } from '../preview/PreviewModeContext';

const REFUSAL = "You do not have permission to open the 'legal_board' dashboard.";
const OPS_BOARD = { name: 'ops', label: 'Operations', widgets: [] };

/** Mount the page over the dashboards the caller's list carries. */
function mount(dashboards: unknown[], typeStatus: string = 'ready', previewDrafts = false) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards,
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => typeStatus,
  };
  const page = (
    <MetadataCtx.Provider value={meta.value as never}>
      <DashboardView />
    </MetadataCtx.Provider>
  );
  return render(previewDrafts ? <PreviewModeProvider force>{page}</PreviewModeProvider> : page);
}

function probeAnswering(access: Record<string, unknown>) {
  const probeMetaItemAccess = vi.fn(async () => access);
  adapterRef.value = { probeMetaItemAccess };
  return probeMetaItemAccess;
}

beforeEach(() => {
  route.dashboardName = 'legal_board';
  adapterRef.value = {};
});
afterEach(cleanup);

describe('objectui#12112 — a refused dashboard URL says it was refused', () => {
  it('a dashboard the server refuses: a permission refusal, in the server\'s words — not "not found"', async () => {
    const probe = probeAnswering({ verdict: 'denied', message: REFUSAL });
    mount([OPS_BOARD]);

    const refusal = await screen.findByTestId('dashboard-access-denied');
    expect(probe).toHaveBeenCalledWith('dashboard', 'legal_board');
    expect(refusal.textContent).toContain('dashboard.widgetForbiddenTitle');
    expect(refusal.textContent).toContain(REFUSAL);
    expect(screen.queryByText('empty.dashboardNotFound')).toBeNull();
  });

  it('a refusal that carries no sentence is still said as a refusal', async () => {
    probeAnswering({ verdict: 'denied' });
    mount([OPS_BOARD]);

    const refusal = await screen.findByTestId('dashboard-access-denied');
    expect(refusal.textContent).toBe('dashboard.widgetForbiddenTitle');
  });

  it('CONTROL: a held dashboard opens as today, and nothing is asked by name', async () => {
    route.dashboardName = 'ops';
    const probe = probeAnswering({ verdict: 'denied', message: REFUSAL });
    const { container } = mount([OPS_BOARD]);

    await waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Operations'));
    expect(probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dashboard-access-denied')).toBeNull();
  });

  it.each(['not_found', 'unreachable', 'granted'])(
    'CONTROL: a by-name answer of `%s` keeps today\'s "not found"',
    async (verdict) => {
      const probe = probeAnswering({ verdict });
      mount([OPS_BOARD]);

      await screen.findByText('empty.dashboardNotFound');
      expect(probe).toHaveBeenCalledWith('dashboard', 'legal_board');
      expect(screen.queryByTestId('dashboard-access-denied')).toBeNull();
    },
  );

  it('CONTROL: a host adapter with no probe keeps today\'s "not found"', async () => {
    adapterRef.value = {};
    mount([OPS_BOARD]);

    await screen.findByText('empty.dashboardNotFound');
    expect(screen.queryByTestId('dashboard-access-denied')).toBeNull();
  });

  it('CONTROL: in draft preview nothing is asked — the probe reads the published world, not the draft list', async () => {
    const probe = probeAnswering({ verdict: 'denied', message: REFUSAL });
    mount([OPS_BOARD], 'ready', true);

    await screen.findByText('empty.dashboardNotFound');
    expect(probe).not.toHaveBeenCalled();
  });

  it('nothing is asked, and nothing is said, until the dashboard list has loaded', async () => {
    const probe = probeAnswering({ verdict: 'denied', message: REFUSAL });
    const { container } = mount([], 'loading');

    // The page has rendered past its first frame (the skeleton the view always
    // draws first), and still neither face is up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.firstChild).not.toBeNull();
    expect(probe).not.toHaveBeenCalled();
    expect(screen.queryByText('empty.dashboardNotFound')).toBeNull();
    expect(screen.queryByTestId('dashboard-access-denied')).toBeNull();
  });
});
