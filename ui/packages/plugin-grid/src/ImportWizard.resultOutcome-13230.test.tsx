/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The import result screen says what happened (objectui#13230).
 *
 * ## The defect
 *
 * The result step had a cancelled arm and a success arm and nothing else, so
 * every finished import that was not cancelled drew the green check and
 * "Import Complete" — including one that imported nothing because every row
 * was rejected, the request was refused (405) or threw, or the background job
 * ended `failed`. The dialog's accessible description read "Import Complete"
 * in all of them.
 *
 * ## What is pinned
 *
 * Driven through the real wizard and a stubbed data source, one case per
 * measured shape:
 * - (a) every row created: Success ("Import Complete");
 * - (b) one row created, one rejected (`ok: false`): Partial;
 * - (c) every row rejected (`ok: false`): Failed, and the "0 imported" badge is not drawn
 *   in the primary variant;
 * - (d1) the import refused with 405: Failed, the refusal message still shows;
 * - (d2) the request throws: Failed;
 * - (e) the background job ends `failed`: Failed — also when the worker had
 *   committed a row before it crashed;
 * - (f) deliberately skipped rows (`ok: true`, `skipped`) beside created ones:
 *   Success — a deliberate skip is not an error;
 * - (g) every row deliberately skipped, none errored: Success, not Failed;
 * - CONTROL: a cancelled job still reads "Import cancelled".
 *
 * Each asserts the headline, that "Import Complete" is absent where it does
 * not apply, and the dialog's accessible description. Expected copy is read
 * from `IMPORT_DEFAULT_TRANSLATIONS` by key, so a reworded sentence moves the
 * test with it; what is pinned is which key shows when.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard, IMPORT_DEFAULT_TRANSLATIONS } from './ImportWizard';
import type { ImportJobProgressInfo, ImportRecordsResult } from '@object-ui/types';

const FIELDS = [{ name: 'name', label: 'Name', type: 'text' }];
const WAIT = { timeout: 6000 };
const copy = (key: string): string => {
  const text = IMPORT_DEFAULT_TRANSLATIONS[key];
  if (!text) throw new Error(`no default copy for ${key}`);
  return text;
};
const COMPLETE = copy('grid.import.importComplete');
const PARTIAL = copy('grid.import.importPartial');
const FAILED = copy('grid.import.importFailed');
const CANCELLED = copy('grid.import.importCancelled');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The text of the element the dialog's `aria-describedby` names. */
function accessibleDescription(): string | null {
  const id = screen.getByRole('dialog').getAttribute('aria-describedby');
  if (!id) return null;
  return document.getElementById(id)?.textContent ?? null;
}

/** Paste two data rows, the way a user pastes from a spreadsheet. */
function pasteRows() {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'Name\nAda\nGrace' : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Upload → mapping → preview. Returns the preview step's Import button. */
async function driveToPreview() {
  pasteRows();
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

/** Run a synchronous import and wait for the result screen. */
async function runSync(ds: object) {
  render(<ImportWizard objectName="task" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);
  fireEvent.click(await driveToPreview());
  await screen.findByTestId('import-close-btn', undefined, WAIT);
}

/** Run a background import (the opt-in toggle) and wait for the result screen. */
async function runBackground(ds: object, cancel = false) {
  render(<ImportWizard objectName="task" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);
  await driveToPreview();
  const background = await screen.findByTestId('import-opt-background');
  fireEvent.click(within(background).getByRole('checkbox'));
  fireEvent.click(screen.getByTestId('import-run-btn'));
  if (cancel) fireEvent.click(await screen.findByTestId('import-cancel-async', undefined, WAIT));
  await screen.findByTestId('import-close-btn', undefined, WAIT);
}

function expectHeadline(expected: string) {
  expect(screen.getByTestId('import-result-headline')).toHaveTextContent(expected);
  expect(accessibleDescription()).toBe(expected);
  if (expected !== COMPLETE) expect(screen.queryByText(COMPLETE)).not.toBeInTheDocument();
}

const importedBadge = (count: number) =>
  screen.getByText(copy('grid.import.imported').replace('{{count}}', String(count)));

function serverResult(created: number, failed: number, skipped = 0): ImportRecordsResult {
  const results: ImportRecordsResult['results'] = [];
  for (let i = 0; i < created; i++) results.push({ row: results.length + 1, ok: true, action: 'created', id: `t${i}` });
  for (let i = 0; i < skipped; i++) results.push({ row: results.length + 1, ok: true, action: 'skipped' });
  for (let i = 0; i < failed; i++) {
    results.push({ row: results.length + 1, ok: false, action: 'failed', field: 'name', code: 'validation_failed', error: 'Name is invalid' });
  }
  return {
    object: 'task', dryRun: false, writeMode: 'insert', total: created + failed + skipped, ok: created + skipped,
    errors: failed, created, updated: 0, skipped, results,
  };
}

const JOB_ID = 'imp_13230';
const runningJob: ImportJobProgressInfo = {
  jobId: JOB_ID, object: 'task', status: 'running', total: 2, processed: 1, created: 0,
  updated: 0, skipped: 0, errors: 0, percentComplete: 50, undoable: false,
};

describe('ImportWizard: the result screen says what happened (objectui#13230)', () => {
  it('(a) every row created reads Success', async () => {
    await runSync({ importRecords: vi.fn(async () => serverResult(2, 0)) });
    expectHeadline(COMPLETE);
    expect(screen.getByTestId('import-result-headline')).toHaveAttribute('data-outcome', 'success');
    expect(screen.queryByTestId('import-result-failed-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-result-partial-icon')).not.toBeInTheDocument();
  });

  it('(b) one row created and one rejected reads Partial, with the row error kept', async () => {
    await runSync({ importRecords: vi.fn(async () => serverResult(1, 1)) });
    expectHeadline(PARTIAL);
    expect(screen.getByTestId('import-result-partial-icon')).toBeInTheDocument();
    expect(screen.getByText(copy('grid.import.skippedCount').replace('{{count}}', '1'))).toBeInTheDocument();
  });

  it('(c) every row rejected reads Failed, and "0 imported" is not the primary badge', async () => {
    await runSync({ importRecords: vi.fn(async () => serverResult(0, 2)) });
    expectHeadline(FAILED);
    expect(screen.getByTestId('import-result-failed-icon')).toBeInTheDocument();
    expect(importedBadge(0).className).not.toMatch(/\bbg-primary\b/);
  });

  it('(d1) an import refused with 405 reads Failed, and the refusal message still shows', async () => {
    const refusal = Object.assign(new Error('Method Not Allowed'), { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED' });
    await runSync({ importRecords: vi.fn(async () => { throw refusal; }) });
    expectHeadline(FAILED);
    expect(screen.getByText(copy('grid.import.notAllowed'))).toBeInTheDocument();
    expect(importedBadge(0).className).not.toMatch(/\bbg-primary\b/);
  });

  it('(d2) a request that throws reads Failed', async () => {
    await runSync({ importRecords: vi.fn(async () => { throw new Error('Network request failed'); }) });
    expectHeadline(FAILED);
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
  });

  it('(f) deliberately skipped rows beside created ones read Success', async () => {
    await runSync({ importRecords: vi.fn(async () => serverResult(1, 0, 1)) });
    expectHeadline(COMPLETE);
    expect(screen.getByTestId('import-result-headline')).toHaveAttribute('data-outcome', 'success');
    expect(screen.getByText(copy('grid.import.skippedCount').replace('{{count}}', '1'))).toBeInTheDocument();
    expect(screen.queryByText(PARTIAL)).not.toBeInTheDocument();
  });

  it('(g) every row deliberately skipped, none errored, reads Success, not Failed', async () => {
    await runSync({ importRecords: vi.fn(async () => serverResult(0, 0, 2)) });
    expectHeadline(COMPLETE);
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-result-failed-icon')).not.toBeInTheDocument();
    expect(screen.getByText(copy('grid.import.skippedCount').replace('{{count}}', '2'))).toBeInTheDocument();
  });

  it('(e) a background job that ends `failed` reads Failed', async () => {
    const failed: ImportJobProgressInfo = { ...runningJob, status: 'failed', processed: 0, percentComplete: 100, error: 'Worker crashed' };
    await runBackground({
      createImportJob: vi.fn(async () => ({ jobId: JOB_ID, object: 'task', status: 'pending' as const, total: 2 })),
      getImportJobProgress: vi.fn(async () => failed),
      getImportJobResults: vi.fn(async () => ({ ...failed, results: [], resultsTruncated: false })),
    });
    expectHeadline(FAILED);
    expect(screen.getByText('Worker crashed')).toBeInTheDocument();
  }, 20000);

  it('(e) a background job that ends `failed` after committing a row still reads Failed', async () => {
    const failed: ImportJobProgressInfo = {
      ...runningJob, status: 'failed', processed: 1, created: 1, percentComplete: 100, error: 'Worker crashed',
    };
    await runBackground({
      createImportJob: vi.fn(async () => ({ jobId: JOB_ID, object: 'task', status: 'pending' as const, total: 2 })),
      getImportJobProgress: vi.fn(async () => failed),
      getImportJobResults: vi.fn(async () => ({
        ...failed, results: [{ row: 1, ok: true, action: 'created' as const, id: 't1' }], resultsTruncated: false,
      })),
    });
    expectHeadline(FAILED);
    expect(screen.getByText(copy('grid.import.createdCount_one').replace('{{count}}', '1'))).toBeInTheDocument();
  }, 20000);

  it('CONTROL: a cancelled job still reads "Import cancelled"', async () => {
    const cancelled: ImportJobProgressInfo = { ...runningJob, created: 1, status: 'cancelled', percentComplete: 100 };
    let cancelledYet = false;
    const ds = {
      createImportJob: vi.fn(async () => ({ jobId: JOB_ID, object: 'task', status: 'pending' as const, total: 2 })),
      getImportJobProgress: vi.fn(async () => (cancelledYet ? cancelled : { ...runningJob, created: 1 })),
      getImportJobResults: vi.fn(async () => ({ ...cancelled, status: 'succeeded' as const, results: [], resultsTruncated: false })),
      cancelImportJob: vi.fn(async () => { cancelledYet = true; }),
    };
    await runBackground(ds, true);
    expectHeadline(CANCELLED);
    expect(screen.getByTestId('import-result-headline')).toHaveAttribute('data-outcome', 'cancelled');
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(screen.queryByText(PARTIAL)).not.toBeInTheDocument();
  }, 20000);
});
