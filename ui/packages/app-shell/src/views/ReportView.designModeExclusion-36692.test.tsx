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

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'revenue_by_month' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/reports/revenue_by_month', search: '' }),
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

function mountReport(report: Record<string, unknown>) {
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
    <Shell>
      <ReportView dataSource={{ find: vi.fn(async () => ({ data: [] })) } as any} />
    </Shell>,
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
