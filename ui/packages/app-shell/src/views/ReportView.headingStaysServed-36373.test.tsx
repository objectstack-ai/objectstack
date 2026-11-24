// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36373 — opening the report's editor keeps the page in the
 * session's language.
 *
 * ## The defect this pins
 *
 * objectstack#35008 seeded the editor with the AUTHORED report, so a quick
 * edit stores the source. `ReportView` also drew that buffer as the page: the
 * heading and subtitle above the open panel turned from the served 「任务概览
 * （联合）」 to the English source the moment 「编辑」 was pressed. The page
 * now draws the served text for every translated key the edit has not
 * touched (`previewWithServedText`), and hands the panel the served text of
 * the name, so its box reads the same language (`ServedReportTextContext`).
 *
 * Ablation (run): with `previewReport = editSchema ?? reportData`, the tree
 * before this change, the first two cases go RED on the heading; the third,
 * the context the panel reads, is a separate seam and stays GREEN.
 *
 * Harness: `ReportView.authoredEditBuffer-35008.test.tsx`'s, unchanged but for
 * the stub inspector.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';

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
// The panel's spec inspector, reduced to one edit of `description`, showing
// the served-text pair its host provides.
vi.mock('./metadata-admin/inspectors/ReportDefaultInspector', async () => {
  const { useServedReportText } = await import('./studio-design/servedReportText');
  return {
    ReportDefaultInspector: ({ onPatch, draft }: any) => {
      const served = useServedReportText();
      return (
        <button
          type="button"
          data-testid="stub-report-edit"
          data-label={String(draft?.label)}
          data-served={JSON.stringify(served)}
          onClick={() => onPatch({ description: 'Edited description' })}
        >
          edit
        </button>
      );
    },
  };
});

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
    // The served draft read the editor hands `authoredBuffer` (objectstack#35054): the envelope, translated.
    getDraft: vi.fn(async () => (draft ? { type: 'report', name: draft.name, item: served(draft) } : null)),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: SOURCE, draft })),
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
  };
}

async function openEditor() {
  fireEvent.click(await screen.findByTestId('report-edit-button'));
  await screen.findByTestId('report-config-panel');
  await waitFor(() => expect(client.value.get).toHaveBeenCalled());
  await act(async () => {});
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

describe('opening the report editor keeps the page in the session language (objectstack#36373)', () => {
  it('the heading and subtitle stay as served once the editor is open', async () => {
    client.value = makeClient({ draft: null });
    mountReport();
    expect(await screen.findByText('任务概览（联合）')).toBeInTheDocument();
    await openEditor();

    // The editor holds the source (objectstack#35008) …
    expect(screen.getByTestId('stub-report-edit')).toHaveAttribute('data-label', SOURCE.label);
    // … and the page above it still reads as served.
    expect(screen.getByText('任务概览（联合）')).toBeInTheDocument();
    expect(screen.getByText('将多个任务子报表堆叠在一个联合视图中。')).toBeInTheDocument();
    expect(screen.queryByText(SOURCE.label)).toBeNull();
    expect(screen.queryByText(SOURCE.description)).toBeNull();
  });

  it('an edited key draws the edit; the keys left alone stay served', async () => {
    client.value = makeClient({ draft: null });
    mountReport();
    await openEditor();
    fireEvent.click(screen.getByTestId('stub-report-edit'));

    expect(await screen.findByText('Edited description')).toBeInTheDocument();
    expect(screen.getByText('任务概览（联合）')).toBeInTheDocument();
  });

  it('the panel is handed the served name beside the authored one it was translated from', async () => {
    client.value = makeClient({ draft: null });
    mountReport();
    await openEditor();

    const served = JSON.parse(screen.getByTestId('stub-report-edit').getAttribute('data-served')!);
    expect(served.label).toEqual({ authored: SOURCE.label, served: '任务概览（联合）' });
    expect(served.description).toEqual({ authored: SOURCE.description, served: '将多个任务子报表堆叠在一个联合视图中。' });
  });
});
