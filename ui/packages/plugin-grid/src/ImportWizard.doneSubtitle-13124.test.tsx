/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * A finished import no longer says "Review data before importing."
 * (objectui#13124).
 *
 * ## The defect
 *
 * The dialog's subtitle chose its text from `step` alone, and a finished
 * import keeps `step === 'preview'`. So the result screen ("Import Complete",
 * "1 created", "1 skipped") sat under the preview step's "Review data before
 * importing.", and a cancelled import read the same.
 *
 * ## What is pinned
 *
 * Driven through the real wizard and a stubbed data source:
 * - the controls: the upload, mapping and preview steps keep their subtitles,
 *   and each one is what the dialog's `aria-describedby` names;
 * - a completed import and a cancelled one show the preview sentence nowhere,
 *   and the dialog's accessible description is the result screen's own
 *   headline. The finished state stays described: Radix sets
 *   `aria-describedby` only while a `DialogDescription` is mounted, so simply
 *   dropping the subtitle would leave the dialog with no description at all.
 *
 * Expected copy is read from `IMPORT_DEFAULT_TRANSLATIONS` by key, so a reworded
 * sentence moves the test with it; what is pinned is which key shows when.
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
const PREVIEW_SENTENCE = copy('grid.import.previewDescription');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The text of the element the dialog's `aria-describedby` names, and how many
 *  elements carry that id (two would make the description ambiguous). */
function accessibleDescription(): { text: string | null; carriers: number } {
  const id = screen.getByRole('dialog').getAttribute('aria-describedby');
  if (!id) return { text: null, carriers: 0 };
  const carriers = document.querySelectorAll(`[id="${id}"]`);
  return { text: carriers[0]?.textContent ?? null, carriers: carriers.length };
}

/** Paste two data rows, the way a user pastes from a spreadsheet. */
function pasteRows() {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'Name\nAda\nGrace' : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Upload → mapping → preview. Returns once the preview step's Import button shows. */
async function driveToPreview() {
  pasteRows();
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

/** The card's reproduction: one row created, one skipped. */
const ONE_CREATED_ONE_SKIPPED: ImportRecordsResult = {
  object: 'task', dryRun: false, writeMode: 'insert', total: 2, ok: 1, errors: 0, created: 1, updated: 0, skipped: 1,
  results: [
    { row: 1, ok: true, action: 'created', id: 't1' },
    { row: 2, ok: true, action: 'skipped' },
  ],
};

describe('ImportWizard: a finished import no longer says "Review data before importing." (objectui#13124)', () => {
  it('controls: upload, mapping and preview keep their subtitles, each the dialog description', async () => {
    const ds = { importRecords: vi.fn(async () => ONE_CREATED_ONE_SKIPPED) };
    render(<ImportWizard objectName="task" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);

    expect(accessibleDescription()).toEqual({ text: copy('grid.import.uploadDescription'), carriers: 1 });

    pasteRows();
    const next = await screen.findByTestId('import-next-btn');
    expect(accessibleDescription()).toEqual({ text: copy('grid.import.mappingDescription'), carriers: 1 });

    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await screen.findByTestId('import-run-btn');
    expect(accessibleDescription()).toEqual({ text: PREVIEW_SENTENCE, carriers: 1 });
  });

  it('a completed import shows no preview sentence, and its headline is the dialog description', async () => {
    const ds = { importRecords: vi.fn(async () => ONE_CREATED_ONE_SKIPPED) };
    render(<ImportWizard objectName="task" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);
    fireEvent.click(await driveToPreview());

    await screen.findByTestId('import-close-btn');
    // The screen the card reported: the headline and both counts.
    expect(screen.getByText(copy('grid.import.createdCount_one').replace('{{count}}', '1'))).toBeInTheDocument();
    expect(screen.getByText(copy('grid.import.skippedCount').replace('{{count}}', '1'))).toBeInTheDocument();

    expect(screen.queryByText(PREVIEW_SENTENCE)).not.toBeInTheDocument();
    expect(accessibleDescription()).toEqual({ text: copy('grid.import.importComplete'), carriers: 1 });
  });

  it('a cancelled import shows no preview sentence, and its headline is the dialog description', async () => {
    const JOB_ID = 'imp_13124';
    const running: ImportJobProgressInfo = {
      jobId: JOB_ID, object: 'task', status: 'running', total: 2, processed: 1, created: 1,
      updated: 0, skipped: 0, errors: 0, percentComplete: 50, undoable: false,
    };
    const cancelled: ImportJobProgressInfo = { ...running, status: 'cancelled', percentComplete: 100 };
    let cancelledYet = false;
    const ds = {
      createImportJob: vi.fn(async () => ({ jobId: JOB_ID, object: 'task', status: 'pending' as const, total: 2 })),
      getImportJobProgress: vi.fn(async () => (cancelledYet ? cancelled : running)),
      // Read only by a job that completes; the wizard needs it to offer a background job.
      getImportJobResults: vi.fn(async () => ({ ...cancelled, status: 'succeeded' as const, results: [], resultsTruncated: false })),
      cancelImportJob: vi.fn(async () => { cancelledYet = true; }),
    };
    render(<ImportWizard objectName="task" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);
    await driveToPreview();
    const background = await screen.findByTestId('import-opt-background');
    fireEvent.click(within(background).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('import-run-btn'));
    fireEvent.click(await screen.findByTestId('import-cancel-async', undefined, WAIT));

    await screen.findByTestId('import-close-btn', undefined, WAIT);
    expect(ds.cancelImportJob).toHaveBeenCalledWith(JOB_ID);

    expect(screen.queryByText(PREVIEW_SENTENCE)).not.toBeInTheDocument();
    expect(accessibleDescription()).toEqual({ text: copy('grid.import.importCancelled'), carriers: 1 });
  }, 20000);
});
