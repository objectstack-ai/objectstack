/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cross-page "Select all N matching" under ListView's EXTERNAL pagination
 * (objectui#4464).
 *
 * `BulkActionBar` gates the cross-page banner on `totalMatching`, and the only
 * writer of the `totalMatching` STATE is `setTotalMatching(...)` inside
 * ObjectGrid's own data loader. In the console the grid never runs that loader:
 * ListView fetches the rows itself and hands the window down as `data` plus
 * `manualPagination` / `rowCount` / `page` / `onPageChange`, so the grid takes
 * the inline-data path, `totalMatching` stays `undefined`, and the banner
 * condition is permanently false — for any match-set size. Found by a retest of
 * `records-forms.bulk-select-all-matching` (objectstack#7439) against a genuinely
 * server-paginated view: 26 records, pageSize 10, "Page 1 of 3", select the whole
 * page → only `10 selected | Delete | Clear`.
 *
 * WHY THIS FILE LIVES IN plugin-list, NOT plugin-grid
 * ObjectGrid rendered in isolation fetches its own rows, which runs the internal
 * loader and populates `totalMatching` — precisely the path the console does not
 * take. A unit test there is structurally blind to this defect and stays green
 * either side of the fix. The pin has to be the ListView-hosted composition, so
 * that what is asserted is the real prop handoff (`ListView.tsx` ~:3079) meeting
 * the real consumer (`ObjectGrid.tsx`).
 *
 * The grid here is the REAL `@object-ui/plugin-grid` renderer, not a stub: this
 * file is listed in `heavyDomTests` (vitest.config.mts), whose setup imports
 * plugin-grid for its side-effect registration. That keeps the composition
 * honest without plugin-list taking a dependency on plugin-grid.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { I18nProvider, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const OBJECT = 'showcase_contact';
const TOTAL = 26;
const PAGE_SIZE = 10;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/**
 * A server that pages for real: it answers `$top`/`$skip` with that window and
 * reports the full match count as `total` — the shape ListView reads into
 * `serverTotal` and forwards as the grid's `rowCount`.
 */
function makeDataSource(total = TOTAL) {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params?.$top ?? PAGE_SIZE;
    const skip = params?.$skip ?? 0;
    const data = Array.from(
      { length: Math.max(0, Math.min(top, total - skip)) },
      (_, i) => ({ id: `c-${skip + i}`, name: `Contact ${skip + i}` }),
    );
    return { data, total, hasMore: skip + data.length < total };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

const listSchema = (over: Record<string, unknown> = {}): ListViewSchema => ({
  type: 'list-view',
  objectName: OBJECT,
  fields: ['name'],
  // A view authored with a page size is what turns on ListView's real
  // server-side paging — the reproduction's `config.pagination.pageSize`.
  pagination: { pageSize: PAGE_SIZE },
  selection: { type: 'multiple' },
  ...over,
} as unknown as ListViewSchema);

// BulkActionBar surfaces its strings through the i18n layer, so every render
// wraps in an English provider — without one `{{count}}` interpolation never
// runs and the raw templates reach the DOM, which would make "carries the
// server total" unassertable (same reason as `BulkActionBar.test.tsx`).
function renderComposition(ds: any, schema: ListViewSchema) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

const headerCheckbox = () =>
  document.querySelector('thead [role="checkbox"]') as HTMLElement | null;
const rowCheckboxes = () =>
  Array.from(document.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];

/** Rows are on screen and the grid holds exactly one server window. */
async function awaitFirstPage() {
  await waitFor(() => expect(screen.getByText('Contact 0')).toBeInTheDocument());
  await waitFor(() => expect(rowCheckboxes().length).toBe(PAGE_SIZE));
}

async function selectWholePage() {
  await awaitFirstPage();
  fireEvent.click(headerCheckbox() as HTMLElement);
  await waitFor(() => expect(headerCheckbox()?.getAttribute('data-state')).toBe('checked'));
  return screen.getByTestId('bulk-actions-bar');
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe('ListView-hosted grid — cross-page select-all under external pagination (#4464)', () => {
  it('offers the cross-page banner when the whole server page is selected', async () => {
    const ds = makeDataSource();
    renderComposition(ds, listSchema());

    const bar = await selectWholePage();

    // The whole page — and only the page — is selected.
    expect(within(bar).getByText(/10 selected/)).toBeInTheDocument();

    // Pre-fix BOTH of these were absent, because `totalMatching` was written
    // only by a loader that never ran on this path.
    expect(screen.getByTestId('bulk-cross-page-banner')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-select-all-matching')).toBeInTheDocument();
  });

  it('carries the SERVER total in the escalation, not the page window', async () => {
    const ds = makeDataSource();
    renderComposition(ds, listSchema());

    await selectWholePage();

    // 26 is `result.total` — the number ListView passes down as `rowCount`.
    // The window (10) is what a page-local count would report instead.
    expect(await screen.findByTestId('bulk-select-all-matching')).toHaveTextContent(
      'Select all 26 matching',
    );
    expect(screen.getByTestId('bulk-cross-page-banner')).toHaveTextContent(
      'All 10 on this page are selected.',
    );
  });

  it('escalates the selection past the page when "Select all matching" is clicked', async () => {
    const ds = makeDataSource();
    renderComposition(ds, listSchema());

    const bar = await selectWholePage();
    fireEvent.click(await screen.findByTestId('bulk-select-all-matching'));

    // The selection state is now the whole match set (26), not the window (10):
    // the escalation button is gone and the bar reports the match count.
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('bulk-cross-page-banner')).toHaveTextContent(
      'All 26 matching records are selected.',
    );
    expect(within(bar).getByText(/26 selected \(all matches\)/)).toBeInTheDocument();

    // Scope note: the COLLECTED id set is materialized only when a bulk action
    // is dispatched (`resolveBulkRows` re-issues the query), so it is not
    // observable from the selection UI *this* case drives — it pins the
    // selection-state escalation. The dispatched fan-out is pinned end to end by
    // the last describe block in this file, which #4501 (PR #4510, since landed)
    // is what made assertable: before it there was no query on this path to
    // replay, so there was nothing honest to assert.
  });

  it('shows no banner for a partial page selection', async () => {
    const ds = makeDataSource();
    renderComposition(ds, listSchema());
    await awaitFirstPage();

    fireEvent.click(rowCheckboxes()[0]);
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    expect(within(screen.getByTestId('bulk-actions-bar')).getByText(/1 selected/)).toBeInTheDocument();

    // `totalMatching` IS 26 here after the fix — the banner stays away purely
    // because the selection is short of a full page. That is the clause this
    // case pins, and it is the one the fix could plausibly have widened.
    expect(screen.queryByTestId('bulk-cross-page-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument();
  });

  it('suppresses the escalation entirely under selection.type = single', async () => {
    const ds = makeDataSource();
    renderComposition(ds, listSchema({ selection: { type: 'single' } }));
    await awaitFirstPage();

    // Honest limit of this case: `selection.type: 'single'` caps the selection
    // at one row (the data-table enforces replace-on-select, #2941), so the
    // count clause alone would keep the banner away even if the
    // `singleSelection ? undefined : …` prop gate were dropped. It is kept
    // because it is the console-visible must-not-change; the prop gate itself
    // is only pinned by inspection.
    fireEvent.click(rowCheckboxes()[0]);
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-cross-page-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument();
  });
});

describe('standalone ObjectGrid — the internal-loader path is unchanged (#4464)', () => {
  // The must-not-change side: a grid that fetches its OWN rows still resolves
  // the total from `result.total` and offers the banner at the same thresholds.
  // Rendered through the registry (`type: 'object-grid'`) rather than by
  // importing the component, so plugin-list keeps no dependency on plugin-grid.
  const gridSchema = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: ['name'],
    selection: { type: 'multiple' },
    pagination: { pageSize: PAGE_SIZE },
  };

  it('still offers "Select all 26 matching" when it loads its own rows', async () => {
    const ds = makeDataSource();
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={ds}>
          <SchemaRenderer schema={gridSchema as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await selectWholePage();

    expect(screen.getByTestId('bulk-cross-page-banner')).toBeInTheDocument();
    expect(await screen.findByTestId('bulk-select-all-matching')).toHaveTextContent(
      'Select all 26 matching',
    );
  });
});

/**
 * The full path, end to end — the assertion #4501 (PR #4510) made possible.
 *
 * Two halves meet here and neither is sufficient alone. #4510 pinned the SEAM in
 * two places, each with one side stubbed or synthesized: `ListView.findParamsHandoff`
 * asserts the producer against a STUB grid, and `plugin-grid`'s
 * `bulkFanoutHostParams` asserts the consumer against a HAND-WRITTEN `HOST_PARAMS`
 * literal, reaching the escalation only by starting on the internal path and
 * re-rendering into host-driven mode — because on `main` the pure host path could
 * not reach the affordance at all. That was #4464's defect, and this branch's fix.
 *
 * So this block is the composition neither could make: the REAL ListView issuing a
 * REAL filtered query, the REAL grid offering the escalation off the host's
 * `rowCount`, and the dispatched fan-out replaying the very params that produced
 * the rows on screen — compared against what ListView actually put on the wire, not
 * against a literal that can drift from it.
 *
 * It is also the composed shape's own pin: the offer needs #4510's FLOOR (params
 * present) and its count comes from #4503's RESOLVED total (the host's `rowCount`).
 * Drop either and this case fails — no affordance, or "Select all undefined".
 */
describe('ListView-hosted grid — the escalation fans out with the HOST\'s real query (#4464 × #4501)', () => {
  /** 40 records; the view's filter matches 26 of them (`c-14` … `c-39`). */
  const ALL = Array.from({ length: 40 }, (_, i) => ({
    id: `c-${i}`,
    name: `Contact ${i}`,
    status: i >= 14 ? 'active' : 'archived',
  }));
  const MATCHING = ALL.filter((r) => r.status === 'active');

  /** A server that answers the query it is given — filtered or not. */
  function makeFilteringDataSource() {
    const find = vi.fn(async (_object: string, params: any) => {
      const source = params?.$filter ? MATCHING : ALL;
      const top = params?.$top ?? PAGE_SIZE;
      const skip = params?.$skip ?? 0;
      const data = source.slice(skip, skip + top).map((r) => ({ ...r }));
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

  it('replays the $filter/$orderby ListView queried with, and delivers the match set', async () => {
    const ds = makeFilteringDataSource();
    const onBulkDelete = vi.fn();
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={ds}>
          <ListView
            schema={listSchema({
              filter: [{ field: 'status', operator: 'equals', value: 'active' }],
              sort: [{ field: 'name', order: 'asc' }],
              bulkActions: ['delete'],
            })}
            dataSource={ds}
            onBulkDelete={onBulkDelete}
          />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    // The window on screen is page 1 of the FILTERED collection.
    await waitFor(() => expect(screen.getByText('Contact 14')).toBeInTheDocument());
    await waitFor(() => expect(rowCheckboxes().length).toBe(PAGE_SIZE));
    // What ListView actually asked the server — the yardstick for the replay.
    const hostParams = { ...ds.find.mock.calls[ds.find.mock.calls.length - 1][1] };
    expect(hostParams.$filter).toBeTruthy();

    fireEvent.click(headerCheckbox() as HTMLElement);
    // The offer itself is the composition: #4510's floor admits it (ListView
    // handed `findParams` down) and #4503's resolved total gives it its count.
    expect(await screen.findByTestId('bulk-select-all-matching')).toHaveTextContent(
      `Select all ${MATCHING.length} matching`,
    );
    fireEvent.click(screen.getByTestId('bulk-select-all-matching'));
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-select-all-matching')).not.toBeInTheDocument(),
    );

    // Dispatch the bulk action: THIS is what materializes the fanned-out set.
    const before = ds.find.mock.calls.length;
    fireEvent.click(screen.getByTestId('bulk-action-delete'));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalled());
    const fanout = ds.find.mock.calls.slice(before).map((c: any[]) => c[1]);

    // One 500-record page, carrying the host's query verbatim — `$filter` and
    // `$orderby` included. Pre-#4510 this was `{}`: the whole-object read.
    expect(fanout).toHaveLength(1);
    const { $top: _top, $skip: _skip, ...replayed } = hostParams;
    expect(fanout[0]).toEqual({ ...replayed, $top: 500, $skip: 0 });

    // …so the executor receives the MATCH SET and nothing outside it.
    const delivered = onBulkDelete.mock.calls[0][0];
    expect(delivered).toHaveLength(MATCHING.length);
    expect(delivered.every((r: any) => r.status === 'active')).toBe(true);
    expect(delivered.some((r: any) => r.id === 'c-0')).toBe(false);
  });
});
