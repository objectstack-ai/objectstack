/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A dataset dimension's declared `nullLabel` names its null bucket in a report
 * (objectstack-ai/objectstack#29010). The query answer carries it on the
 * column's descriptor, `fields[].nullLabel` (objectstack#25391), and the spec
 * says a renderer draws the column's null values under it instead of its own
 * default — the dashboard widget already did; the report drew "—".
 *
 * - the summary table's null row, a grouped summary's null group header, a
 *   matrix's null row header and null across-axis header read the label;
 * - the CSV export writes the same words as the screen;
 * - the embedded chart names its null bucket the dashboard widget's way: the
 *   x-axis dimension's label, and on a `seriesBy` pivot only when both
 *   dimensions declare the same one, otherwise its own "(None)";
 * - a column that declares no `nullLabel` keeps "—", and a non-null value
 *   (an empty string included) is drawn exactly as before.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ComponentRegistry, NULL_CATEGORY_LABEL } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

const OBJECT = 'qa_region_obj';
const NO_REGION = 'No region (R8)';

// A result that names its `object` makes the dimension-label hook read
// `/api/v1/meta/object/NAME` through the global `fetch`. ONE module-scope
// double answers it for the whole file, declaring no option fields, so the
// rows are drawn as the server sent them. Any other URL is refused.
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

function renderReport(report: Record<string, unknown>, result: Record<string, unknown>) {
  const dataSource = { queryDataset: vi.fn(async () => result) };
  return render(
    <I18nProvider>
      <DatasetReportRenderer report={report as never} dataSource={dataSource} />
    </I18nProvider>,
  );
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

async function exportCsv(): Promise<string[][]> {
  fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
  fireEvent.click(await screen.findByTestId('report-export-csv'));
  await waitFor(() => expect(downloads).toHaveLength(1));
  return parseCsv((await downloads[0].blob.text()).replace(/^\uFEFF/, ''));
}

// `region` declares a nullLabel; `kind` declares none.
const FIELDS = [
  { name: 'region', type: 'string', label: 'Region', nullLabel: NO_REGION },
  { name: 'kind', type: 'string', label: 'Kind' },
  { name: 'total', type: 'number', label: 'Total' },
];

describe('report draws a dimension nullLabel for its null bucket (#29010)', () => {
  it('summary: the null row reads the label, on screen and in the CSV', async () => {
    renderReport(
      { name: 'by_region', label: 'By region', type: 'summary', dataset: 'qa_ds', rows: ['region'], values: ['total'] },
      {
        rows: [
          { region: null, total: 30 },
          { region: 'North', total: 10 },
        ],
        fields: FIELDS,
        object: OBJECT,
        totals: [{ dimensions: [], rows: [{ total: 40 }] }],
      },
    );
    await screen.findByTestId('dataset-report-total-row');
    const drawn = drawnTable();
    expect(drawn.map((r) => r[0])).toEqual(['Region', NO_REGION, 'North', 'Total']);
    const csv = await exportCsv();
    expect(csv).toEqual(drawn);
    expect(csv[1]).toEqual([NO_REGION, '30']);
  });

  it('summary: a column without nullLabel keeps "—" beside one that declares it', async () => {
    renderReport(
      { name: 'by_kind', type: 'summary', dataset: 'qa_ds', rows: ['kind'], values: ['total'] },
      {
        rows: [
          { kind: null, total: 30 },
          { kind: 'A', total: 10 },
          // An empty string is a value, not a null: drawn as before (blank).
          { kind: '', total: 5 },
        ],
        fields: FIELDS,
        object: OBJECT,
      },
    );
    await screen.findByText('A');
    const drawn = drawnTable();
    expect(drawn.map((r) => r[0])).toEqual(['Kind', '—', 'A', '']);
    const csv = await exportCsv();
    expect(csv.map((r) => r[0])).toEqual(['Kind', '—', 'A', '']);
  });

  it('grouped summary: the null group header reads the label, on screen and in the CSV', async () => {
    renderReport(
      { name: 'by_region_kind', type: 'summary', dataset: 'qa_ds', rows: ['region', 'kind'], values: ['total'] },
      {
        rows: [
          { region: null, kind: 'A', total: 30 },
          { region: null, kind: null, total: 7 },
          { region: 'North', kind: 'A', total: 10 },
        ],
        fields: FIELDS,
        object: OBJECT,
        totals: [
          { dimensions: ['region'], rows: [{ region: null, total: 37 }, { region: 'North', total: 10 }] },
          { dimensions: [], rows: [{ total: 47 }] },
        ],
      },
    );
    await screen.findByTestId('dataset-report-total-row');
    const headers = screen.getAllByTestId('dataset-report-group-header').map((h) => h.textContent);
    expect(headers).toEqual([NO_REGION, 'North']);
    const drawn = drawnTable();
    // The inner `kind` null keeps "—": `kind` declares no nullLabel.
    expect(drawn.map((r) => r[1])).toEqual(['Kind', '', 'A', '—', '', '', 'A', '', '']);
    const csv = await exportCsv();
    expect(csv).toEqual(drawn);
    expect(csv[1][0]).toBe(NO_REGION);
  });

  it('matrix: the null row header reads the label; an across-axis null without one keeps "—"', async () => {
    renderReport(
      { name: 'region_by_kind', type: 'matrix', dataset: 'qa_ds', rows: ['region'], columns: ['kind'], values: ['total'] },
      {
        rows: [
          { region: null, kind: null, total: 30 },
          { region: null, kind: 'A', total: 7 },
          { region: 'North', kind: 'A', total: 10 },
        ],
        fields: FIELDS,
        object: OBJECT,
        totals: [
          { dimensions: ['region'], rows: [{ region: null, total: 37 }, { region: 'North', total: 10 }] },
          { dimensions: ['kind'], rows: [{ kind: null, total: 30 }, { kind: 'A', total: 17 }] },
          { dimensions: [], rows: [{ total: 47 }] },
        ],
      },
    );
    const matrix = await screen.findByTestId('dataset-matrix');
    await within(matrix).findByTestId('matrix-total-row');
    const drawn = drawnTable();
    expect(drawn[0]).toEqual(['Region', '—', 'A', 'Total']);
    expect(drawn.map((r) => r[0])).toEqual(['Region', NO_REGION, 'North', 'Total']);
    const csv = await exportCsv();
    expect(csv).toEqual(drawn);
    expect(csv[1][0]).toBe(NO_REGION);
  });

  it('matrix: the null across-axis header reads the label, on screen and in the CSV', async () => {
    renderReport(
      { name: 'kind_by_region', type: 'matrix', dataset: 'qa_ds', rows: ['kind'], columns: ['region'], values: ['total'] },
      {
        rows: [
          { kind: 'A', region: null, total: 7 },
          { kind: 'A', region: 'North', total: 10 },
        ],
        fields: FIELDS,
        object: OBJECT,
        totals: [
          { dimensions: ['kind'], rows: [{ kind: 'A', total: 17 }] },
          { dimensions: ['region'], rows: [{ region: null, total: 7 }, { region: 'North', total: 10 }] },
          { dimensions: [], rows: [{ total: 17 }] },
        ],
      },
    );
    const matrix = await screen.findByTestId('dataset-matrix');
    await within(matrix).findByTestId('matrix-total-row');
    const drawn = drawnTable();
    expect(drawn[0]).toEqual(['Kind', NO_REGION, 'North', 'Total']);
    const csv = await exportCsv();
    expect(csv).toEqual(drawn);
    expect(csv[0][1]).toBe(NO_REGION);
  });
});

describe('report chart names its null bucket with the dimension nullLabel (#29010)', () => {
  let captured: { schema: Record<string, any> } | null = null;
  beforeEach(() => {
    captured = null;
    ComponentRegistry.register('chart', (props: any) => {
      captured = props;
      return null;
    });
  });

  async function chartData(chart: Record<string, unknown>, rows: Array<Record<string, unknown>>, fields = FIELDS) {
    const dataSource = { queryDataset: vi.fn(async () => ({ rows, fields })) };
    render(
      <I18nProvider>
        <DatasetReportRenderer
          report={{ name: 'chart', type: 'tabular', dataset: 'qa_ds', rows: [chart.xAxis], values: [chart.yAxis], chart } as never}
          dataSource={dataSource as never}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(captured?.schema?.data?.length).toBeGreaterThan(0));
    return captured!.schema;
  }

  it('the x-axis null bucket reads the declared label', async () => {
    const schema = await chartData({ type: 'bar', xAxis: 'region', yAxis: 'total' }, [
      { region: null, total: 30 },
      { region: 'North', total: 10 },
    ]);
    expect(schema.data.map((r: any) => r.region)).toEqual([NO_REGION, 'North']);
  });

  it('an x-axis dimension without nullLabel keeps the chart default', async () => {
    const schema = await chartData({ type: 'bar', xAxis: 'kind', yAxis: 'total' }, [
      { kind: null, total: 30 },
      { kind: 'A', total: 10 },
    ]);
    expect(schema.data.map((r: any) => r.kind)).toEqual([NULL_CATEGORY_LABEL, 'A']);
  });

  it('a seriesBy pivot takes the label only when both dimensions declare the same one', async () => {
    const rows = [
      { region: null, zone: null, total: 3 },
      { region: 'North', zone: 'East', total: 4 },
    ];
    const both = [...FIELDS, { name: 'zone', type: 'string', label: 'Zone', nullLabel: NO_REGION }];
    const schema = await chartData({ type: 'bar', xAxis: 'region', yAxis: 'total', seriesBy: 'zone' }, rows, both);
    expect(schema.data.map((r: any) => r.region)).toContain(NO_REGION);
    expect(schema.series.map((s: any) => s.label)).toContain(NO_REGION);
    cleanup();
    captured = null;
    // `kind` declares none: the pivot keeps "(None)" for both of its null groups.
    const mixed = await chartData(
      { type: 'bar', xAxis: 'region', yAxis: 'total', seriesBy: 'kind' },
      [
        { region: null, kind: null, total: 3 },
        { region: 'North', kind: 'A', total: 4 },
      ],
    );
    expect(mixed.data.map((r: any) => r.region)).toContain(NULL_CATEGORY_LABEL);
    expect(mixed.data.map((r: any) => r.region)).not.toContain(NO_REGION);
  });
});
