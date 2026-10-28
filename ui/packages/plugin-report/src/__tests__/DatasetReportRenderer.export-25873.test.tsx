/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The report page's export control reads `ReportSchema.exportOptions`
 * (objectstack-ai/objectstack#25873, ruling 6408567749 letter B).
 *
 * - the download is the table AS DRAWN: its header row, its rows and the
 *   server total, compared cell by cell against the rendered table;
 * - `formats` picks what is offered (absent = csv + xlsx, `[]` = no control);
 * - the control is gated on `export` in the viewer's effective API operations
 *   on the dataset's base object, the list toolbar's predicate; an absent
 *   operation set (no provider) keeps it;
 * - `includeHeaders: false` drops the header row, `fileNamePrefix` names the file;
 * - the XLSX carries measure cells as numbers;
 * - a matrix exports its cross-tab, totals column and row included.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
// Imported at module scope so the control's lazy `import('exceljs')` resolves
// at once and the parse-back below reads the same module.
import ExcelJS from 'exceljs';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

const OBJECT = 'crm_opportunity';

// A result that names its `object` makes the dimension-label hook read
// `/api/v1/meta/object/NAME` through the global `fetch` (no host `apiFetch`
// here). Answered by ONE module-scope double that stays up for the whole file
// (the network-escape guard's prescription), declaring no option fields, so
// the rows are drawn exactly as the server sent them. Any other URL is refused.
const META_OBJECT_ROUTE = /^\/api\/v1\/meta\/object\/(.+)$/;
const strayUrls: string[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
    const m = META_OBJECT_ROUTE.exec(url);
    if (!m) {
      strayUrls.push(url);
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ item: { name: decodeURIComponent(m[1]), fields: {} } }) };
  }),
);

function makeSource(result: Record<string, unknown>) {
  return { queryDataset: vi.fn(async () => result) };
}

const SUMMARY_RESULT = {
  rows: [
    { stage: 'Prospecting', amount: 1200, n: 3 },
    { stage: 'Closed, Won', amount: 5000.5, n: 2 },
    { stage: '=HYPERLINK("x")', amount: -40, n: 1 },
  ],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount' },
    { name: 'n', type: 'number', label: 'Deals' },
  ],
  object: OBJECT,
  totals: [{ dimensions: [], rows: [{ amount: 6160.5, n: 6 }] }],
};

const SUMMARY = {
  name: 'pipeline_by_stage',
  label: 'Pipeline by Stage',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['amount', 'n'],
};

type Captured = { blob: Blob; fileName: string };
let downloads: Captured[] = [];

beforeEach(() => {
  downloads = [];
  let lastBlob: Blob | null = null;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => {
    lastBlob = b;
    return 'blob:report-export';
  });
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ blob: lastBlob!, fileName: this.download });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(strayUrls).toEqual([]);
});

function permissions(apiOperations?: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'usr_1',
    tenantId: null,
    roles: [],
    permissionSets: [],
    objects: { [OBJECT]: { allowRead: true, ...(apiOperations ? { apiOperations } : {}) } },
    fields: {},
  };
}

function renderReport(report: Record<string, unknown>, opts: { result?: Record<string, unknown>; perms?: MePermissionsResponse } = {}) {
  const tree = <DatasetReportRenderer report={report as never} dataSource={makeSource(opts.result ?? SUMMARY_RESULT)} />;
  return render(
    <I18nProvider>{opts.perms ? <MePermissionsProvider initialPermissions={opts.perms}>{tree}</MePermissionsProvider> : tree}</I18nProvider>,
  );
}

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
}

/** The rendered table, one array of cell texts per row (header first). */
function drawnTable(): string[][] {
  const table = screen.getByRole('table');
  return Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).flatMap((c) => {
      const span = Number((c as HTMLTableCellElement).colSpan || 1);
      return [c.textContent ?? '', ...Array.from({ length: span - 1 }, () => '')];
    }),
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

async function blobText(blob: Blob): Promise<string> {
  const text = await blob.text();
  return text.replace(/^\uFEFF/, '');
}

describe('report export control (exportOptions, #25873)', () => {
  it('CSV of a summary report is the header row, the drawn rows and the server total', async () => {
    renderReport(SUMMARY);
    await screen.findByTestId('dataset-report-total-row');
    await openMenu();
    fireEvent.click(await screen.findByTestId('report-export-csv'));
    await waitFor(() => expect(downloads).toHaveLength(1));

    const csv = parseCsv(await blobText(downloads[0].blob));
    const drawn = drawnTable();
    expect(drawn[0]).toEqual(['Stage', 'Amount', 'Deals']);
    expect(csv).toHaveLength(drawn.length);
    // Cell for cell, except the data cell that opens with a formula character,
    // which carries the tab guard.
    csv.forEach((row, r) =>
      row.forEach((cell, c) => expect(cell).toBe(drawn[r][c].startsWith('=') ? `\t${drawn[r][c]}` : drawn[r][c])),
    );
    expect(csv[csv.length - 1][0]).toBe('Total');
    // A drawn negative measure keeps its minus: only data cells are guarded.
    expect(csv[3][1].startsWith('\t')).toBe(false);
    expect(downloads[0].fileName).toMatch(/^Pipeline by Stage-\d{8}-\d{6}\.csv$/);
    expect(downloads[0].blob.type).toContain('text/csv');
  });

  it('absent formats offers both CSV and XLSX', async () => {
    renderReport(SUMMARY);
    await openMenu();
    expect(await screen.findByTestId('report-export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('report-export-xlsx')).toBeInTheDocument();
  });

  it("formats: ['csv'] offers only CSV", async () => {
    renderReport({ ...SUMMARY, exportOptions: { formats: ['csv'] } });
    await openMenu();
    expect(await screen.findByTestId('report-export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('report-export-xlsx')).not.toBeInTheDocument();
  });

  it('formats: [] draws no control', async () => {
    renderReport({ ...SUMMARY, exportOptions: { formats: [] } });
    await screen.findByTestId('dataset-report-total-row');
    expect(screen.queryByTestId('report-export')).not.toBeInTheDocument();
  });

  it("a viewer whose apiOperations on the base object exclude 'export' sees no control", async () => {
    renderReport(SUMMARY, { perms: permissions(['find', 'get']) });
    await screen.findByTestId('dataset-report-total-row');
    expect(screen.queryByTestId('report-export')).not.toBeInTheDocument();
  });

  it("CONTROL: the same provider with 'export' in apiOperations shows it", async () => {
    renderReport(SUMMARY, { perms: permissions(['find', 'get', 'export']) });
    expect(await screen.findByTestId('report-export')).toBeInTheDocument();
  });

  it('CONTROL: with no permissions provider the control is shown', async () => {
    renderReport(SUMMARY);
    expect(await screen.findByTestId('report-export')).toBeInTheDocument();
  });

  it('includeHeaders: false drops the header row; fileNamePrefix names the file', async () => {
    renderReport({ ...SUMMARY, exportOptions: { includeHeaders: false, fileNamePrefix: 'pipeline' } });
    await openMenu();
    fireEvent.click(await screen.findByTestId('report-export-csv'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const csv = parseCsv(await blobText(downloads[0].blob));
    expect(csv[0][0]).toBe('Prospecting');
    expect(csv).toHaveLength(4);
    expect(downloads[0].fileName).toMatch(/^pipeline-\d{8}-\d{6}\.csv$/);
  });

  it('XLSX carries the header, the drawn dimension text and the measures as numbers', async () => {
    renderReport(SUMMARY);
    await openMenu();
    fireEvent.click(await screen.findByTestId('report-export-xlsx'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].fileName).toMatch(/\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await downloads[0].blob.arrayBuffer());
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Pipeline by Stage');
    expect(ws.getRow(1).values).toEqual([undefined, 'Stage', 'Amount', 'Deals']);
    expect(ws.getRow(3).values).toEqual([undefined, 'Closed, Won', 5000.5, 2]);
    expect(ws.getRow(5).values).toEqual([undefined, 'Total', 6160.5, 6]);
  });

  it('a matrix exports its cross-tab with the totals column and row', async () => {
    const result = {
      rows: [
        { stage: 'A', quarter: 'Q1', amount: 1 },
        { stage: 'A', quarter: 'Q2', amount: 2 },
        { stage: 'B', quarter: 'Q1', amount: 3 },
      ],
      fields: [
        { name: 'stage', type: 'string', label: 'Stage' },
        { name: 'quarter', type: 'string', label: 'Quarter' },
        { name: 'amount', type: 'number', label: 'Amount' },
      ],
      object: OBJECT,
      totals: [
        { dimensions: ['stage'], rows: [{ stage: 'A', amount: 3 }, { stage: 'B', amount: 3 }] },
        { dimensions: ['quarter'], rows: [{ quarter: 'Q1', amount: 4 }, { quarter: 'Q2', amount: 2 }] },
        { dimensions: [], rows: [{ amount: 6 }] },
      ],
    };
    renderReport(
      { name: 'by_stage_quarter', type: 'matrix', dataset: 'opportunity_metrics', rows: ['stage'], columns: ['quarter'], values: ['amount'] },
      { result },
    );
    const matrix = await screen.findByTestId('dataset-matrix');
    await within(matrix).findByTestId('matrix-total-row');
    await openMenu();
    fireEvent.click(await screen.findByTestId('report-export-csv'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const csv = parseCsv(await blobText(downloads[0].blob));
    expect(csv).toEqual(drawnTable());
    expect(csv[0][csv[0].length - 1]).toBe('Total');
    expect(downloads[0].fileName).toMatch(/^by_stage_quarter-/);
  });

  it('a joined report draws no export control', async () => {
    renderReport({
      name: 'joined_one',
      type: 'joined',
      blocks: [{ name: 'b1', type: 'summary', dataset: 'opportunity_metrics', rows: ['stage'], values: ['amount'] }],
    });
    await screen.findByTestId('dataset-report-total-row');
    expect(screen.queryByTestId('report-export')).not.toBeInTheDocument();
  });
});
