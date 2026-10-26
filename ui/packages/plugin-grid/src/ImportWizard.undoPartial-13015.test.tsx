/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * An import undo that leaves rows unreverted says so (objectui#13015).
 *
 * ## The defect
 *
 * The undo route runs its reversal writes under the object's declared
 * controls, so a hook or rule can refuse a row. The server then answers `200`
 * with `success: false`, one `failures` entry per unreverted row (each with the
 * app's own refusal sentence), and keeps the job undoable for exactly those
 * rows. `useImportJobUndo` awaited the answer and never read it, and its error
 * path fired only on a throw: a partial undo showed nothing, and the re-read
 * job offered Undo again with no reason given.
 *
 * ## What is pinned
 *
 * Both lists that run Undo — the History list and the cancelled-result screen
 * — are driven with a partial answer through the real wizard and a stubbed data
 * source. Each shows how many rows stayed, every refusal sentence, and that
 * undoing again retries only those rows, and still offers Undo. A full answer
 * shows none of it. A thrown undo in the History list shows its message: the
 * list's reload cleared the slot that message was written to, in the same tick.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { subscribeDataChanges, type DataChange } from '@object-ui/react';
import { ImportWizard } from './ImportWizard';
import type { ImportJobProgressInfo, ImportJobSummaryInfo, ImportJobUndoResult } from '@object-ui/types';

const FIELDS = [{ name: 'name', label: 'Name', type: 'text' }];
const JOB_ID = 'imp_13015';
const WAIT = { timeout: 6000 };

const CLOSED_CASE = 'A closed case cannot be changed or deleted.';
const APPROVAL_LOCK = 'The amount is locked while the deal awaits approval.';

/** The answer of an undo two controls refused three rows of: two rows with
 *  the same sentence, one with another. */
const PARTIAL: ImportJobUndoResult = {
  success: false, jobId: JOB_ID, object: 'contact', deleted: 7, restored: 2, failed: 3,
  failures: [
    { id: 'c1', action: 'delete', code: 'VALIDATION_FAILED', error: CLOSED_CASE },
    { id: 'c2', action: 'delete', code: 'VALIDATION_FAILED', error: CLOSED_CASE },
    { id: 'd1', action: 'restore', code: 'VALIDATION_FAILED', error: APPROVAL_LOCK },
  ],
};

const FULL: ImportJobUndoResult = {
  success: true, jobId: JOB_ID, object: 'contact', deleted: 10, restored: 2, failed: 0, failures: [],
};

const HISTORY_ROW: ImportJobSummaryInfo = {
  jobId: JOB_ID, object: 'contact', status: 'succeeded', total: 12, processed: 12,
  created: 10, updated: 2, skipped: 0, errors: 0, undoable: true,
};

const PARTIAL_SENTENCE = '3 rows were not undone. Undo again to retry only those rows.';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Open the History list over a data source whose list read answers `rows()`. */
async function openHistory(undoImportJob: ReturnType<typeof vi.fn>, rows: () => ImportJobSummaryInfo[]) {
  const ds = { listImportJobs: vi.fn(async () => rows()), undoImportJob };
  vi.stubGlobal('confirm', vi.fn(() => true));
  render(<ImportWizard objectName="contact" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByTestId('import-history-toggle'));
  const undo = await screen.findByTestId(`import-history-undo-${JOB_ID}`);
  return { ds, undo };
}

describe('ImportWizard: an import undo that leaves rows unreverted says so (objectui#13015)', () => {
  it('History list: a partial answer shows the count, each refusal sentence and the retry sentence, and Undo stays offered', async () => {
    const undoImportJob = vi.fn(async () => PARTIAL);
    // The server keeps the job undoable for the rows that remain.
    const { ds, undo } = await openHistory(undoImportJob, () => [HISTORY_ROW]);
    const changes: DataChange[] = [];
    const unsubscribe = subscribeDataChanges((change) => { changes.push(change); });
    try {
      fireEvent.click(undo);

      const notice = await screen.findByTestId('import-history-undo-partial');
      expect(notice).toHaveTextContent(PARTIAL_SENTENCE);
      // Each refusal sentence the answer carries, once: two rows share one.
      const items = within(notice).getAllByRole('listitem').map((li) => li.textContent);
      expect(items).toEqual([CLOSED_CASE, APPROVAL_LOCK]);
      // The reload ran and did not wipe the notice; the row still offers Undo.
      await waitFor(() => expect(ds.listImportJobs).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByTestId(`import-history-undo-${JOB_ID}`)).toBeEnabled());
      expect(screen.getByTestId('import-history-undo-partial')).toHaveTextContent(PARTIAL_SENTENCE);
      expect(screen.queryByTestId(`import-history-reverted-${JOB_ID}`)).not.toBeInTheDocument();
      // A partial undo still reverted rows, so the object's readers refetch.
      expect(changes).toEqual([{ objectName: 'contact' }]);
    } finally {
      unsubscribe();
    }
  });

  it('History list: undoing again clears the notice, and a full answer shows no refusal', async () => {
    const undoImportJob = vi.fn()
      .mockResolvedValueOnce(PARTIAL)
      .mockResolvedValueOnce(FULL);
    let reverted = false;
    const { undo } = await openHistory(undoImportJob, () => [
      reverted ? { ...HISTORY_ROW, undoable: false, revertedAt: '2026-10-19T10:00:00.000Z' } : HISTORY_ROW,
    ]);
    fireEvent.click(undo);
    await screen.findByTestId('import-history-undo-partial');
    await waitFor(() => expect(screen.getByTestId(`import-history-undo-${JOB_ID}`)).toBeEnabled());

    reverted = true;
    fireEvent.click(screen.getByTestId(`import-history-undo-${JOB_ID}`));

    expect(await screen.findByTestId(`import-history-reverted-${JOB_ID}`)).toHaveTextContent('Undone');
    expect(undoImportJob).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('import-history-undo-partial')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-history-undo-error')).not.toBeInTheDocument();
    expect(screen.queryByText(CLOSED_CASE)).not.toBeInTheDocument();
  });

  it('History list: an undo that throws shows its message after the list reloads', async () => {
    const undoImportJob = vi.fn(async () => { throw new Error('This import has already been undone'); });
    const { ds, undo } = await openHistory(undoImportJob, () => [HISTORY_ROW]);

    fireEvent.click(undo);

    await waitFor(() => expect(ds.listImportJobs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId(`import-history-undo-${JOB_ID}`)).toBeEnabled());
    expect(screen.getByTestId('import-history-undo-error')).toHaveTextContent('This import has already been undone');
    expect(screen.queryByTestId('import-history-undo-partial')).not.toBeInTheDocument();
  });

  it('cancelled-result screen: a partial answer shows the count, each refusal sentence and the retry sentence, and Undo stays offered', async () => {
    const running: ImportJobProgressInfo = {
      jobId: JOB_ID, object: 'contact', status: 'running', total: 12, processed: 6, created: 6,
      updated: 0, skipped: 0, errors: 0, percentComplete: 50, undoable: false,
    };
    const cancelled: ImportJobProgressInfo = {
      ...running, status: 'cancelled', processed: 12, created: 10, updated: 2, percentComplete: 100, undoable: true,
    };
    let cancelledYet = false;
    const ds = {
      createImportJob: vi.fn(async () => ({ jobId: JOB_ID, object: 'contact', status: 'pending', total: 12 })),
      // After a partial undo the job reads exactly as before: undoable, not reverted.
      getImportJobProgress: vi.fn(async () => (cancelledYet ? cancelled : running)),
      // Read only by a job that completes; the wizard needs it to offer a background job.
      getImportJobResults: vi.fn(async () => ({ ...cancelled, status: 'succeeded' as const, results: [], resultsTruncated: false })),
      cancelImportJob: vi.fn(async () => { cancelledYet = true; }),
      undoImportJob: vi.fn(async () => PARTIAL),
    };
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<ImportWizard objectName="contact" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />);
    const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'Name\nAda\nGrace' : '') };
    act(() => { window.dispatchEvent(evt); });
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    const background = await screen.findByTestId('import-opt-background');
    fireEvent.click(within(background).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('import-run-btn'));
    fireEvent.click(await screen.findByTestId('import-cancel-async', undefined, WAIT));

    fireEvent.click(await screen.findByTestId('import-cancelled-undo', undefined, WAIT));

    const notice = await screen.findByTestId('import-cancelled-undo-partial', undefined, WAIT);
    expect(notice).toHaveTextContent(PARTIAL_SENTENCE);
    expect(within(notice).getAllByRole('listitem').map((li) => li.textContent)).toEqual([CLOSED_CASE, APPROVAL_LOCK]);
    expect(ds.undoImportJob).toHaveBeenCalledWith(JOB_ID);
    // The re-read job is still undoable: Undo stays, "Undone" does not appear.
    await waitFor(() => expect(screen.getByTestId('import-cancelled-undo')).toBeEnabled(), WAIT);
    expect(screen.queryByTestId('import-cancelled-reverted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-cancelled-undo-error')).not.toBeInTheDocument();
  }, 20000);
});
