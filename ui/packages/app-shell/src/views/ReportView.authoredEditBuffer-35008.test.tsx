// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35008 — the report quick edit edits the report as its author
 * wrote it, never the report as it is served.
 *
 * ## The defect this pins
 *
 * `ReportView` seeded its editor with `reportData`, the report from the served
 * `/meta/report` list. In a zh-CN session that read is translated (`label`,
 * `description`, each block's `label`), and the save door stores a report body
 * verbatim, so a quick edit of any one field stored the translations as the
 * source text: measured live, an en reader was served `任务概览（联合）` after
 * the publish. A pending draft took the same route a second way: the draft
 * bar's resume handed the inspector the SERVED draft, translated likewise.
 *
 * ## What runs
 *
 * The real `ReportView`, the real `ReportConfigPanel`, the real
 * `RuntimeDraftBar` and the real persistence seam, over a metadata client
 * double: its served reads (the list, `get(…, { state: 'draft' })`) answer the
 * translated report, its layered read the stored source. The panel's spec
 * inspector is reduced to one edit of `description` that also shows the label
 * and block labels it was handed.
 *
 * Direction, written before the run: with the buffer seeded from `reportData`
 * (the unmodified tree) the first two cases go RED on the stored labels, and
 * the description control stays GREEN; with the panel's draft-bar resume
 * restored, the pending-draft case goes RED.
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
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: () => null,
}));
// The panel's spec inspector, reduced to one edit of an unrelated field.
vi.mock('./metadata-admin/inspectors/ReportDefaultInspector', () => ({
  ReportDefaultInspector: ({ onPatch, draft }: any) => (
    <button
      type="button"
      data-testid="stub-report-edit"
      data-label={String(draft?.label)}
      data-blocks={JSON.stringify((draft?.blocks ?? []).map((b: any) => b?.label))}
      onClick={() => onPatch({ description: 'Edited description' })}
    >
      edit
    </button>
  ),
}));

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'task_overview' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/apps/com.qa.tr/report/task_overview', search: '' }),
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
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// `ReportView` reaches a dynamic `import('@objectstack/lint')` (through the panel's
// inspector): pay its load at collection, never inside a case's clocked window
// (`check:test-source-alias`).
import '@objectstack/lint';
import { ReportView } from './ReportView';

const PKG = 'com.qa.tr';

/** The report as its author stored it (en source). */
const SOURCE = {
  name: 'task_overview',
  label: 'Task Overview (Joined)',
  description: 'Multiple task sub-reports stacked into one joined view.',
  type: 'joined',
  blocks: [
    { name: 'open_block', label: 'Open Tasks', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] },
    { name: 'done_block', label: 'Completed Tasks', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] },
  ],
};

/** The same report as the zh-CN read serves it: translated, with the read's decorations. */
function served(doc: typeof SOURCE) {
  return {
    ...doc,
    label: '任务概览（联合）',
    description: '将多个任务子报表堆叠在一个联合视图中。',
    blocks: [
      { ...doc.blocks[0], label: '未完成任务' },
      { ...doc.blocks[1], label: '已完成任务' },
    ],
    _packageId: PKG,
  };
}

const refresh = vi.fn(async () => {});

function mountReport() {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [served(SOURCE)],
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

/** A client whose served reads translate and whose layered read is the stored row. */
function makeClient({ draft }: { draft: typeof SOURCE | null }) {
  return {
    // The served draft read (`RuntimeDraftBar`): translated, like every served read.
    get: vi.fn(async () => (draft ? served(draft) : null)),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: SOURCE, draft })),
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
  };
}

async function openEditAndSave() {
  fireEvent.click(await screen.findByTestId('report-edit-button'));
  await screen.findByTestId('report-config-panel');
  // Let the draft bar's read settle, so a resume (if any) has landed first.
  await waitFor(() => expect(client.value.get).toHaveBeenCalled());
  await act(async () => {});
  fireEvent.click(screen.getByTestId('stub-report-edit'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('report-config-save'));
  });
  await waitFor(() => expect(client.value.save).toHaveBeenCalledTimes(1));
  return client.value.save.mock.calls[0];
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

describe('the report quick edit edits the authored report (objectstack#35008, ReportView)', () => {
  it('a zh-CN quick edit then save stores the source label and block labels, and the edited field changes', async () => {
    client.value = makeClient({ draft: null });
    mountReport();
    const [type, name, body, opts] = await openEditAndSave();

    expect([type, name, opts]).toEqual(['report', 'task_overview', { mode: 'draft' }]);
    // Read at the package the served report came from.
    expect(client.value.layered).toHaveBeenCalledWith('report', 'task_overview', { packageId: PKG });
    expect(body.label).toBe(SOURCE.label);
    expect(body.blocks.map((b: any) => b.label)).toEqual(['Open Tasks', 'Completed Tasks']);
    // Control: the edit itself is what the save carries.
    expect(body.description).toBe('Edited description');
    // The read's decoration is not the report's.
    expect(body).not.toHaveProperty('_packageId');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a pending draft is edited as stored: the draft bar does not resume the served (translated) draft over it', async () => {
    const pending = { ...SOURCE, description: 'Draft description' };
    client.value = makeClient({ draft: pending });
    mountReport();
    const [, , body] = await openEditAndSave();

    expect(body.label).toBe(SOURCE.label);
    expect(body.blocks.map((b: any) => b.label)).toEqual(['Open Tasks', 'Completed Tasks']);
    expect(body.description).toBe('Edited description');
    // The draft bar still reads the draft, for its indicator and Publish.
    expect(client.value.get).toHaveBeenCalledWith('report', 'task_overview', { state: 'draft' });
  });

  it('with nothing authored to read the editor does not open, and nothing is saved from the served copy', async () => {
    client.value = {
      ...makeClient({ draft: null }),
      layered: vi.fn(async () => {
        throw Object.assign(new Error('Layered read refused'), { status: 403 });
      }),
    };
    mountReport();
    fireEvent.click(await screen.findByTestId('report-edit-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('Layered read refused');
    expect(screen.queryByTestId('report-config-panel')).toBeNull();
    expect(client.value.save).not.toHaveBeenCalled();
  });
});
