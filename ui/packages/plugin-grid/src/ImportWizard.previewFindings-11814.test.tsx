/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The Import Wizard preview, end to end (objectui#11814): an unknown picklist
 * value is marked like a bad number, the preview's findings and the server's
 * dry-run findings read as one list with each row once, and the import button
 * counts only the rows nothing was found on.
 *
 * The reported case: Tasks, two rows, row 2 holding Priority `Bogus` and
 * Estimate `abc`. The preview marked `abc` but not `Bogus`, Validate data named
 * only `Bogus`, and the button read "Import 2 Rows".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from './ImportWizard';

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'High', value: 'high' },
];

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

const TASK_FIELDS: WizardField[] = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS },
  { name: 'estimate', label: 'Estimate', type: 'number' },
];

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Open the wizard, paste rows whose headers equal the field labels, go to the preview. */
async function openPreview(tsv: string, fields: WizardField[] = TASK_FIELDS, dataSource: unknown = {}) {
  render(
    <ImportWizard objectName="task" fields={fields} dataSource={dataSource} open onOpenChange={() => {}} />,
  );
  pasteRows(tsv);
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

const REPORTED = 'Title\tPriority\tEstimate\nAlpha\tHigh\t3\nBeta\tBogus\tabc';

const cell = (row: number, col: number) => screen.getByTestId(`import-preview-cell-${row}-${col}`);

describe('ImportWizard preview: picklist values, one findings list, the import count (objectui#11814)', () => {
  it('marks an unknown picklist value the way it marks a bad number', async () => {
    await openPreview(REPORTED);
    expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(1, 2)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false');
    expect(cell(1, 1).closest('td')).toHaveAttribute('title', '"Bogus" is not one of the allowed options');
  });

  it('does not count a known-bad row on the import button', async () => {
    const button = await openPreview(REPORTED);
    expect(button).toHaveTextContent('Import 1 Row');
    expect(screen.getByTestId('import-preview-status')).toHaveTextContent('1 row with errors');
  });

  it('lists the row once, with every finding on it', async () => {
    await openPreview(REPORTED);
    const rows = within(screen.getByTestId('import-findings')).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(
      'Row 2: Priority: "Bogus" is not one of the allowed options; Estimate: "abc" is not a valid number',
    );
  });

  it('counts the row again once the bad cells are corrected inline', async () => {
    const button = await openPreview(REPORTED);
    fireEvent.change(cell(1, 1), { target: { value: 'low' } });
    fireEvent.change(cell(1, 2), { target: { value: '1,500' } });
    expect(button).toHaveTextContent('Import 2 Rows');
    expect(screen.queryByTestId('import-findings')).not.toBeInTheDocument();
  });

  it('with Keep unknown option values on, leaves an unknown value on a writable field unmarked and counts its row (objectui#11970)', async () => {
    // Measured on the server: coercion keeps `Bogus`, and the engine's option
    // check admits exactly the values that import kept (objectstack#22183).
    const button = await openPreview('Title\tPriority\nAlpha\tHigh\nBeta\tBogus');
    expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(button).toHaveTextContent('Import 1 Row');
    fireEvent.click(within(screen.getByTestId('import-opt-create-options')).getByRole('checkbox'));
    await waitFor(() => expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'false'));
    expect(button).toHaveTextContent('Import 2 Rows');
    expect(screen.queryByTestId('import-findings')).not.toBeInTheDocument();
  });

  it('with Keep unknown option values on, still marks a bad number on the same row', async () => {
    const button = await openPreview(REPORTED);
    fireEvent.click(within(screen.getByTestId('import-opt-create-options')).getByRole('checkbox'));
    await waitFor(() => expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'false'));
    expect(cell(1, 2)).toHaveAttribute('aria-invalid', 'true');
    expect(button).toHaveTextContent('Import 1 Row');
  });

  it('with Keep unknown option values on, leaves an unknown value on a match-only field unmarked', async () => {
    const fields: WizardField[] = [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'code', label: 'Code', type: 'select', options: PRIORITY_OPTIONS, matchOnly: true },
    ];
    const button = await openPreview('Title\tCode\nAlpha\tZed', fields);
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(button).toHaveTextContent('Import 0 Rows');
    fireEvent.click(within(screen.getByTestId('import-opt-create-options')).getByRole('checkbox'));
    await waitFor(() => expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false'));
    expect(button).toHaveTextContent('Import 1 Row');
  });

  it('merges the dry run into the same rows and counts its failures', async () => {
    const importRecords = vi.fn().mockResolvedValue({
      object: 'task', dryRun: true, writeMode: 'insert', total: 2,
      ok: 0, errors: 2, created: 0, updated: 0, skipped: 0,
      results: [
        // A finding the preview cannot make: a field the file does not map.
        { row: 1, ok: false, action: 'failed', field: 'owner', code: 'required', error: 'Owner is required' },
        // The server's half of row 2, on a field the preview already flagged.
        { row: 2, ok: false, action: 'failed', field: 'priority', code: 'invalid_option', error: 'Priority: "Bogus" is not one of the allowed options' },
      ],
    });
    const fields: WizardField[] = [...TASK_FIELDS, { name: 'owner', label: 'Owner', type: 'text' }];
    const button = await openPreview(REPORTED, fields, { importRecords });
    expect(button).toHaveTextContent('Import 1 Row');

    fireEvent.click(screen.getByTestId('import-validate-btn'));
    await screen.findByTestId('import-validate-result');

    const rows = within(screen.getByTestId('import-findings')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Row 1: Owner: This field is required',
      'Row 2: Priority: "Bogus" is not one of the allowed options; Estimate: "abc" is not a valid number',
    ]);
    expect(button).toHaveTextContent('Import 0 Rows');
    expect(screen.getByTestId('import-preview-status')).toHaveTextContent('2 rows with errors');
  });

  it('does not mark a formatted number the server reads', async () => {
    const button = await openPreview('Title\tPriority\tEstimate\nAlpha\thigh\t1,234\nBeta\tLOW\t$12');
    expect(cell(0, 2)).toHaveAttribute('aria-invalid', 'false');
    expect(cell(1, 2)).toHaveAttribute('aria-invalid', 'false');
    expect(button).toHaveTextContent('Import 2 Rows');
  });
});
