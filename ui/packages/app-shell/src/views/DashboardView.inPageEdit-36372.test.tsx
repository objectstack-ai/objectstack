/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36372 — a dashboard is edited on its own page by the people who
 * may design its package.
 *
 * Through the real `DashboardView`, the real `DashboardRenderer` and the real
 * save seam (`saveDashboardInPlace` over a recording metadata client), this
 * file pins:
 *   - the Edit button is drawn only when the app → Studio gate lets the
 *     principal in;
 *   - Edit opens the stored document (the layered read's `effective`, never
 *     the served copy), with the Editing badge, the panel and the cards in
 *     design mode; Save is off until something changes;
 *   - a corner resize, then Save, stages the body in the owning package under
 *     the first-write pin and publishes that one item, and the page leaves
 *     the edit state;
 *   - an installed (read-only) package saves into its customization pair,
 *     declaring the override of its base, and the pair is asked of the
 *     ensure door (which creates it) at Save only: Edit then Discard there
 *     creates no pair and writes nothing;
 *   - where Studio's Customize is walled for the caller, an installed app's
 *     dashboard is not opened;
 *   - a draft already pending there refuses the edit state and writes nothing;
 *   - Discard drops every change and writes nothing.
 *
 * Studio's two dashboard panels and the add-card picker are stubbed to the
 * props this view hands them: their own behaviour is pinned beside them.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
// Paid during collection, not inside a case's clock: Studio's card panel
// reaches `@objectstack/lint` through a dynamic import (check:test-source-alias).
import '@objectstack/lint';

const meta = vi.hoisted(() => ({ value: null as unknown }));
const gate = vi.hoisted(() => ({ entry: null as null | { path: string; posture: 'edit' | 'view' }, walled: false }));
const client = vi.hoisted(() => ({ value: null as any }));
const packages = vi.hoisted(() => ({
  listed: new Map<string, any>(),
  ensure: null as null | ((base: string) => Promise<{ packageId: string; writable: boolean }>),
  ensured: [] as string[],
}));
/** objectstack#36364 — the navigation state the page is reached with, and its replaces. */
const route = vi.hoisted(() => ({ state: null as unknown, navigate: null as null | ((...a: unknown[]) => void) }));
const toasts = vi.hoisted(() => ({ success: [] as unknown[], error: [] as unknown[] }));

vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'ops_board' }),
  useNavigate: () => route.navigate ?? (() => {}),
  useLocation: () => ({ pathname: '/apps/crm/dashboard/ops_board', search: '', hash: '', key: 'landing', state: route.state }),
}));
vi.mock('./useOpenRecordList', () => ({
  useRecordListDrillNavigation: () => ({ openRecordList: vi.fn(), canOpenRecordList: () => true }),
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('../hooks/useStudioDesignGate', () => ({ useStudioEntryGate: () => gate.entry }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => client.value }));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () => packages.listed,
  ensureCustomizationPackage: (base: string) => {
    packages.ensured.push(base);
    return packages.ensure!(base);
  },
}));
vi.mock('./studio-design/StudioCustomizeControls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCustomizeDoorWalled: () => gate.walled,
}));
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success.push(a),
    error: (...a: unknown[]) => toasts.error.push(a),
    info: vi.fn(),
  },
}));
vi.mock('./metadata-admin/inspectors/DashboardWidgetInspector', async () => {
  // objectstack#36373: the stub reads the served title the real panel reads.
  const { useServedWidgetText } = await import('./studio-design/servedDashboardText');
  return {
    DashboardWidgetInspector: (p: any) => {
      const pair = useServedWidgetText()?.widgets.get(p.selection.id);
      return (
        <div data-testid="stub-widget-inspector">
          {p.selection.id}
          <span data-testid="stub-widget-served-title">{pair ? `${pair.served} ← ${pair.authored}` : 'none'}</span>
        </div>
      );
    },
  };
});
vi.mock('./metadata-admin/inspectors/DashboardDefaultInspector', () => ({
  DashboardDefaultInspector: (p: any) => (
    <div data-testid="stub-default-inspector">
      <button type="button" onClick={() => p.onPatch({ label: 'Renamed (36372)' })}>stub-rename</button>
    </div>
  ),
}));
vi.mock('./metadata-admin/previews/AddWidgetPicker', () => ({
  AddWidgetPicker: (p: any) => (
    <button type="button" data-testid="stub-add-card" onClick={() => p.onAdd('bar')}>{p.label}</button>
  ),
}));

import { DashboardView } from './DashboardView';

/** The served dashboard: translated for the session, with its read's decorations. */
const served = {
  name: 'ops_board',
  label: 'Operations (served)',
  _packageId: 'crm',
  widgets: [{ id: 'widget_total', type: 'kpi', title: 'Total (served)', options: { value: 42 } }],
};

/** The same dashboard as stored: what the edit state opens (the layered read carries no `_packageId`). */
const stored = {
  name: 'ops_board',
  label: 'Operations (stored)',
  widgets: [{ id: 'widget_total', type: 'kpi', title: 'Total (stored)', options: { value: 42 } }],
};

function makeClient(over: Partial<Record<'getDraft' | 'layered', any>> = {}) {
  return {
    getDraft: vi.fn(async () => null),
    layered: vi.fn(async () => ({ code: null, overlay: null, effective: stored })),
    save: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    ...over,
  };
}

function mount(dashboard: Record<string, unknown> = served, dataSource?: object) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [dashboard],
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
  return render(
    <MetadataCtx.Provider value={meta.value as React.ContextType<typeof MetadataCtx>}>
      <DashboardView dataSource={dataSource} />
    </MetadataCtx.Provider>,
  );
}

async function openEdit() {
  fireEvent.click(await screen.findByTestId('dashboard-edit'));
  await screen.findByTestId('dashboard-editing-badge');
}

beforeEach(() => {
  gate.entry = { path: '/studio/crm', posture: 'edit' };
  gate.walled = false;
  client.value = makeClient();
  packages.listed = new Map([['crm', { id: 'crm', writable: true, manifest: { id: 'crm', version: '1.4.0' } }]]);
  packages.ensure = async (base) => ({ packageId: `${base}.custom`, writable: true });
  packages.ensured = [];
  toasts.success = [];
  toasts.error = [];
  route.state = null;
  route.navigate = null;
});

afterEach(() => {
  cleanup();
});

describe('DashboardView in-page edit (objectstack#36372)', () => {
  it('draws no Edit button for a principal the Studio gate keeps out', async () => {
    gate.entry = null;
    mount();
    await screen.findAllByText('Total (served)');
    expect(screen.queryByTestId('dashboard-edit')).not.toBeInTheDocument();
  });

  it('Edit opens the stored document in design mode, with the badge and the panel; Save waits for a change', async () => {
    mount();
    await openEdit();
    expect(client.value.layered).toHaveBeenCalledWith('dashboard', 'ops_board', { packageId: 'crm' });
    // The stored title, not the served one.
    expect((await screen.findAllByText('Total (stored)')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Total (served)')).toHaveLength(0);
    expect(screen.getByTestId('dashboard-preview-widget-widget_total')).toBeInTheDocument();
    expect(screen.getByTestId('stub-default-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-edit-save')).toBeDisabled();

    // A click on a card selects it, and the panel swaps to the card's.
    fireEvent.click(screen.getByTestId('dashboard-preview-widget-widget_total'));
    expect(screen.getByTestId('stub-widget-inspector')).toHaveTextContent('widget_total');
  });

  it('a corner resize then Save stages and publishes the one item in its package, and leaves the edit state', async () => {
    mount();
    await openEdit();
    fireEvent.keyDown(screen.getByTestId('dashboard-widget-resize-handle'), { key: 'ArrowRight' });
    const save = screen.getByTestId('dashboard-edit-save');
    expect(save).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(save);
    });

    expect(client.value.save).toHaveBeenCalledTimes(1);
    const [type, name, body, options] = client.value.save.mock.calls[0];
    expect([type, name, options]).toEqual(['dashboard', 'ops_board', { mode: 'draft', ifNoneMatch: '*', packageId: 'crm' }]);
    expect(body).not.toHaveProperty('_packageId');
    expect(body.label).toBe('Operations (stored)');
    expect(body.widgets[0].layout).toMatchObject({ w: 2, h: 1 });
    expect(client.value.publish).toHaveBeenCalledWith('dashboard', 'ops_board', { packageId: 'crm' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument());
    expect(toasts.success).toHaveLength(1);
  });

  it('in the edit state, a dataset card still queries as the dashboard\'s package', async () => {
    const queryDataset = vi.fn(async () => ({ rows: [], fields: [] }));
    const dsWidget = { id: 'widget_ds', type: 'bar', title: 'By stage', dataset: 'ops_metrics', values: ['n'] };
    client.value = makeClient({
      layered: vi.fn(async () => ({ code: null, overlay: null, effective: { ...stored, widgets: [dsWidget] } })),
    });
    mount({ ...served, widgets: [dsWidget] }, { queryDataset });
    await waitFor(() => expect(queryDataset).toHaveBeenCalled());
    expect(queryDataset.mock.calls.every((c: unknown[]) => (c[2] as { callerPackage?: string })?.callerPackage === 'crm')).toBe(true);
    queryDataset.mockClear();
    await openEdit();
    await waitFor(() => expect(queryDataset).toHaveBeenCalled());
    expect(queryDataset.mock.calls.every((c: unknown[]) => (c[2] as { callerPackage?: string })?.callerPackage === 'crm')).toBe(true);
  });

  it('the card panel reads the served title beside the stored one (objectstack#36373)', async () => {
    mount();
    await openEdit();
    fireEvent.click(screen.getByTestId('dashboard-preview-widget-widget_total'));
    // The pair the title box shows and writes by: served for the session, authored as stored.
    expect(screen.getByTestId('stub-widget-served-title')).toHaveTextContent('Total (served) ← Total (stored)');
  });

  it('Add card appends a card and selects it', async () => {
    mount();
    await openEdit();
    fireEvent.click(screen.getByTestId('stub-add-card'));
    expect(screen.getByTestId('stub-widget-inspector')).toHaveTextContent('widget_1');
    expect(screen.getByTestId('dashboard-preview-widget-widget_1')).toBeInTheDocument();
  });

  it('an installed package saves into its customization pair, declaring the override of its base', async () => {
    packages.listed = new Map([['crm', { id: 'crm', writable: false, manifest: { id: 'crm', version: '1.4.0' } }]]);
    gate.entry = { path: '/studio/crm', posture: 'view' };
    client.value = makeClient({
      // The pair does not hold the dashboard yet: the base's is opened.
      layered: vi.fn(async (_t: string, _n: string, o: { packageId?: string }) =>
        o.packageId === 'crm' ? { code: stored, overlay: null, effective: stored } : { code: null, overlay: null, effective: null },
      ),
    });
    mount();
    await openEdit();
    // Opening wrote nothing: the pair is asked for at Save.
    expect(packages.ensured).toEqual([]);
    fireEvent.click(screen.getByText('stub-rename'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('dashboard-edit-save'));
    });

    expect(packages.ensured).toEqual(['crm']);
    const [, , body, options] = client.value.save.mock.calls[0];
    expect(options).toEqual({ mode: 'draft', ifNoneMatch: '*', packageId: 'crm.custom' });
    expect(body).toMatchObject({ label: 'Renamed (36372)', overrides: { package: 'crm', basedOn: '1.4.0' } });
    expect(client.value.publish).toHaveBeenCalledWith('dashboard', 'ops_board', { packageId: 'crm.custom' });
  });

  it('Edit then Discard on an installed app creates no customization package and writes nothing', async () => {
    packages.listed = new Map([['crm', { id: 'crm', writable: false, manifest: { id: 'crm', version: '1.4.0' } }]]);
    gate.entry = { path: '/studio/crm', posture: 'view' };
    mount();
    await openEdit();
    fireEvent.click(screen.getByText('stub-rename'));
    fireEvent.click(screen.getByTestId('dashboard-edit-discard'));
    expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument();
    expect(packages.ensured).toEqual([]);
    expect(client.value.save).not.toHaveBeenCalled();
    expect(client.value.publish).not.toHaveBeenCalled();
    expect(client.value.reset).not.toHaveBeenCalled();
  });

  it('where the customization door is walled for this caller, an installed app\'s dashboard is not opened', async () => {
    packages.listed = new Map([['crm', { id: 'crm', writable: false, manifest: { id: 'crm', version: '1.4.0' } }]]);
    gate.entry = { path: '/studio/crm', posture: 'view' };
    gate.walled = true;
    mount();
    const edit = await screen.findByTestId('dashboard-edit');
    await act(async () => {
      fireEvent.click(edit);
    });
    await waitFor(() => expect(toasts.error).toHaveLength(1));
    expect(String((toasts.error[0] as unknown[])[0])).toContain('only the platform operator');
    expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument();
    expect(packages.ensured).toEqual([]);
    expect(client.value.layered).not.toHaveBeenCalled();
  });

  it('a draft already pending in the package refuses the edit state and writes nothing', async () => {
    client.value = makeClient({ getDraft: vi.fn(async () => ({ item: { name: 'ops_board', label: 'Studio draft' } })) });
    mount();
    const edit = await screen.findByTestId('dashboard-edit');
    await act(async () => {
      fireEvent.click(edit);
    });
    await waitFor(() => expect(toasts.error).toHaveLength(1));
    expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument();
    expect(toasts.error).toHaveLength(1);
    expect(String((toasts.error[0] as unknown[])[0])).toContain('unpublished changes in Studio');
    expect(client.value.save).not.toHaveBeenCalled();
  });

  it('Discard drops every change and writes nothing', async () => {
    mount();
    await openEdit();
    fireEvent.click(screen.getByText('stub-rename'));
    fireEvent.click(screen.getByTestId('dashboard-edit-discard'));
    expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument();
    expect((await screen.findAllByText('Total (served)')).length).toBeGreaterThan(0);
    expect(client.value.save).not.toHaveBeenCalled();
    expect(client.value.publish).not.toHaveBeenCalled();
  });
});

describe('DashboardView arrival from the design mode (objectstack#36364)', () => {
  it('a dashboard the design mode just created opens its edit state on arrival, and the landing is cleared', async () => {
    const navigate = vi.fn();
    route.navigate = navigate;
    route.state = { designModeNewDashboard: 'ops_board' };
    mount();
    expect(await screen.findByTestId('dashboard-editing-badge')).toBeInTheDocument();
    expect(client.value.layered).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/apps/crm/dashboard/ops_board', { replace: true, state: null });
  });

  it("a landing that names another dashboard opens nothing", async () => {
    route.state = { designModeNewDashboard: 'another_board' };
    mount();
    await screen.findByTestId('dashboard-edit');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument();
    expect(client.value.layered).not.toHaveBeenCalled();
  });

  it('without the Edit button (the Studio gate keeps the principal out), the landing opens nothing', async () => {
    gate.entry = null;
    route.state = { designModeNewDashboard: 'ops_board' };
    mount();
    await screen.findAllByText('Total (served)');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId('dashboard-editing-badge')).not.toBeInTheDocument();
    expect(client.value.layered).not.toHaveBeenCalled();
  });
});

describe('DashboardView with no cards yet (objectstack#36364)', () => {
  it('a dashboard with no cards says so instead of drawing a blank page; one with cards does not', async () => {
    mount({ name: 'ops_board', label: 'Payment analysis', _packageId: 'crm', widgets: [] });
    expect(await screen.findByTestId('dashboard-no-cards')).toHaveTextContent('No cards yetThis dashboard has no cards yet.');
    cleanup();
    mount();
    await screen.findAllByText('Total (served)');
    expect(screen.queryByTestId('dashboard-no-cards')).not.toBeInTheDocument();
  });

  it('the edit state draws no such notice: the editor is the place to add cards', async () => {
    route.state = { designModeNewDashboard: 'ops_board' };
    route.navigate = vi.fn();
    client.value = makeClient({ layered: vi.fn(async () => ({ code: null, overlay: null, effective: { name: 'ops_board', label: 'P', widgets: [] } })) });
    mount({ name: 'ops_board', label: 'Payment analysis', _packageId: 'crm', widgets: [] });
    await screen.findByTestId('dashboard-editing-badge');
    expect(screen.queryByTestId('dashboard-no-cards')).not.toBeInTheDocument();
  });
});
