/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35619 — the dataset report's Export control reads the BASE
 * object's resolved export verdict (`resolveEffectiveCrudAffordances`'s
 * `exportCsv`), the predicate the list toolbar and the grid apply: an object
 * authoring `userActions.exportCsv: false` gets no Export control on its
 * reports, whatever `exportOptions.formats` offers.
 *
 * The control reads the object's definition through the report's data source,
 * keyed on the object the drawn table names, so every case waits for that read
 * to be asked and answered before it looks. The CONTROLS draw the same report
 * over an object that does not author the key, and over one that authors
 * `true`, and find the control.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

const OBJECT = 'crm_opportunity';

// A result that names its `object` makes the dimension-label hook read
// `/api/v1/meta/object/NAME` through the global `fetch` (no host `apiFetch`
// here). Answered by ONE module-scope double that stays up for the whole file;
// any other URL is recorded and refused.
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

const RESULT = {
  rows: [
    { stage: 'Prospecting', amount: 1200 },
    { stage: 'Closed Won', amount: 5000 },
  ],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount' },
  ],
  object: OBJECT,
};

const REPORT = {
  name: 'pipeline_by_stage',
  label: 'Pipeline by Stage',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['amount'],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(strayUrls).toEqual([]);
});

async function renderReport(userActions?: Record<string, unknown>) {
  const getObjectSchema = vi.fn(async (name: string) => ({ name, fields: {}, ...(userActions ? { userActions } : {}) }));
  const source = { queryDataset: vi.fn(async () => RESULT), getObjectSchema };
  render(
    <I18nProvider>
      <DatasetReportRenderer report={REPORT as never} dataSource={source} />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
  // The definition is asked for the object the drawn table names; let its answer land.
  await waitFor(() => expect(getObjectSchema).toHaveBeenCalledWith(OBJECT));
  await act(async () => {
    await getObjectSchema.mock.results[getObjectSchema.mock.results.length - 1].value;
  });
}

const exportControl = () => screen.queryByRole('button', { name: 'Export' });

describe('ReportExportControl — the base object\'s userActions.exportCsv (objectstack#35619)', () => {
  it('exportCsv false: no Export control on the report', async () => {
    await renderReport({ exportCsv: false });
    expect(exportControl()).toBeNull();
    expect(screen.queryByTestId('report-export')).toBeNull();
  });

  it('CONTROL: an object that does not author exportCsv keeps the Export control', async () => {
    await renderReport();
    expect(exportControl()).toBeInTheDocument();
  });

  it('CONTROL: exportCsv true keeps the Export control', async () => {
    await renderReport({ exportCsv: true });
    expect(exportControl()).toBeInTheDocument();
  });
});
