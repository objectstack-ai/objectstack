// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11583: the report editor's Save says a refused save.
 *
 * ## The defect this pins
 *
 * `ReportView.saveSchema` caught a refused `persistRuntimeMetadata('report', …)`
 * with `console.warn('[ReportView] Auto-save failed:', err)` only, so a refused
 * report edit looked saved.
 *
 * ## The cadence, measured here rather than assumed
 *
 * The card asked whether this save fires per edit. It does not: an inspector
 * edit reaches `handleReportFieldChange`, which updates the live preview only,
 * and the write fires once per press of the panel's Save. So one refusal is
 * one toast, and nothing here needs a burst guard. The first case counts the
 * writes after three edits (none) and after Save (one), so a change that made
 * the editor save per edit would fail here, before it could stack toasts.
 *
 * ## What runs
 *
 * The real `ReportView`, the real `ReportConfigPanel` and the real persistence
 * seam, over a metadata client double whose `save` rejects the way
 * `MetadataClient` does. The panel's spec inspector is reduced to one edit
 * button, and the draft bar (its own reads) to nothing.
 *
 * ## The patch round: the editor waits for the save (objectui#11583)
 *
 * `ReportConfigPanel.handleSave` called `onSave`, cleared its dirty flag and
 * closed before the save settled, so after a refused save the panel was gone
 * and a reopen showed the stored report: the edit was lost. Now
 * `ReportView.saveSchema` resolves whether it saved, and the panel closes
 * only when the save lands. A refused save leaves it open, with the edit in
 * the inspector and Save live.
 *
 * Direction, written before the run: on the unmodified tree the refused case
 * goes RED (no `toast.error`), and the control stays GREEN. The patch round's
 * assertions went RED on the first round's head for their own reason (the
 * panel closed), and its control stays GREEN.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { toast } from 'sonner';

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
import { ReportView, opensInBuilder } from './ReportView';

const refresh = vi.fn(async () => {});

/**
 * The layered read the editor seeds its buffer from (objectstack#35008): the
 * stored report, which here is the served one (no translation in play).
 */
function storedLayers() {
  return vi.fn(async () => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: { name: 'revenue_by_month', label: 'Revenue by Month', dataSource: { object: 'acct' } },
    draft: null,
  }));
}

function mountReport(report: Record<string, unknown> = { name: 'revenue_by_month', label: 'Revenue by Month', dataSource: { object: 'acct' } }) {
  meta.value = {
    apps: [],
    objects: [{ name: 'acct', label: 'Account', fields: { industry: { label: 'Industry', type: 'text' } } }],
    dashboards: [],
    reports: [report],
    pages: [],
    loading: false,
    error: null,
    refresh,
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  render(<ReportView dataSource={{ find: vi.fn(async () => ({ data: [] })) } as any} />);
}

/** Open the editor, make three edits, and press Save. */
async function editThriceAndSave() {
  fireEvent.click(await screen.findByTestId('report-edit-button'));
  await screen.findByTestId('report-config-panel');
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('stub-report-edit'));
  // Edits drive the live preview only: nothing is written yet.
  expect(client.value.save).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByTestId('report-config-save'));
  });
  await waitFor(() => expect(client.value.save).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the report editor\'s Save says a refused save (objectui#11583, ReportView.saveSchema)', () => {
  it('a refused save raises the refusal, once per Save', async () => {
    client.value = {
      get: vi.fn(async () => null),
      // objectstack#35054 — the served draft read the editor hands `authoredBuffer`: none pending.
      getDraft: vi.fn(async () => null),
      layered: storedLayers(),
      save: vi.fn(async () => {
        throw Object.assign(new Error('Saving reports requires the Manage Metadata permission'), { status: 403 });
      }),
    };
    mountReport();
    await editThriceAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(toast.error).mock.calls[0] as [unknown, { description?: unknown } | undefined];
    expect(String(options?.description)).toContain('Saving reports requires the Manage Metadata permission');
    const [type, name, body, opts] = client.value.save.mock.calls[0];
    // objectstack#36374 — Save stages the body and publishes it in the same press.
    expect([type, name, opts]).toEqual(['report', 'revenue_by_month', { mode: 'draft', ifNoneMatch: '*' }]);
    expect(body).toMatchObject({ label: 'Revenue EDITED' });
    expect(refresh).not.toHaveBeenCalled();
    // The patch round: the editor stays open with the edit intact, and Save
    // is live for a retry (it used to close before the save settled, and a
    // reopen showed the stored report).
    expect(screen.getByTestId('report-config-panel')).toBeTruthy();
    expect(screen.getByTestId('stub-report-edit').getAttribute('data-label')).toBe('Revenue EDITED');
    await waitFor(() => expect((screen.getByTestId('report-config-save') as HTMLButtonElement).disabled).toBe(false));
  });

  it('a save that lands raises nothing and refreshes the read (control)', async () => {
    client.value = {
      get: vi.fn(async () => null),
      getDraft: vi.fn(async () => null),
      layered: storedLayers(),
      save: vi.fn(async () => ({})),
      publish: vi.fn(async () => ({})),
    };
    mountReport();
    await editThriceAndSave();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    // A landed save closes the editor, as it always did.
    await waitFor(() => expect(screen.queryByTestId('report-config-panel')).toBeNull());
  });
});

/** A dataset-bound report: the shape the report builder edits (objectstack#36374). */
const DATASET_REPORT = {
  name: 'revenue_by_month',
  label: 'Revenue by Month',
  type: 'summary',
  dataset: 'revenue_metrics',
  rows: ['month'],
  values: ['revenue'],
};

function datasetClient(save: () => Promise<unknown>) {
  return {
    get: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: DATASET_REPORT, draft: null })),
    save: vi.fn(save),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
  };
}

async function openBuilderEditAndSave() {
  fireEvent.click(await screen.findByTestId('report-edit-button'));
  await screen.findByTestId('report-builder');
  fireEvent.click(screen.getByTestId('stub-builder-edit'));
  expect(client.value.save).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByTestId('report-builder-save'));
  });
  await waitFor(() => expect(client.value.save).toHaveBeenCalledTimes(1));
}

describe('the report builder\'s Save (objectstack#36374, ReportView)', () => {
  it('a dataset-bound report opens in the builder; Save writes and publishes it, then closes', async () => {
    client.value = datasetClient(async () => ({}));
    mountReport(DATASET_REPORT);
    await openBuilderEditAndSave();

    const [type, name, body, opts] = client.value.save.mock.calls[0];
    expect([type, name, opts]).toEqual(['report', 'revenue_by_month', { mode: 'draft', ifNoneMatch: '*' }]);
    expect(body).toMatchObject({ label: 'Revenue EDITED', dataset: 'revenue_metrics' });
    expect(client.value.publish).toHaveBeenCalledWith('report', 'revenue_by_month');
    await waitFor(() => expect(screen.queryByTestId('report-builder')).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
    // Control: the inspector panel is not what opened.
    expect(screen.queryByTestId('report-config-panel')).toBeNull();
  });

  it('a refused save says so and keeps the builder open with the edit', async () => {
    client.value = datasetClient(async () => {
      throw Object.assign(new Error('Saving reports requires the Manage Metadata permission'), { status: 403 });
    });
    mountReport(DATASET_REPORT);
    await openBuilderEditAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(toast.error).mock.calls[0] as [unknown, { description?: unknown } | undefined];
    expect(String(options?.description)).toContain('Saving reports requires the Manage Metadata permission');
    expect(client.value.publish).not.toHaveBeenCalled();
    expect(screen.getByTestId('report-builder')).toHaveAttribute('data-label', 'Revenue EDITED');
  });

  it('over a draft someone left pending nothing is written, and the builder stays open', async () => {
    client.value = datasetClient(async () => {
      throw Object.assign(new Error('A draft is already pending'), { status: 409, code: 'METADATA_CONFLICT' });
    });
    mountReport(DATASET_REPORT);
    await openBuilderEditAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(client.value.publish).not.toHaveBeenCalled();
    expect(screen.getByTestId('report-builder')).toBeTruthy();
  });

  it('Close leaves the builder and saves nothing', async () => {
    client.value = datasetClient(async () => ({}));
    mountReport(DATASET_REPORT);
    fireEvent.click(await screen.findByTestId('report-edit-button'));
    await screen.findByTestId('report-builder');
    fireEvent.click(screen.getByTestId('report-builder-close'));
    await waitFor(() => expect(screen.queryByTestId('report-builder')).toBeNull());
    expect(client.value.save).not.toHaveBeenCalled();
  });
});

describe('which reports open in the builder (objectstack#36374, opensInBuilder)', () => {
  it('a dataset-bound report and a new one do; a joined or pre-dataset report keeps the panel', () => {
    expect(opensInBuilder(DATASET_REPORT)).toBe(true);
    expect(opensInBuilder({ name: '', label: '' })).toBe(true);
    expect(opensInBuilder({ ...DATASET_REPORT, type: 'joined' })).toBe(false);
    expect(opensInBuilder({ name: 'r', label: 'R', dataSource: { object: 'acct' } })).toBe(false);
    expect(opensInBuilder({ name: 'r', label: 'R', objectName: 'acct' })).toBe(false);
    expect(opensInBuilder({ name: 'r', label: 'R', data: [] })).toBe(false);
    expect(opensInBuilder(null)).toBe(false);
  });

  it('a dataset report the builder has no setting for keeps the panel: a cross-tab, a saved filter, several values', () => {
    expect(opensInBuilder({ ...DATASET_REPORT, columns: ['owner'] })).toBe(false);
    expect(opensInBuilder({ ...DATASET_REPORT, columns: [] })).toBe(true);
    expect(opensInBuilder({ ...DATASET_REPORT, runtimeFilter: { stage: 'won' } })).toBe(false);
    expect(opensInBuilder({ ...DATASET_REPORT, values: ['a', 'b'] })).toBe(false);
  });
});
