/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression (#2159): after selecting rows and running a string bulk action
 * (e.g. 下推 / 派工 declared via `batchActions`), the operation succeeded on the
 * server but the list never refreshed — it stayed on stale data, and the
 * selection toolbar was left in place.
 *
 * Root cause: `dispatchBulkAction`'s non-delete branch fired `executeAction`
 * and stopped there — no `refreshKey` bump, no selection reset. Only the
 * BulkActionDialog (rich def) and delete branches refreshed. This drives the
 * full path (header checkbox → BulkActionBar → dispatchBulkAction →
 * ActionRunner custom handler) against an in-memory fake server, so a passing
 * test means the grid refetches after the action and a failing one pinpoints
 * the missing refresh.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'os_prod_plan';

// A fake server backed by a mutable store, so a bulk action can mutate records
// and a subsequent find() returns the new value — exactly like a real backend.
function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Plan A', status: 'draft' },
    r2: { id: 'r2', name: 'Plan B', status: 'draft' },
  };
  const find = vi.fn(async () => {
    const data = Object.values(store).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  // Per-row update primitive — the exact surface the rich-def executor
  // (useBulkExecutor, operation:'update') mutates through, per record.
  const update = vi.fn(async (_resource: string, id: string, patch: Record<string, any>) => {
    if (store[id]) Object.assign(store[id], patch);
    return { ...store[id] };
  });
  return {
    store,
    find,
    update,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'text' },
      },
    }),
  } as any;
}

function renderGrid(dataSource: any, handlers: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    // String bulk action — the path 下推 / 派工 travels.
    batchActions: ['approve'],
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'status', label: 'Status' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider handlers={handlers}>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

describe('ObjectGrid — string bulk action refreshes the list on success', () => {
  it('refetches and clears the selection after a batchAction succeeds', async () => {
    const ds = makeDataSource();
    // A custom bulk action that mutates the "server" and reports success.
    const approve = vi.fn(async () => {
      Object.values(ds.store).forEach((r: any) => { r.status = 'approved'; });
      return { success: true };
    });
    renderGrid(ds, { approve });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    // Initial "draft" is on screen; no "approved" yet.
    expect(screen.getAllByText('draft').length).toBeGreaterThan(0);
    const findCallsBefore = ds.find.mock.calls.length;

    // Select all rows on the page (header checkbox), then run the bulk action.
    const headerCheckbox = document.querySelector('thead [role="checkbox"]') as HTMLElement;
    expect(headerCheckbox).toBeTruthy();
    fireEvent.click(headerCheckbox);

    const approveBtn = await screen.findByTestId('bulk-action-approve');
    fireEvent.click(approveBtn);

    // The handler ran against the selected records.
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));

    // The list refetched — the grid reflects the server state (draft → approved).
    await waitFor(() =>
      expect(ds.find.mock.calls.length).toBeGreaterThan(findCallsBefore),
    );
    await waitFor(() => expect(screen.getAllByText('approved').length).toBeGreaterThan(0));

    // And the selection toolbar reset (no stuck "N selected" bar).
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
  });

  it('does NOT refresh or clear selection when the bulk action fails', async () => {
    const ds = makeDataSource();
    // A failing action must leave the selection intact (so the user can retry)
    // and must not trigger a phantom refresh.
    const approve = vi.fn(async () => ({ success: false, error: 'nope' }));
    renderGrid(ds, { approve });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    const findCallsBefore = ds.find.mock.calls.length;

    const headerCheckbox = document.querySelector('thead [role="checkbox"]') as HTMLElement;
    fireEvent.click(headerCheckbox);
    const approveBtn = await screen.findByTestId('bulk-action-approve');
    fireEvent.click(approveBtn);

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));

    // Give any (unwanted) refetch a chance to fire, then assert none did and the
    // selection bar is still present.
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.find.mock.calls.length).toBe(findCallsBefore);
    expect(screen.queryByTestId('bulk-actions-bar')).toBeInTheDocument();
  });
});

/**
 * Rich `bulkActionDefs` path — the mechanism the os-tianshun-ehr 排班计划 grid
 * actually uses for 下推 / 派工: `operation: 'update'`, `patch: { <trigger>: true }`,
 * `batchSize: 1` (per-row so each record independently trips its Hooks). This
 * travels bar → dispatchBulkActionDef → BulkActionDialog → useBulkExecutor
 * (dataSource.update per row) → onClose(result) → handleBulkDialogClose. This
 * refresh has existed since rich defs were introduced; the test guards it so the
 * production path never silently regresses to the string-path bug (#2159).
 */
function renderGridWithDefs(dataSource: any) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    // Mirrors production: update + trigger patch, batchSize 1 → per-row execution.
    bulkActionDefs: [
      {
        name: 'push_plan_bulk',
        label: '下推',
        operation: 'update',
        patch: { status: 'pushed' },
        batchSize: 1,
        confirmText: '确认下推勾选的计划吗？',
      },
    ],
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'status', label: 'Status' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider handlers={{}}>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

describe('ObjectGrid — rich bulk action def (operation:update) refreshes the list', () => {
  it('runs the def through the dialog, updates each row, and refetches on Done', async () => {
    const ds = makeDataSource();
    renderGridWithDefs(ds);

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    expect(screen.getAllByText('draft').length).toBeGreaterThan(0);
    const findCallsBefore = ds.find.mock.calls.length;

    // Select all rows, then open the rich-def dialog from the bar.
    const headerCheckbox = document.querySelector('thead [role="checkbox"]') as HTMLElement;
    expect(headerCheckbox).toBeTruthy();
    fireEvent.click(headerCheckbox);

    fireEvent.click(await screen.findByTestId('bulk-action-push_plan_bulk'));

    // Confirm step (no params) → Run, then the executor mutates each row.
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));

    // Result step → Done closes the dialog with a truthy result → refresh.
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    // The list refetched and reflects the server state (draft → pushed).
    await waitFor(() =>
      expect(ds.find.mock.calls.length).toBeGreaterThan(findCallsBefore),
    );
    await waitFor(() => expect(screen.getAllByText('pushed').length).toBeGreaterThan(0));

    // And the selection toolbar reset.
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
  });
});

/**
 * Selection desync (separate from #2159's refresh gap): closing the rich-def
 * dialog on Done cleared ObjectGrid's `selectedRows` (which drives the toolbar)
 * but never touched the DataTable's *internal* `selectedRowIds` (which drives
 * the checkboxes). After a run the toolbar vanished yet every row stayed
 * visibly ticked — and on a *total failure* the toolbar vanished too, stranding
 * the user with no way to retry the rows they'd selected.
 *
 * The fix gates the reset on `result.succeeded > 0` and, when it does reset,
 * bumps a `selectionResetKey` so the table drops its checkbox state in lockstep
 * with the toolbar. These tests pin both halves: success clears checkboxes +
 * toolbar together; total failure preserves both (and skips the refetch).
 */
describe('ObjectGrid — bulk dialog Done keeps selection in sync', () => {
  const headerChecked = () =>
    (document.querySelector('thead [role="checkbox"]') as HTMLElement)?.getAttribute('data-state');

  it('clears the row checkboxes (not just the toolbar) after a successful run', async () => {
    const ds = makeDataSource();
    renderGridWithDefs(ds);

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());

    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    // Header checkbox reflects "all selected" before the action runs.
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    fireEvent.click(await screen.findByTestId('bulk-action-push_plan_bulk'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    // Both selection sources reset in lockstep: toolbar gone AND boxes cleared.
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(headerChecked()).toBe('unchecked'));
  });

  it('keeps selection + toolbar and skips the refetch when every row fails', async () => {
    const ds = makeDataSource();
    // Every per-row update rejects → succeeded: 0, failed: 2.
    ds.update = vi.fn(async () => { throw new Error('precondition not met'); });

    renderGridWithDefs(ds);

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    const findCallsBefore = ds.find.mock.calls.length;

    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    fireEvent.click(await screen.findByTestId('bulk-action-push_plan_bulk'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    // Nothing changed on the server, so: no refetch, and the user keeps the
    // exact rows they picked (toolbar present, boxes still ticked) to retry.
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.find.mock.calls.length).toBe(findCallsBefore);
    expect(screen.queryByTestId('bulk-actions-bar')).toBeInTheDocument();
    expect(headerChecked()).toBe('checked');
  });
});

/**
 * Same desync, the OTHER dispatcher (#3056). `dispatchBulkAction` — the
 * by-name path and the bulk-delete path — cleared `selectedRows` (toolbar) but
 * never bumped `selectionResetKey` (checkboxes), so a successful run left the
 * user staring at a page of ticked rows with no toolbar to act on them. Only
 * the rich-def path above upheld the invariant; these pin the other two.
 *
 * Both survive objectui#3002: a name that resolves to a declared object action
 * is now promoted to a def and routes through the dialog instead, so what still
 * reaches `dispatchBulkAction` is a consumer-registered runner handler
 * (`approve` here) and the canonical `'delete'`.
 */
describe('ObjectGrid — dispatchBulkAction keeps selection in sync (#3056)', () => {
  const headerChecked = () =>
    (document.querySelector('thead [role="checkbox"]') as HTMLElement)?.getAttribute('data-state');

  it('clears the row checkboxes (not just the toolbar) after a by-name action', async () => {
    const ds = makeDataSource();
    const approve = vi.fn(async () => ({ success: true }));
    renderGrid(ds, { approve });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    fireEvent.click(await screen.findByTestId('bulk-action-approve'));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(headerChecked()).toBe('unchecked'));
  });

  it('leaves the checkboxes ticked when the by-name action fails', async () => {
    const ds = makeDataSource();
    const approve = vi.fn(async () => ({ success: false, error: 'nope' }));
    renderGrid(ds, { approve });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    fireEvent.click(await screen.findByTestId('bulk-action-approve'));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));

    // Failure keeps BOTH sources, so the user can retry the same rows.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('bulk-actions-bar')).toBeInTheDocument();
    expect(headerChecked()).toBe('checked');
  });

  it('clears the row checkboxes after a bulk delete', async () => {
    const ds = makeDataSource();
    const onBulkDelete = vi.fn();
    const schema: any = {
      type: 'object-grid',
      objectName: OBJECT,
      bulkActions: ['delete'],
      columns: [{ field: 'name', label: 'Name' }],
      pagination: { pageSize: 50 },
    };
    render(
      <ActionProvider handlers={{}}>
        <ObjectGrid schema={schema} dataSource={ds} onBulkDelete={onBulkDelete} />
      </ActionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    fireEvent.click(await screen.findByTestId('bulk-action-delete'));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(headerChecked()).toBe('unchecked'));
  });
});

/**
 * The SAME desync, the third selection-clearing site (#4140) — the bulk bar's
 * own **Clear** button. `resetSelection()` above upholds the #3056 invariant for
 * every dispatch path, but both `onClearSelection` props were hand-written as
 * `setSelectedRows([]); setSelectAllMatching(false);` — the two state writes
 * without the `selectionResetKey` bump. Clicking Clear therefore removed the
 * toolbar and left every row `data-state="checked"` (header `indeterminate` on a
 * partial pick): stranded ticks with no toolbar to act on them, which is the
 * literal failure the reset-key mechanism exists to prevent.
 *
 * Found by the records-forms QA run (objectstack#7439, `bulk-select-all-matching`
 * FAIL, reproduced 2x). These pin the button on BOTH selection sources and on
 * both bar instances' shared handler, so the next hand-copy cannot drift again.
 */
describe('ObjectGrid — bulk bar Clear resets both selection sources (#4140)', () => {
  const headerChecked = () =>
    (document.querySelector('thead [role="checkbox"]') as HTMLElement)?.getAttribute('data-state');
  const rowStates = () =>
    Array.from(document.querySelectorAll('tbody [role="checkbox"]')).map((el) =>
      el.getAttribute('data-state'),
    );
  const clickClear = () =>
    fireEvent.click(
      within(screen.getByTestId('bulk-actions-bar')).getByRole('button', { name: 'Clear' }),
    );

  it('unticks the row checkboxes (not just the toolbar) on a partial selection', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { approve: vi.fn(async () => ({ success: true })) });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());

    // Tick ONE of the two rows — the header goes `indeterminate`, which is the
    // exact state the QA repro reported as stuck after Clear.
    const firstRow = document.querySelectorAll('tbody [role="checkbox"]')[0] as HTMLElement;
    expect(firstRow).toBeTruthy();
    fireEvent.click(firstRow);
    await waitFor(() => expect(headerChecked()).toBe('indeterminate'));
    expect(rowStates()).toEqual(['checked', 'unchecked']);
    expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();

    clickClear();

    // Both sources reset in lockstep: toolbar gone AND the boxes untick.
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(rowStates()).toEqual(['unchecked', 'unchecked']));
    expect(headerChecked()).toBe('unchecked');
  });

  it('unticks the row checkboxes when the whole page was selected', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { approve: vi.fn(async () => ({ success: true })) });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    clickClear();

    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(headerChecked()).toBe('unchecked'));
    expect(rowStates()).toEqual(['unchecked', 'unchecked']);
  });

  it('drops the cross-page "all matching" state too, so a fresh pick starts clean', async () => {
    // `total` exceeds the returned page, so the bar offers "Select all N matching".
    const ds = makeDataSource();
    ds.find = vi.fn(async () => {
      const data = Object.values(ds.store).map((r: any) => ({ ...r }));
      return { data, total: 5, hasMore: true, pageSize: 50 };
    });
    renderGrid(ds, { approve: vi.fn(async () => ({ success: true })) });

    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));

    // Escalate to the cross-page selection, then Clear it.
    //
    // The banner's two branches are told apart *structurally*, by whether the
    // escalation button is still offered — not by its copy. These grid tests
    // wrap in `ActionProvider` only, with no `I18nProvider`, so `{{count}}`
    // interpolation never runs and count-bearing strings reach the DOM as the
    // raw template ("All {{count}} matching records are selected."). See
    // BulkActionBar.test.tsx, which asserts on that copy and therefore *does*
    // wrap in an English `I18nProvider`. Asserting the rendered count here
    // would pin i18n plumbing rather than the reset, and its negation would
    // pass for the wrong reason — the interpolated text is absent either side
    // of the fix. Structure is the right probe for a selection-state question.
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('bulk-cross-page-banner')).toBeInTheDocument();

    clickClear();

    await waitFor(() =>
      expect(screen.queryByTestId('bulk-actions-bar')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(headerChecked()).toBe('unchecked'));

    // Re-picking the page must start from scratch: the header checkbox is live
    // again (it would toggle the *other* way if the table still held the old
    // selection) and the bar offers the escalation rather than remembering it —
    // the button being back is exactly `selectAllMatching === false`.
    fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
    await waitFor(() => expect(headerChecked()).toBe('checked'));
    expect(await screen.findByTestId('bulk-select-all-matching')).toBeInTheDocument();
  });
});
