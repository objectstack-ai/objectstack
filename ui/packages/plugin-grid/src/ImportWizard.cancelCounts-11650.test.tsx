/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * Cancelling a background import shows what the server committed, with Undo
 * (objectui#11650).
 *
 * ## The defect
 *
 * `handleCancelImport` built its result with `importedRows: 0` and never read
 * the job back, so the wizard said "Import cancelled" over a "0 imported" badge
 * while the job it had just cancelled read `cancelled` with the rows its worker
 * had already committed — and the only way to Undo them was the History list,
 * which the result screen does not link to.
 *
 * ## Why one read after the cancel is not the answer
 *
 * The server's cancel route marks the job row `cancelled` itself, before the
 * worker notices. Cancel is cooperative: the worker writes on to its next
 * progress boundary, then writes the final counts and (for a job it can undo)
 * the undo log. So the first read after the cancel is already terminal, but
 * its counts can still grow and it is not yet undoable. The scripted reads
 * below reproduce that order: an early terminal read with fewer rows, then the
 * settled one. A wizard that trusted the first terminal read shows 1800 here,
 * not 2000, and offers no Undo.
 *
 * ## Undo refreshes the list it changed
 *
 * The cancel now hands the cancelled result to `onComplete`, so the host's
 * list refetches and shows the committed rows. An Undo deletes them again, so
 * the shared undo action announces the change on the data-invalidation bus
 * (`notifyDataChanged`), as every write path should. Without it, the list kept
 * showing the undone rows, from the History list and from the result screen.
 *
 * Real timers throughout: the wizard polls on its own 800 ms interval, and the
 * pins wait on it with explicit timeouts rather than faking the clock under
 * React Testing Library's own waits.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { subscribeDataChanges, type DataChange } from '@object-ui/react';
import { ImportWizard } from './ImportWizard';
import type { ImportJobProgressInfo, ImportJobResultsInfo, ImportJobSummaryInfo } from '@object-ui/types';

const FIELDS = [{ name: 'name', label: 'Name', type: 'text' }];
const JOB_ID = 'imp_11650';
const WAIT = { timeout: 6000 };

/** A job read with the counters the pins vary; everything else fixed. */
function jobRead(over: Partial<ImportJobProgressInfo>): ImportJobProgressInfo {
  return {
    jobId: JOB_ID,
    object: 'contact',
    status: 'running',
    total: 5000,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    percentComplete: 0,
    undoable: false,
    ...over,
  };
}

const RUNNING = jobRead({ status: 'running', processed: 1000, created: 1000, percentComplete: 20 });
// The cancel route's own write: terminal, but the worker is still on its batch.
const CANCELLED_EARLY = jobRead({ status: 'cancelled', processed: 1800, created: 1800, percentComplete: 36 });
// The worker's final write: the committed counts, and the undo log behind `undoable`.
const CANCELLED_FINAL = jobRead({ status: 'cancelled', processed: 2000, created: 1950, updated: 50, percentComplete: 40, undoable: true });

type Step = ImportJobProgressInfo | Error | (() => Promise<ImportJobProgressInfo>);

/**
 * A data source whose job reads come from two scripts: `poll` answers the
 * wizard's progress reads until the user cancels, `afterCancel` answers every
 * read from then on. Each script's last step repeats.
 */
function scriptedDataSource(poll: Step[], afterCancel: Step[]) {
  let cancelled = false;
  let pollAt = 0;
  let cancelAt = 0;
  const next = (script: Step[], at: number): Promise<ImportJobProgressInfo> => {
    const step = script[Math.min(at, script.length - 1)];
    if (typeof step === 'function') return step();
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
  const ds = {
    createImportJob: vi.fn(async () => ({ jobId: JOB_ID, object: 'contact', status: 'pending', total: 5000 })),
    getImportJobProgress: vi.fn((_id: string) =>
      cancelled ? next(afterCancel, cancelAt++) : next(poll, pollAt++)),
    getImportJobResults: vi.fn(async (): Promise<ImportJobResultsInfo> => ({
      ...jobRead({ status: 'succeeded', processed: 5000, created: 5000, percentComplete: 100 }),
      results: [],
      resultsTruncated: false,
    })),
    cancelImportJob: vi.fn(async (_id: string) => { cancelled = true; }),
    undoImportJob: vi.fn(async (id: string) => ({ success: true, jobId: id, object: 'contact', deleted: 1950, restored: 50, failed: 0 })),
  };
  return ds;
}

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Drive the wizard to a running background job: paste, map, tick
 *  background import, Run, and wait for the in-flight Cancel button. */
async function startBackgroundImport(dataSource: unknown, onComplete: (r: unknown) => void) {
  render(
    <ImportWizard
      objectName="contact"
      fields={FIELDS}
      dataSource={dataSource}
      open
      onOpenChange={() => {}}
      onComplete={onComplete}
    />,
  );
  pasteRows('Name\nAda\nGrace\nEdsger');
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  const background = await screen.findByTestId('import-opt-background');
  fireEvent.click(within(background).getByRole('checkbox'));
  fireEvent.click(screen.getByTestId('import-run-btn'));
  return screen.findByTestId('import-cancel-async');
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ImportWizard: a cancelled background import reports the job it cancelled (objectui#11650)', () => {
  it('cancel mid-run: the summary equals the settled job counts, with Undo, and onComplete once', async () => {
    const ds = scriptedDataSource([RUNNING], [CANCELLED_EARLY, CANCELLED_FINAL]);
    const onComplete = vi.fn();
    const cancel = await startBackgroundImport(ds, onComplete);
    // Mid-run: the poll loop has read the job at least once before the cancel.
    await screen.findByText(/Importing 1000 of 5000 rows/, undefined, WAIT);

    fireEvent.click(cancel);

    expect(await screen.findByText('Import cancelled', undefined, WAIT)).toBeInTheDocument();
    expect(ds.cancelImportJob).toHaveBeenCalledWith(JOB_ID);
    expect(screen.getByText('1950 created')).toBeInTheDocument();
    expect(screen.getByText('50 updated')).toBeInTheDocument();
    expect(screen.queryByText('1800 created')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 imported/)).not.toBeInTheDocument();
    expect(screen.getByTestId('import-cancelled-undo')).toHaveTextContent('Undo import');

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      cancelled: true, importedRows: 2000, createdRows: 1950, updatedRows: 50, skippedRows: 0,
    });
  }, 20000);

  it('a job still running on the first read after the cancel is shown once a later read settles', async () => {
    const stillRunning = jobRead({ status: 'running', processed: 1900, created: 1900, percentComplete: 38 });
    const ds = scriptedDataSource([RUNNING], [stillRunning, CANCELLED_FINAL]);
    const onComplete = vi.fn();
    const cancel = await startBackgroundImport(ds, onComplete);

    fireEvent.click(cancel);

    expect(await screen.findByText('1950 created', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Import cancelled')).toBeInTheDocument();
    expect(screen.queryByText('1900 created')).not.toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  }, 20000);

  it('a job that never reads undoable is final once two cancelled reads agree, and offers no Undo', async () => {
    const grown = jobRead({ status: 'cancelled', processed: 2000, created: 2000, percentComplete: 40 });
    const ds = scriptedDataSource([RUNNING], [CANCELLED_EARLY, grown, grown]);
    const onComplete = vi.fn();
    const cancel = await startBackgroundImport(ds, onComplete);

    fireEvent.click(cancel);

    expect(await screen.findByText('2000 created', undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText('1800 created')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-cancelled-undo')).not.toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ cancelled: true, importedRows: 2000, createdRows: 2000 });
  }, 20000);

  it('Undo on the cancelled result rolls the job back and then reads "Undone"', async () => {
    const reverted = { ...CANCELLED_FINAL, undoable: false, revertedAt: '2026-10-05T10:00:00.000Z' };
    const ds = scriptedDataSource([RUNNING], [CANCELLED_FINAL]);
    // This DOM environment ships no window.confirm; the Undo confirm reads it.
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const cancel = await startBackgroundImport(ds, vi.fn());

    fireEvent.click(cancel);
    const undo = await screen.findByTestId('import-cancelled-undo', undefined, WAIT);
    ds.getImportJobProgress.mockImplementation(async () => reverted);
    fireEvent.click(undo);

    expect(await screen.findByTestId('import-cancelled-reverted', undefined, WAIT)).toHaveTextContent('Undone');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(ds.undoImportJob).toHaveBeenCalledTimes(1);
    expect(ds.undoImportJob).toHaveBeenCalledWith(JOB_ID);
    expect(screen.queryByTestId('import-cancelled-undo')).not.toBeInTheDocument();
  }, 20000);

  it('Undo on the cancelled result tells the readers of the object that its data changed', async () => {
    const ds = scriptedDataSource([RUNNING], [CANCELLED_FINAL]);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const cancel = await startBackgroundImport(ds, vi.fn());
    fireEvent.click(cancel);
    const undo = await screen.findByTestId('import-cancelled-undo', undefined, WAIT);
    const changes: DataChange[] = [];
    const unsubscribe = subscribeDataChanges((change) => { changes.push(change); });
    try {
      fireEvent.click(undo);
      await waitFor(() => expect(ds.undoImportJob).toHaveBeenCalledTimes(1), WAIT);
      await waitFor(() => expect(changes).toEqual([{ objectName: 'contact' }]), WAIT);
    } finally {
      unsubscribe();
    }
  }, 20000);

  it('Undo from the History list tells the readers of the object that its data changed, and a failed undo does not', async () => {
    const row: ImportJobSummaryInfo = {
      jobId: JOB_ID, object: 'contact', status: 'cancelled', total: 5000, processed: 2000,
      created: 1950, updated: 50, skipped: 0, errors: 0, undoable: true,
    };
    const undoImportJob = vi.fn()
      .mockRejectedValueOnce(new Error('undo failed'))
      .mockResolvedValueOnce({ success: true, jobId: JOB_ID, object: 'contact', deleted: 1950, restored: 50, failed: 0 });
    const ds = { listImportJobs: vi.fn(async () => [row]), undoImportJob };
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(
      <ImportWizard objectName="contact" fields={FIELDS} dataSource={ds} open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('import-history-toggle'));
    const undo = await screen.findByTestId(`import-history-undo-${JOB_ID}`);
    const changes: DataChange[] = [];
    const unsubscribe = subscribeDataChanges((change) => { changes.push(change); });
    try {
      fireEvent.click(undo);
      await waitFor(() => expect(undoImportJob).toHaveBeenCalledTimes(1));
      // The panel reloads after the attempt; wait for the row's Undo to be live again.
      await waitFor(() => expect(screen.getByTestId(`import-history-undo-${JOB_ID}`)).toBeEnabled());
      await waitFor(() => expect(ds.listImportJobs).toHaveBeenCalledTimes(2));
      expect(changes).toEqual([]);
      fireEvent.click(screen.getByTestId(`import-history-undo-${JOB_ID}`));
      await waitFor(() => expect(undoImportJob).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(changes).toEqual([{ objectName: 'contact' }]));
    } finally {
      unsubscribe();
    }
  });

  it('a Cancel clicked while a poll read is in flight publishes one result and calls onComplete once', async () => {
    let releasePoll: (read: ImportJobProgressInfo) => void = () => {};
    const inFlight = () => new Promise<ImportJobProgressInfo>((resolve) => { releasePoll = resolve; });
    const ds = scriptedDataSource([inFlight], [CANCELLED_FINAL]);
    const onComplete = vi.fn();
    const cancel = await startBackgroundImport(ds, onComplete);
    // The poll loop's first read is now pending.
    await waitFor(() => expect(ds.getImportJobProgress).toHaveBeenCalledTimes(1), WAIT);

    fireEvent.click(cancel);
    expect(await screen.findByText('1950 created', undefined, WAIT)).toBeInTheDocument();
    // The poll loop's read now lands too — already terminal, as the server
    // answers it after the cancel route ran.
    await act(async () => { releasePoll(CANCELLED_EARLY); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('1800 created')).not.toBeInTheDocument();
  }, 20000);

  it('the poll loop does not take a job cancelled elsewhere as final on its first cancelled read', async () => {
    const ds = scriptedDataSource([RUNNING, CANCELLED_EARLY, CANCELLED_FINAL], []);
    const onComplete = vi.fn();
    await startBackgroundImport(ds, onComplete);

    expect(await screen.findByText('1950 created', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText('Import cancelled')).toBeInTheDocument();
    expect(ds.cancelImportJob).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ cancelled: true, importedRows: 2000 });
  }, 20000);

  it('closing the wizard mid-run still reports the background job through onComplete once it finishes', async () => {
    const succeeded = jobRead({ status: 'succeeded', processed: 5000, created: 5000, percentComplete: 100 });
    const ds = scriptedDataSource([RUNNING, succeeded], []);
    const onComplete = vi.fn();
    await startBackgroundImport(ds, onComplete);
    // The dialog's own close control: the host unmounts or hides the wizard,
    // and the job keeps running server-side.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), WAIT);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ importedRows: 5000, createdRows: 5000 });
    expect(onComplete.mock.calls[0][0].cancelled).toBeUndefined();
    expect(ds.cancelImportJob).not.toHaveBeenCalled();
  }, 20000);

  it('when no read settles within the bound, the result shows no count it never read and skips onComplete', async () => {
    const ds = scriptedDataSource([RUNNING], [new Error('network down')]);
    const onComplete = vi.fn();
    const cancel = await startBackgroundImport(ds, onComplete);

    fireEvent.click(cancel);

    expect(await screen.findByText('Import cancelled', undefined, { timeout: 12000 })).toBeInTheDocument();
    expect(screen.queryByText(/imported/)).not.toBeInTheDocument();
    expect(screen.queryByText(/created/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-cancelled-undo')).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  }, 20000);
});
