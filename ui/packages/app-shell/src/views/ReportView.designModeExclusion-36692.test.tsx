// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36692 — the report page's own editors (the report builder, and
 * the inspector panel of a pre-dataset report) and the shell's design mode
 * are two entries that exclude each other, both ways (the maintainer's
 * 「照 Twenty 分开」):
 *
 *  - while the mode is on, the report page's Edit is not offered; once the
 *    mode is left, it is again;
 *  - while an editor is open, entering the mode refuses, saying to save or
 *    cancel those changes first, so no bar and no second Save/Cancel set
 *    appear; the editor closed, the mode enters.
 *
 * The harness is `ReportView.saveRefusal-11583.test.tsx`'s (the real
 * `ReportView`, `ReportBuilderHost` and `ReportConfigPanel`, the builder and
 * the inspector reduced to their buttons), with the shell's real design-mode
 * controller and its bar around the page.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { DesignModeProvider, useDesignModeController } from '../layout/designMode';
import { DesignModeBar } from '../layout/DesignModeBar';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: () => null,
  // objectstack#36374 — the report builder, reduced to one edit and its
  // buttons; the host around it (`ReportBuilderHost`) is the real one.
  ReportBuilder: ({ report, onChange, onSave, onClose, banner }: any) => (
    <div data-testid="report-builder" data-label={String(report?.label)}>
      {banner}
      <button type="button" data-testid="stub-builder-edit" onClick={() => onChange({ ...report, label: 'Revenue EDITED' })}>
        edit
      </button>
      <button type="button" data-testid="report-builder-save" onClick={() => onSave()}>save</button>
      <button type="button" data-testid="report-builder-close" onClick={() => onClose()}>close</button>
    </div>
  ),
}));
// The builder host's catalog reads, answered empty: the stub draws no picker.
vi.mock('./metadata-admin/previews/useDatasetCatalog', () => ({
  useDatasetCatalog: () => ({ datasets: [], loading: false, error: null }),
  useDatasetSemantics: () => ({ dimensions: [], measures: [], loading: false, error: null }),
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: () => null,
}));
// The panel's spec inspector, reduced to one edit: a new title.
vi.mock('./metadata-admin/inspectors/ReportDefaultInspector', () => ({
  ReportDefaultInspector: ({ onPatch, draft }: any) => (
    <button
      type="button"
      data-testid="stub-report-edit"
      data-label={String(draft?.label)}
      onClick={() => onPatch({ label: 'Revenue EDITED' })}
    >
      edit
    </button>
  ),
}));
vi.mock('./RuntimeDraftBar', () => ({ RuntimeDraftBar: () => null }));

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

/** objectstack#36906 — the address and the landing the page is reached with, and where it navigates. */
const route = vi.hoisted(() => ({ search: '', state: null as unknown, navigate: null as null | ((...a: unknown[]) => void) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'revenue_by_month' }),
  useNavigate: () => route.navigate ?? (() => {}),
  useLocation: () => ({ pathname: '/reports/revenue_by_month', search: route.search, hash: '', key: 'landing', state: route.state }),
}));

vi.mock('./useOpenRecordList', () => ({
  useRecordListDrillNavigation: () => ({ openRecordList: vi.fn(), canOpenRecordList: () => true }),
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
const client = vi.hoisted(() => ({ value: null as any }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => client.value }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The report editor is admin-only.
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// `ReportView` reaches a dynamic `import('@objectstack/lint')` (through the panel's
// inspector): pay its load at collection, never inside a case's clocked window
// (`check:test-source-alias`).
import '@objectstack/lint';
import { ReportView } from './ReportView';

const PROMPT = 'Save or cancel your dashboard or report changes before designing the layout.';

/** A dataset report opens in the builder; a pre-dataset one in the panel. */
const DATASET_REPORT = { name: 'revenue_by_month', label: 'Revenue by Month', type: 'summary', dataset: 'ds_revenue', values: ['amount'] };
const LEGACY_REPORT = { name: 'revenue_by_month', label: 'Revenue by Month', dataSource: { object: 'acct' } };

function Shell({ children }: { children: React.ReactNode }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      {mode.active && <DesignModeBar mode={mode} />}
      <button type="button" data-testid="enter-design-mode" onClick={() => mode.enter()}>
        enter
      </button>
      {children}
    </DesignModeProvider>
  );
}

/** The shell with the page drawn only once the mode is on: a page reached with the mode already on. */
function ShellModeFirst({ children }: { children: React.ReactNode }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      {mode.active && <DesignModeBar mode={mode} />}
      <button type="button" data-testid="enter-design-mode" onClick={() => mode.enter()}>
        enter
      </button>
      {mode.active && children}
    </DesignModeProvider>
  );
}

function mountReport(report: Record<string, unknown>, Frame: React.ComponentType<{ children: React.ReactNode }> = Shell) {
  client.value = {
    get: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: report, draft: null })),
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
  };
  meta.value = {
    apps: [],
    objects: [{ name: 'acct', label: 'Account', fields: { industry: { label: 'Industry', type: 'text' } } }],
    dashboards: [],
    reports: [report],
    pages: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  render(
    <Frame>
      <ReportView dataSource={{ find: vi.fn(async () => ({ data: [] })) } as any} />
    </Frame>,
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  route.search = '';
  route.state = null;
  route.navigate = null;
});

describe('the report page and the design mode exclude each other (objectstack#36692)', () => {
  it('while the mode is on, Edit is not offered; the mode left, it is again', async () => {
    mountReport(DATASET_REPORT);
    await screen.findByTestId('report-edit-button');
    fireEvent.click(screen.getByTestId('enter-design-mode'));
    expect(await screen.findByTestId('design-mode-bar')).toBeTruthy();
    expect(screen.queryByTestId('report-edit-button')).toBeNull();
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    expect(await screen.findByTestId('report-edit-button')).toBeTruthy();
  });

  it('while the builder is open, entering the mode is refused with the prompt; the builder closed, it enters', async () => {
    mountReport(DATASET_REPORT);
    fireEvent.click(await screen.findByTestId('report-edit-button'));
    await screen.findByTestId('report-builder');
    fireEvent.click(screen.getByTestId('enter-design-mode'));
    await flush();
    expect(screen.queryByTestId('design-mode-bar')).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(PROMPT);
    expect(screen.getByTestId('report-builder')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-builder-close'));
    await waitFor(() => expect(screen.queryByTestId('report-builder')).toBeNull());
    fireEvent.click(screen.getByTestId('enter-design-mode'));
    expect(await screen.findByTestId('design-mode-bar')).toBeTruthy();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('the inspector panel holds the mode out too', async () => {
    mountReport(LEGACY_REPORT);
    fireEvent.click(await screen.findByTestId('report-edit-button'));
    await screen.findByTestId('report-config-panel');
    fireEvent.click(screen.getByTestId('enter-design-mode'));
    await flush();
    expect(screen.queryByTestId('design-mode-bar')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(PROMPT);
  });
});

describe('a report opened from a Studio list (objectstack#36906)', () => {
  const studioList = '/studio/crm/metadata/report?sort=-changed';
  const fromStudio = `?studio=${encodeURIComponent(studioList)}`;

  it('lands in the builder, and the builder x goes back to the Studio list', async () => {
    const navigate = vi.fn();
    route.navigate = navigate;
    route.search = fromStudio;
    route.state = { openReportBuilder: 'revenue_by_month' };
    mountReport(DATASET_REPORT);
    await screen.findByTestId('report-builder');
    expect(navigate).toHaveBeenCalledWith(`/reports/revenue_by_month${fromStudio}`, { replace: true, state: null });
    fireEvent.click(screen.getByTestId('report-builder-close'));
    expect(navigate).toHaveBeenLastCalledWith(studioList);
  });

  it('the builder x over unsaved edits asks first; staying keeps the builder', async () => {
    const navigate = vi.fn();
    route.navigate = navigate;
    route.search = fromStudio;
    route.state = { openReportBuilder: 'revenue_by_month' };
    // This DOM ships no window.confirm: install one, and put back what was there.
    const before = window.confirm;
    const confirm = vi.fn(() => false);
    window.confirm = confirm as unknown as typeof window.confirm;
    try {
      mountReport(DATASET_REPORT);
      await screen.findByTestId('report-builder');
      fireEvent.click(screen.getByTestId('stub-builder-edit'));
      fireEvent.click(screen.getByTestId('report-builder-close'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalledWith(studioList);
      expect(screen.getByTestId('report-builder')).toBeTruthy();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByTestId('report-builder-close'));
      expect(navigate).toHaveBeenLastCalledWith(studioList);
    } finally {
      window.confirm = before;
    }
  });

  it('the report page draws x back to the Studio list beside Edit, after a reload too', async () => {
    const navigate = vi.fn();
    route.navigate = navigate;
    route.search = fromStudio;
    mountReport(DATASET_REPORT);
    await screen.findByTestId('report-edit-button');
    const close = screen.getByTestId('studio-return');
    expect(close.getAttribute('data-target')).toBe(studioList);
    fireEvent.click(close);
    expect(navigate).toHaveBeenLastCalledWith(studioList);
  });

  it('reached with the design mode already on, the landing opens no builder and Edit is not offered; x still goes back', async () => {
    route.search = fromStudio;
    route.state = { openReportBuilder: 'revenue_by_month' };
    mountReport(DATASET_REPORT, ShellModeFirst);
    fireEvent.click(screen.getByTestId('enter-design-mode'));
    expect(await screen.findByTestId('design-mode-bar')).toBeTruthy();
    await screen.findByTestId('studio-return');
    await flush();
    expect(screen.queryByTestId('report-builder')).toBeNull();
    expect(screen.queryByTestId('report-edit-button')).toBeNull();
  });
});

describe("outside Studio, the builder's x over unsaved edits asks too (objectstack#36906)", () => {
  it('a clean x closes the builder without asking; over an edit it asks, and declining keeps the builder', async () => {
    const before = window.confirm;
    const confirm = vi.fn(() => false);
    window.confirm = confirm as unknown as typeof window.confirm;
    try {
      mountReport(DATASET_REPORT);
      fireEvent.click(await screen.findByTestId('report-edit-button'));
      await screen.findByTestId('report-builder');
      fireEvent.click(screen.getByTestId('report-builder-close'));
      expect(confirm).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByTestId('report-builder')).toBeNull());

      fireEvent.click(await screen.findByTestId('report-edit-button'));
      await screen.findByTestId('report-builder');
      fireEvent.click(screen.getByTestId('stub-builder-edit'));
      fireEvent.click(screen.getByTestId('report-builder-close'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('report-builder')).toBeTruthy();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByTestId('report-builder-close'));
      expect(confirm).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(screen.queryByTestId('report-builder')).toBeNull());
    } finally {
      window.confirm = before;
    }
  });
});
