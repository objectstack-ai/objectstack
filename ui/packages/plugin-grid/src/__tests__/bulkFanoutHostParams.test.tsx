/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The cross-page "select all N matching" fan-out replays the query behind the
 * rows on screen — or the escalation is not offered at all (objectui#4501).
 *
 * `resolveBulkRows` re-issues the view's query in 500-record pages so a bulk
 * action receives the whole match set rather than the visible window. The query
 * it replayed came from `lastFindParamsRef`, whose ONLY writer is ObjectGrid's
 * own data loader. Under a host that fetches the rows itself — ListView passing
 * `data` + `manualPagination` + `rowCount`, i.e. the console — that loader never
 * runs (`if (hasInlineData) return`), so the ref is not the query behind the
 * rows: absent (`{}` after the old `?? {}`) or stale from an earlier own-fetch.
 * Either way the fan-out asked the server for the WHOLE OBJECT — no `$filter`,
 * no `$orderby`, no `$search` — and handed up to 5000 unmatched records to a
 * destructive executor (`onBulkDelete`) while the bar said "All N matching".
 *
 * WHY THE HARNESS SWITCHES MODES MID-TEST
 * On `main` the pure host path cannot reach the escalation at all: the banner is
 * gated on the `totalMatching` STATE, which that same loader is the only writer
 * of, so it is `undefined` and the affordance never appears (objectui#4464 —
 * PR #4503 is the fix, deliberately held behind this guard). A test that renders
 * only the host path would therefore be green either side of this change, for
 * the wrong reason. So each case starts on the INTERNAL path (one own-fetch:
 * `totalMatching` = 40, `lastFindParamsRef` = that unfiltered query) and then
 * re-renders into the host-driven mode. That is a genuinely reachable
 * composition, and it puts the seam under the test today: the rows on screen are
 * the host's filtered window, the escalation is reachable, and `lastFindParamsRef`
 * is a query that is NOT the one behind them.
 *
 * The count the bar shows in this harness is the stale internal `totalMatching`
 * (40, not 26) — that half is #4464/#4503's, not this card's, and is left alone
 * here. What these cases assert is the SET the fan-out collects and hands to the
 * executor.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: () => true,
    }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, I18nProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'showcase_contact';
const PAGE_SIZE = 10;

/** The whole object — what an unfiltered fan-out collects. */
const ALL = Array.from({ length: 40 }, (_, i) => ({
  id: `r-${i}`,
  name: `Row ${i}`,
  status: i >= 14 ? 'active' : 'archived',
}));
/** What the HOST's query matches: 26 records, `r-14` … `r-39`. */
const MATCHING = ALL.filter(r => r.status === 'active');

/**
 * The params the external-pagination host used for the window it handed down —
 * measured against `ListView.tsx`'s own `dataSource.find` literal, key for key:
 * `$filter` (lowered AST) / `$orderby` (SortNode[]) / `$top` / `$select` /
 * `$search`, `$skip` present only past page 1.
 */
const HOST_PARAMS: Record<string, unknown> = {
  $filter: ['status', '=', 'active'],
  $orderby: [{ field: 'name', order: 'asc' }],
  $top: PAGE_SIZE,
  $select: ['id', 'name', 'status'],
  $search: 'Row',
};

/** A second host query — the user changed the filter in the host's toolbar. */
const HOST_PARAMS_2: Record<string, unknown> = {
  ...HOST_PARAMS,
  $filter: ['status', '=', 'archived'],
};

function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    // The server answers the query it is given: with a `$filter` it returns the
    // 26 matching records, without one the whole 40-record object.
    const source = params?.$filter ? MATCHING : ALL;
    const top = params?.$top ?? PAGE_SIZE;
    const skip = params?.$skip ?? 0;
    const data = source.slice(skip, skip + top).map(r => ({ ...r }));
    return { data, total: source.length, hasMore: skip + data.length < source.length };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
    }),
  } as any;
}

const schema: any = {
  type: 'object-grid',
  objectName: OBJECT,
  columns: ['name'],
  selection: { type: 'multiple' },
  // A declared bulk action is a WIRING declaration; `onBulkDelete` below owns
  // the execution, so clicking Delete is what materializes the fanned-out set.
  bulkActions: ['delete'],
  pagination: { pageSize: PAGE_SIZE },
};

/** The host window: page 1 of the FILTERED collection (`Row 14` … `Row 23`). */
const HOST_WINDOW = MATCHING.slice(0, PAGE_SIZE);

function hostProps(over: Record<string, unknown> = {}) {
  return {
    data: HOST_WINDOW,
    manualPagination: true,
    rowCount: MATCHING.length,
    page: 1,
    pageSize: PAGE_SIZE,
    onPageChange: () => {},
    ...over,
  };
}

function tree(ds: any, onBulkDelete: any, extra: Record<string, unknown>) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider handlers={{}}>
        <ObjectGrid schema={schema} dataSource={ds} onBulkDelete={onBulkDelete} {...(extra as any)} />
      </ActionProvider>
    </I18nProvider>
  );
}

const headerCheckbox = () =>
  document.querySelector('thead [role="checkbox"]') as HTMLElement | null;
const rowCheckboxes = () =>
  Array.from(document.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];

/**
 * One own-fetch on the INTERNAL path (so `totalMatching` and `lastFindParamsRef`
 * are populated), then hand the grid the host's filtered window.
 */
async function renderThenHandOff(ds: any, hostOver: Record<string, unknown> = {}) {
  const onBulkDelete = vi.fn();
  const { rerender } = render(tree(ds, onBulkDelete, {}));
  // Internal load: the grid's own unfiltered query.
  await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
  const internalParams = { ...ds.find.mock.calls[0][1] };

  rerender(tree(ds, onBulkDelete, hostProps(hostOver)));
  // The rows on screen are now the host's filtered window.
  await waitFor(() => expect(screen.getByText('Row 14')).toBeInTheDocument());
  await waitFor(() => expect(rowCheckboxes().length).toBe(PAGE_SIZE));
  return { onBulkDelete, rerender, internalParams };
}

async function selectWholePage() {
  fireEvent.click(headerCheckbox() as HTMLElement);
  await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
  await waitFor(() =>
    expect(within(screen.getByTestId('bulk-actions-bar')).getByText(/10 selected/)).toBeInTheDocument(),
  );
}

/** Click Delete and return the params of every `find` the fan-out issued. */
async function fanOutParams(ds: any, onBulkDelete: any) {
  const before = ds.find.mock.calls.length;
  fireEvent.click(screen.getByTestId('bulk-action-delete'));
  await waitFor(() => expect(onBulkDelete).toHaveBeenCalled());
  return ds.find.mock.calls.slice(before).map((c: any[]) => c[1]);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe('#4501 clause 1 — the fan-out replays the HOST\'s query', () => {
  it('issues the host\'s $filter/$orderby/$search/$select, not an unfiltered whole-object read', async () => {
    const ds = makeDataSource();
    const { onBulkDelete } = await renderThenHandOff(ds, { findParams: HOST_PARAMS });

    await selectWholePage();
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));

    const calls = await fanOutParams(ds, onBulkDelete);
    expect(calls).toHaveLength(1);
    // Verbatim: the host's query, windowed by the fan-out's own paging.
    expect(calls[0]).toEqual({
      $filter: ['status', '=', 'active'],
      $orderby: [{ field: 'name', order: 'asc' }],
      $select: ['id', 'name', 'status'],
      $search: 'Row',
      $top: 500,
      $skip: 0,
    });

    // …and therefore the executor receives the MATCH SET, nothing else.
    const delivered = onBulkDelete.mock.calls[0][0];
    expect(delivered).toHaveLength(MATCHING.length);
    expect(delivered.every((r: any) => r.status === 'active')).toBe(true);
    // `r-0` is in the object but NOT in the view's match set. Pre-fix the
    // unfiltered fan-out collected it and handed it to delete.
    expect(delivered.some((r: any) => r.id === 'r-0')).toBe(false);
  });
});

describe('#4501 clause 1b — the abstain floor', () => {
  it('does NOT offer the escalation when the host hands down no params', async () => {
    const ds = makeDataSource();
    // Same composition, one prop short: the host drives pagination but never
    // says what it queried. There is no query to replay, so the affordance is
    // absent — the same answer as a match set that does not exist.
    await renderThenHandOff(ds);

    await selectWholePage();

    expect(screen.queryByTestId('bulk-cross-page-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument();
    // The ordinary page selection is untouched — only the escalation is gone.
    expect(within(screen.getByTestId('bulk-actions-bar')).getByText(/10 selected/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument();
  });

  it('keeps the single-selection suppression', async () => {
    const ds = makeDataSource();
    const onBulkDelete = vi.fn();
    const singleSchema = { ...schema, selection: { type: 'single' } };
    const single = (extra: Record<string, unknown>) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <ActionProvider handlers={{}}>
          <ObjectGrid schema={singleSchema as any} dataSource={ds} onBulkDelete={onBulkDelete} {...(extra as any)} />
        </ActionProvider>
      </I18nProvider>
    );
    const { rerender } = render(single({}));
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    rerender(single({ ...hostProps(), findParams: HOST_PARAMS }));
    await waitFor(() => expect(screen.getByText('Row 14')).toBeInTheDocument());

    fireEvent.click(rowCheckboxes()[0]);
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    // Params ARE available here; the suppression is the `single` clause alone.
    expect(screen.queryByTestId('bulk-cross-page-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument();
  });
});

describe('#4501 clause 2 — the escalation resets when the host\'s query changes', () => {
  it('drops "all matching" when the host hands down a different query', async () => {
    const ds = makeDataSource();
    const { onBulkDelete, rerender } = await renderThenHandOff(ds, { findParams: HOST_PARAMS });

    await selectWholePage();
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));
    await waitFor(() =>
      expect(screen.getByTestId('bulk-cross-page-banner')).toHaveTextContent(/matching records are selected/),
    );

    // The user changes the filter in the host's toolbar.
    rerender(tree(ds, onBulkDelete, hostProps({ findParams: HOST_PARAMS_2 })));

    await waitFor(() =>
      expect(screen.getByTestId('bulk-select-all-matching')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('bulk-cross-page-banner')).toHaveTextContent(
      'All 10 on this page are selected.',
    );
  });

  it('survives a re-render that hands down an EQUAL query (a plain refetch)', async () => {
    const ds = makeDataSource();
    const { onBulkDelete, rerender } = await renderThenHandOff(ds, { findParams: HOST_PARAMS });

    await selectWholePage();
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));
    await waitFor(() =>
      expect(screen.getByTestId('bulk-cross-page-banner')).toHaveTextContent(/matching records are selected/),
    );

    // A fresh object with identical content — what a host re-render produces.
    rerender(tree(ds, onBulkDelete, hostProps({ findParams: { ...HOST_PARAMS } })));

    await waitFor(() => expect(screen.getByTestId('bulk-cross-page-banner')).toBeInTheDocument());
    expect(screen.getByTestId('bulk-cross-page-banner')).toHaveTextContent(
      /matching records are selected/,
    );
    expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument();
  });
});

describe('#4501 must-not-change — the internal-loader path', () => {
  it('fans out from the ref, byte for byte, when the grid owns the fetch', async () => {
    const ds = makeDataSource();
    const onBulkDelete = vi.fn();
    // A grid with its own filtered query: the loader runs, so the ref holds it.
    const own = { ...schema, filter: [{ field: 'status', operator: 'equals', value: 'active' }] };
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <ActionProvider handlers={{}}>
          <ObjectGrid schema={own as any} dataSource={ds} onBulkDelete={onBulkDelete} />
        </ActionProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Row 14')).toBeInTheDocument());
    const loadParams = { ...ds.find.mock.calls[0][1] };
    expect(loadParams.$filter).toBeTruthy();

    await selectWholePage();
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));
    const calls = await fanOutParams(ds, onBulkDelete);

    // Exactly the loader's own params, with the fan-out's window swapped in.
    const { $top: _t, $skip: _s, ...rest } = loadParams;
    expect(calls[0]).toEqual({ ...rest, $top: 500, $skip: 0 });
    expect(onBulkDelete.mock.calls[0][0]).toHaveLength(MATCHING.length);
  });

  it('still honours HARD_CAP over a match set larger than the cap', async () => {
    const ds = makeDataSource();
    const BIG = 6000;
    ds.find = vi.fn(async (_o: string, params: any) => {
      const top = params?.$top ?? PAGE_SIZE;
      const skip = params?.$skip ?? 0;
      const data = Array.from(
        { length: Math.max(0, Math.min(top, BIG - skip)) },
        (_, i) => ({ id: `b-${skip + i}`, name: `Row ${skip + i}` }),
      );
      return { data, total: BIG, hasMore: skip + data.length < BIG };
    });
    const onBulkDelete = vi.fn();
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <ActionProvider handlers={{}}>
          <ObjectGrid schema={schema} dataSource={ds} onBulkDelete={onBulkDelete} />
        </ActionProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    await selectWholePage();
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));
    const calls = await fanOutParams(ds, onBulkDelete);

    // 5000 / 500 = 10 pages, then the cap stops it — the 6000th record is never
    // requested and never delivered.
    expect(calls).toHaveLength(10);
    expect(calls.map((p: any) => p.$skip)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
    expect(onBulkDelete.mock.calls[0][0]).toHaveLength(5000);
  });
});
