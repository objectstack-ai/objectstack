/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5795 — the `$orderby` a derived related list puts ON THE WIRE.
 *
 * Ruled on objectstack#11345 (maintainer, 2026-08-23 15:02Z), direction 1:
 * derived related lists inherit the child object's default list view `sort`,
 * with NO new spec key. The user-visible bug this closes: a task version's
 * "check items" tab rendered 20/30/10/40 (the server's primary-key fallback)
 * while the child object's own list, sorted by `seq_no`, rendered 10/20/30/40.
 *
 * ## Why this file renders the whole page instead of asserting the descriptor
 *
 * The descriptor `deriveRelatedLists` emits is THREE hops from the wire, and
 * two of those hops re-drop it onto a fresh object literal that names each key
 * it carries forward:
 *
 *   1. `RecordDetailView` maps the descriptor into `buildDefaultPageSchema`'s
 *      `related` shape (a fresh literal — a key it does not name is gone);
 *   2. `buildDefaultTabs`' `relatedNode` maps THAT into the `record:related_list`
 *      component node (a second fresh literal, same property);
 *   3. `RecordRelatedListRenderer` hands `schema.sort` to `RelatedList` as
 *      `defaultSort`, which `normalizeSortSpec` lowers into `$orderby`.
 *
 * An assertion on the descriptor is green while any of those three drops the
 * key, which is exactly the shape the defect had — so the subject here is the
 * argument `dataSource.find` is actually called with, and the harness is the
 * real page over a fake backend.
 *
 * ## What each leg decides
 *
 *  - SUBJECT: the declared order reaches `$orderby`.
 *  - DIALECT: a child declaring the LEGACY string form (`'seq_no desc'`, the
 *    space-separated `ListView` arm) still reaches the wire as a real field
 *    name. Un-normalized, this leg is the one that goes red — `$orderby` would
 *    name a field literally called `seq_no desc`. `record:related_list.sort`
 *    declares a string arm too, but it means `'field'`/`'-field'`, so the two
 *    string arms are NOT interchangeable and the inherit must translate.
 *  - COUNTER-PROBE: a child with NO list-view sort must still produce a
 *    WORKING related list that sends NO `$orderby`. Without it, "inheritance"
 *    would be satisfiable by inventing an order for everyone.
 *
 * ## The hole this inheritance inherits (attached deliberately, not fixed)
 *
 * `$orderby` is assembled inside `RelatedList`'s `windowed` branch only, and
 * `windowed` goes false while the client text filter is active — so a declared
 * `record:related_list.sort` is DROPPED whenever the list leaves windowed
 * mode, and the client path returns rows unsorted unless a column was clicked.
 * That is pre-existing on the authored prop and the inherited sort inherits it
 * identically. It is pinned as a recorded fact next door, in
 * `plugin-detail/src/__tests__/RelatedList.sortDroppedOutsideWindowed.test.tsx`
 * — `RelatedList.tsx` is out of scope for this card, so the pin records the
 * behaviour rather than changing it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { resetRetiredSortSpellingReports } from '@object-ui/core';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — stubbed so the only asynchrony in this file is the
// related list's own fetch.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const PARENT = 'task_version';
const CHILD = 'check_item';
const RECORD_ID = 'tv-1';

/** The parent object — a plain record page with one owned child collection. */
const parentObject = {
  name: PARENT,
  label: 'Task Version',
  managedBy: 'platform',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
};

/**
 * The child object. `list` is the DEFAULT list view as `MetadataProvider`
 * merges it onto the object def (`merged.list = extra.primary`, where
 * `primary` is the expanded view item flagged `isDefault`) — i.e. this is the
 * post-merge shape the page really receives, which is what makes the read at
 * derivation time non-empty.
 */
const childObject = (list?: unknown) => ({
  name: CHILD,
  label: 'Check Item',
  managedBy: 'platform',
  ...(list === undefined ? {} : { list }),
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    seq_no: { type: 'number', label: 'Seq No' },
    [PARENT]: { type: 'master_detail', reference: PARENT, label: 'Task Version' },
  },
});

/** Rows deliberately seeded OUT of `seq_no` order, as the issue's repro is. */
const CHILD_ROWS = [
  { id: 'ci-b', name: 'Item B', seq_no: 20, [PARENT]: RECORD_ID },
  { id: 'ci-c', name: 'Item C', seq_no: 30, [PARENT]: RECORD_ID },
  { id: 'ci-a', name: 'Item A', seq_no: 10, [PARENT]: RECORD_ID },
  { id: 'ci-d', name: 'Item D', seq_no: 40, [PARENT]: RECORD_ID },
];

function makeDataSource() {
  return {
    find: vi.fn(async (objectName: string) => ({
      data: objectName === CHILD ? CHILD_ROWS : [],
      total: objectName === CHILD ? CHILD_ROWS.length : 0,
    })),
    create: vi.fn(async (_o: string, row: any) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({
      id: recordId,
      name: `Version ${recordId}`,
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function renderPage(objects: any[], dataSource: any) {
  const metadata = {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}?tab=related`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={dataSource}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={PARENT}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/**
 * Render the page with the Related tab already open and return the params the
 * related list's own fetch went out with.
 *
 * The tab is selected through the URL (`?tab=related` — tabs are
 * URL-addressable by a stable semantic value, ADR-0054 C3) rather than by
 * clicking, so the list is mounted by the page's own routing rather than by a
 * synthetic event this test would then also be asserting about.
 *
 * The child object is queried TWICE on this page and only one of the two is
 * the subject: the tab strip auto-derives its count badge with a
 * `$top: 1, $count: true` probe that carries no ordering by design. Picking
 * the windowed page fetch explicitly keeps a counter-probe from passing
 * because it read the count probe instead.
 */
const isListFetch = (params: any) => !params?.$count && typeof params?.$top === 'number';

async function childQueryParams(list?: unknown) {
  const ds = makeDataSource();
  renderPage([parentObject, childObject(list)], ds);
  // Fails loudly if the list never fetched, rather than returning "no
  // `$orderby`" — which is what every counter-probe here would read as a pass.
  await waitFor(() => {
    expect(
      ds.find.mock.calls.some((c: any[]) => c[0] === CHILD && isListFetch(c[1])),
    ).toBe(true);
  });
  const call = ds.find.mock.calls.find((c: any[]) => c[0] === CHILD && isListFetch(c[1]))!;
  return call[1] as Record<string, any>;
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('derived related list — inherited $orderby on the wire (objectui#5795)', () => {
  it('SUBJECT — the child list view sort reaches $orderby', async () => {
    const params = await childQueryParams({ sort: [{ field: 'seq_no', order: 'asc' }] });
    // The parent scope is the live control: it proves the query under
    // inspection is the related list's own, not some other read.
    expect(params.$filter).toEqual({ [PARENT]: RECORD_ID });
    expect(params.$orderby).toEqual([{ field: 'seq_no', order: 'asc' }]);
  });

  it('SUBJECT — a descending declared order arrives descending', async () => {
    const params = await childQueryParams({ sort: [{ field: 'seq_no', order: 'desc' }] });
    expect(params.$orderby).toEqual([{ field: 'seq_no', order: 'desc' }]);
  });

  it('RETIRED DIALECT — a legacy string arm sends NO $orderby, and never a field named for the clause (objectui#8221)', async () => {
    resetRetiredSortSpellingReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const params = await childQueryParams({ sort: 'seq_no desc' });

      // Refused end to end: the retirement reaches the wire, not just the
      // helper's unit test.
      expect('$orderby' in params).toBe(false);
      // The failure this leg has always existed for, stated so a regression
      // reads plainly: an un-normalized inherit orders by a FIELD NAMED
      // `seq_no desc`. Refusal prevents it just as translation did; forwarding
      // the string verbatim would not.
      expect(JSON.stringify(params)).not.toContain('seq_no desc');
      // LIVE CONTROL — the query really ran and really is the related list's
      // own, so the absent `$orderby` means "refused", not "nothing fetched".
      expect(params.$filter).toEqual({ [PARENT]: RECORD_ID });
      expect(params.$top).toBeGreaterThan(0);

      // And the operator is told why their order vanished.
      expect(errorSpy).toHaveBeenCalled();
      expect(String(errorSpy.mock.calls[0][0])).toContain("[{ field: 'name', order: 'desc' }]");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('COUNTER-PROBE — no declared sort sends NO $orderby, and the list still works', async () => {
    const params = await childQueryParams(undefined);
    expect('$orderby' in params).toBe(false);
    // Live control: the list is a real, scoped, windowed query — so the
    // missing `$orderby` above means "nothing was inherited", not "nothing
    // was fetched".
    expect(params.$filter).toEqual({ [PARENT]: RECORD_ID });
    expect(params.$top).toBeGreaterThan(0);
  });

  it('COUNTER-PROBE — a list view with an empty sort is the same as none', async () => {
    expect('$orderby' in (await childQueryParams({ sort: [] }))).toBe(false);
  });
});
