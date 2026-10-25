/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * A CSV file source reaches the server's CSV import door (objectui#13315).
 *
 * The import door reads a CSV payload's cells through one CSV rule, the one its
 * CSV export pairs with. The wizard parsed every file in the browser and sent
 * JSON rows on its default path, so a CSV file reached that rule only when a
 * named mapping declared `sourceFormat: "csv"` (objectui#13156).
 *
 * These pins drive the real wizard to its real request (`importRecords`):
 *   - a CSV file — `.csv`, `.tsv` or `.txt`, the files `parseSpreadsheetFile`
 *     reads as delimited text — sends `format: 'csv'` with the preview's rows
 *     re-spelled as CSV (`sourceRowsToCsv`), never the file as uploaded: on the
 *     default path, where the dry-run pre-check sends the same payload, and on a
 *     named mapping that declares no format;
 *   - a header the CSV export marked still maps on the default path: the text
 *     is headed by field names, so no header cell of the file reaches the door;
 *   - a `json`-declared mapping, an .xlsx sheet and a paste send JSON rows, as
 *     before (CONTROLS).
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

/** The mark the server's CSV text-cell rule writes on export (U+0027). */
const MARK = String.fromCharCode(0x27);

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

const PEOPLE: WizardField[] = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'text' },
];

const LEADS: WizardField[] = [
  { name: 'company', label: 'Company', type: 'text', required: true },
  { name: 'lead_source', label: 'Lead source', type: 'text' },
];

/** A shipped mapping that declares no `sourceFormat`: the door takes any payload. */
const UNDECLARED_MAPPING: SavedMapping = {
  name: 'crm_lead_any',
  label: 'Lead import (any format)',
  targetObject: 'crm_lead',
  fieldMapping: [
    { source: 'Company', target: 'company' },
    { source: 'Source', target: 'lead_source' },
  ],
  mode: 'insert',
};
const JSON_MAPPING: SavedMapping = {
  ...UNDECLARED_MAPPING,
  name: 'crm_lead_feed',
  label: 'Lead feed (JSON)',
  sourceFormat: 'json',
};

/** A data source whose import door records every request and accepts it. */
function recordingDataSource() {
  const sent: ImportRequestOptions[] = [];
  const importRecords = vi.fn(async (_object: string, request: ImportRequestOptions): Promise<ImportRecordsResult> => {
    sent.push(request);
    return {
      object: 'x', dryRun: request.dryRun === true, writeMode: 'insert', total: 2,
      ok: 2, errors: 0, created: 2, updated: 0, skipped: 0,
      results: [{ row: 1, ok: true, action: 'created' }, { row: 2, ok: true, action: 'created' }],
    } as ImportRecordsResult;
  });
  return { sent, dataSource: { importRecords } };
}

function renderWizard(opts: {
  fields: WizardField[];
  dataSource: object;
  onComplete: (r: unknown) => void;
  initialFile?: File;
  savedMappings?: SavedMapping[];
}) {
  return render(
    <ImportWizard
      objectName="x"
      fields={opts.fields}
      dataSource={opts.dataSource as never}
      savedMappings={opts.savedMappings ?? []}
      initialFile={opts.initialFile}
      open
      onOpenChange={() => {}}
      onComplete={opts.onComplete as never}
    />,
  );
}

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** On the mapping step, with the hand mapping as auto-mapped: go to the preview. */
async function previewAsMapped() {
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

/** On the mapping step: pick a saved mapping, then go to the preview. */
async function chooseMappingAndPreview(name: string) {
  await screen.findByTestId('import-saved-mapping-bar');
  fireEvent.pointerDown(screen.getByTestId('import-saved-mapping-select'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByTestId(`import-saved-mapping-option-${name}`));
  expect(await screen.findByTestId('import-saved-mapping-summary'), 'the mapping is active').toBeInTheDocument();
  return previewAsMapped();
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

/** The default path's request around a payload: insert, no options set. */
const defaultPath = (payload: Partial<ImportRequestOptions>): ImportRequestOptions => ({
  ...payload, writeMode: 'insert', createMissingOptions: false, skipBlankMatchKey: false,
});

describe('ImportWizard sends a CSV file to the CSV import door (objectui#13315)', () => {
  it('a .csv file on the default path sends format csv with the preview\'s cells, and the dry run sends the same payload', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    const file = new File(
      ['Name,Email\nAda Lovelace,ada@example.test\n"Hopper, Grace",grace@example.test\n'],
      'people.csv',
      { type: 'text/csv' },
    );
    renderWizard({ fields: PEOPLE, dataSource, onComplete, initialFile: file });
    const run = await previewAsMapped();

    // The user corrects a cell in the preview: the CSV carries the fix, so the
    // text is the preview's rows re-spelled, not the file as uploaded.
    fireEvent.change(screen.getByTestId('import-preview-cell-0-0'), { target: { value: 'Ada King' } });

    fireEvent.click(screen.getByTestId('import-validate-btn'));
    await screen.findByTestId('import-validate-result');

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual(defaultPath({
      format: 'csv',
      csv: 'name,email\r\nAda King,ada@example.test\r\n"Hopper, Grace",grace@example.test',
    }));
    expect(request, 'no JSON rows ride along with the CSV text').not.toHaveProperty('rows');

    const dry = sent.filter((r) => r.dryRun);
    expect(dry).toHaveLength(1);
    expect(dry[0]).toEqual({ ...request, dryRun: true });
  });

  it.each([
    ['people.tsv', 'Name\tEmail\nAda\tada@example.test\nGrace\tgrace@example.test\n'],
    ['people.txt', 'Name,Email\nAda,ada@example.test\nGrace,grace@example.test\n'],
  ])('%s, picked in the upload step, is a CSV file too', async (fileName, text) => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    const { container } = renderWizard({ fields: PEOPLE, dataSource, onComplete });
    const input = container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([text], fileName)] } });
    const run = await previewAsMapped();

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual(defaultPath({
      format: 'csv',
      csv: 'name,email\r\nAda,ada@example.test\r\nGrace,grace@example.test',
    }));
  });

  it('a header the CSV export marked still maps: the text is headed by the field name it maps to', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    const fields: WizardField[] = [
      { name: 'region', label: 'Region', type: 'text' },
      { name: 'name', label: 'Name', type: 'text', required: true },
    ];
    const file = new File([`${MARK}=Region,Name\r\nNorth,Ada\r\nSouth,Grace\r\n`], 'export.csv', { type: 'text/csv' });
    renderWizard({ fields, dataSource, onComplete, initialFile: file });
    const run = await previewAsMapped();

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual(defaultPath({ format: 'csv', csv: 'region,name\r\nNorth,Ada\r\nSouth,Grace' }));
  });

  it('a named mapping that declares no format sends a CSV file as CSV text, with mappingName', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    const file = new File(['Company,Source\nAcme,LinkedIn\n"Globex, Inc.",Google Ads\n'], 'leads.csv', { type: 'text/csv' });
    renderWizard({ fields: LEADS, dataSource, onComplete, initialFile: file, savedMappings: [UNDECLARED_MAPPING, JSON_MAPPING] });
    const run = await chooseMappingAndPreview('crm_lead_any');

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual({
      format: 'csv',
      csv: 'Company,Source\r\nAcme,LinkedIn\r\n"Globex, Inc.",Google Ads',
      mappingName: 'crm_lead_any',
    });
    expect(request).not.toHaveProperty('rows');
  });

  it('CONTROL: a json-declared mapping still sends a CSV file as JSON rows (the door refuses CSV for it)', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    const file = new File(['Company,Source\nAcme,LinkedIn\n"Globex, Inc.",Google Ads\n'], 'leads.csv', { type: 'text/csv' });
    renderWizard({ fields: LEADS, dataSource, onComplete, initialFile: file, savedMappings: [UNDECLARED_MAPPING, JSON_MAPPING] });
    const run = await chooseMappingAndPreview('crm_lead_feed');

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual({
      format: 'json',
      rows: [
        { Company: 'Acme', Source: 'LinkedIn' },
        { Company: 'Globex, Inc.', Source: 'Google Ads' },
      ],
      mappingName: 'crm_lead_feed',
    });
    expect(request).not.toHaveProperty('csv');
  });

  it('CONTROL: an .xlsx sheet on the default path sends JSON rows, as before', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('People');
    ws.addRow(['Name', 'Email']);
    ws.addRow(['Ada', 'ada@example.test']);
    ws.addRow(['Grace', 'grace@example.test']);
    const file = new File([await wb.xlsx.writeBuffer()], 'people.xlsx');

    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    renderWizard({ fields: PEOPLE, dataSource, onComplete, initialFile: file });
    const run = await previewAsMapped();

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual(defaultPath({
      format: 'json',
      rows: [{ name: 'Ada', email: 'ada@example.test' }, { name: 'Grace', email: 'grace@example.test' }],
    }));
    expect(request).not.toHaveProperty('csv');
  });

  it('CONTROL: a paste on the default path sends JSON rows, as before', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    renderWizard({ fields: PEOPLE, dataSource, onComplete });
    pasteRows('Name\tEmail\nAda\tada@example.test\nGrace\tgrace@example.test');
    const run = await previewAsMapped();

    const request = await runImport(run, sent, onComplete);
    expect(request).toEqual(defaultPath({
      format: 'json',
      rows: [{ name: 'Ada', email: 'ada@example.test' }, { name: 'Grace', email: 'grace@example.test' }],
    }));
    expect(request).not.toHaveProperty('csv');
  });
});
