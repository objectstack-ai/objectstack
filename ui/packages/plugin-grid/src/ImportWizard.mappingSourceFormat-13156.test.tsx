/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * A named mapping's request travels in the format the mapping declares
 * (objectui#13156).
 *
 * The import door judges a mapping's declared `sourceFormat` against the
 * payload. The wizard parsed every file in the browser and always sent JSON
 * rows, so a shipped mapping declaring `sourceFormat: "csv"` was refused
 * `400 MAPPING_FORMAT_MISMATCH` and nothing was imported, while the REST door
 * took the same mapping with `{ format: "csv", csv, mappingName }`.
 *
 * These pins drive the wizard to its real request (`importRecords`):
 *   - a csv mapping sends `format: 'csv'`, the source rows as CSV text and
 *     `mappingName`, and no `rows`. The text carries the user's in-preview
 *     correction, so the CSV is the preview's rows re-spelled, not the file
 *     as uploaded. The dry-run pre-check sends the same payload.
 *   - an .xlsx sheet against a csv mapping travels as CSV text too: never
 *     JSON rows to a csv mapping.
 *   - a json mapping still sends JSON rows (CONTROL).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
// Imported at module scope so the wizard's lazy `import('exceljs')` resolves
// from the module cache instead of racing the findBy budget.
import ExcelJS from 'exceljs';

import { ImportWizard } from './ImportWizard';
import type { SavedMapping } from './savedMapping';
import type { ImportRecordsResult, ImportRequestOptions } from '@object-ui/types';

beforeAll(() => {
  // Radix Select reads these on open; happy-dom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

const FIELDS: WizardField[] = [
  { name: 'company', label: 'Company', type: 'text', required: true },
  { name: 'lead_source', label: 'Lead source', type: 'text' },
];

/** A shipped mapping as the server serves it: `sourceFormat` declared. */
const CSV_MAPPING: SavedMapping = {
  name: 'crm_lead_import',
  label: 'Lead Import (CSV)',
  targetObject: 'crm_lead',
  sourceFormat: 'csv',
  fieldMapping: [
    { source: 'Company', target: 'company' },
    { source: 'Source', target: 'lead_source', transform: 'map', params: { valueMap: { LinkedIn: 'social' } } },
  ],
  mode: 'upsert',
  upsertKey: ['company'],
};
const JSON_MAPPING: SavedMapping = {
  ...CSV_MAPPING,
  name: 'crm_lead_feed',
  label: 'Lead feed (JSON)',
  sourceFormat: 'json',
};

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** A data source whose import door records every request and accepts it. */
function recordingDataSource() {
  const sent: ImportRequestOptions[] = [];
  const importRecords = vi.fn(async (_object: string, request: ImportRequestOptions): Promise<ImportRecordsResult> => {
    sent.push(request);
    return {
      object: 'crm_lead', dryRun: request.dryRun === true, writeMode: 'upsert', total: 2,
      ok: 2, errors: 0, created: 0, updated: 2, skipped: 0,
      results: [{ row: 1, ok: true, action: 'updated' }, { row: 2, ok: true, action: 'updated' }],
    } as ImportRecordsResult;
  });
  return { sent, dataSource: { importRecords } };
}

function renderWizard(dataSource: object, onComplete: (r: unknown) => void, initialFile?: File) {
  render(
    <ImportWizard
      objectName="crm_lead"
      fields={FIELDS}
      dataSource={dataSource as never}
      savedMappings={[CSV_MAPPING, JSON_MAPPING]}
      initialFile={initialFile}
      open
      onOpenChange={() => {}}
      onComplete={onComplete as never}
    />,
  );
}

/** On the mapping step: pick a saved mapping, then go to the preview. */
async function chooseMappingAndPreview(name: string) {
  await screen.findByTestId('import-saved-mapping-bar');
  fireEvent.pointerDown(screen.getByTestId('import-saved-mapping-select'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByTestId(`import-saved-mapping-option-${name}`));
  expect(await screen.findByTestId('import-saved-mapping-summary'), 'the mapping is active').toBeInTheDocument();
  const next = screen.getByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

/** Run the import and return the one real (non-dry-run) request it sent. */
async function runImport(run: HTMLElement, sent: ImportRequestOptions[], onComplete: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  const real = sent.filter((r) => !r.dryRun);
  expect(real, 'exactly one import request').toHaveLength(1);
  return real[0];
}

const PASTED = 'Company\tSource\nAcme\tLinkedIn\nGlobex, Inc.\tGoogle Ads';

describe('ImportWizard sends a named mapping the format it declares (objectui#13156)', () => {
  it('a csv mapping submits format csv, the corrected rows as CSV text and mappingName', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    renderWizard(dataSource, onComplete);
    pasteRows(PASTED);
    const run = await chooseMappingAndPreview('crm_lead_import');

    // The user corrects a cell in the preview: the CSV must carry the fix.
    fireEvent.change(screen.getByTestId('import-preview-cell-0-0'), { target: { value: 'Acme Corp' } });

    // The dry-run pre-check judges the same payload the import sends.
    fireEvent.click(screen.getByTestId('import-validate-btn'));
    await screen.findByTestId('import-validate-result');

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual({
      format: 'csv',
      csv: 'Company,Source\r\nAcme Corp,LinkedIn\r\n"Globex, Inc.",Google Ads',
      mappingName: 'crm_lead_import',
    });
    expect(request, 'no JSON rows ride along to a csv mapping').not.toHaveProperty('rows');

    const dry = sent.filter((r) => r.dryRun);
    expect(dry).toHaveLength(1);
    expect(dry[0]).toEqual({ ...request, dryRun: true });
  });

  it('an .xlsx sheet against a csv mapping travels as CSV text, never as JSON rows', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.addRow(['Company', 'Source']);
    ws.addRow(['Initech', 'Web']);
    ws.addRow(['Umbrella', 'LinkedIn']);
    const file = new File([await wb.xlsx.writeBuffer()], 'leads.xlsx');

    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    renderWizard(dataSource, onComplete, file);
    const run = await chooseMappingAndPreview('crm_lead_import');

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual({
      format: 'csv',
      csv: 'Company,Source\r\nInitech,Web\r\nUmbrella,LinkedIn',
      mappingName: 'crm_lead_import',
    });
    expect(request).not.toHaveProperty('rows');
  });

  it('CONTROL: a json mapping still submits JSON rows, corrections applied', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    renderWizard(dataSource, onComplete);
    pasteRows(PASTED);
    const run = await chooseMappingAndPreview('crm_lead_feed');
    fireEvent.change(screen.getByTestId('import-preview-cell-0-0'), { target: { value: 'Acme Corp' } });

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual({
      format: 'json',
      rows: [
        { Company: 'Acme Corp', Source: 'LinkedIn' },
        { Company: 'Globex, Inc.', Source: 'Google Ads' },
      ],
      mappingName: 'crm_lead_feed',
    });
    expect(request).not.toHaveProperty('csv');
  });
});
