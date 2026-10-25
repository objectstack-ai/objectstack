/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8882 — the related-list tab BADGE compiles the parent-relationship
 * condition to match the relationship field's ARITY, exactly as the ROWS do.
 *
 * `RelatedList` has compiled that condition by arity since objectui#7299: a
 * `multiple: true` relationship stores an ARRAY of parent ids, so the question
 * is MEMBERSHIP (`$contains`) and not equality (equality asks whether the whole
 * stored array IS one id). The badge probe went on sending bare equality, so on
 * a multi-value related list the two sides asked two different questions of the
 * same driver — the rows rendered and the badge did not, because the store's
 * `catch` swallows the driver's refusal without a `setCount` and the tab then
 * has no count to draw at all.
 *
 * ## Why this file renders the whole page
 *
 * Same reason as its neighbour `RecordDetailView.relatedListFilter-4664`: the
 * subject is what `dataSource.find` is CALLED WITH on BOTH reads, plus what
 * ends up on screen. Badge/row parity is a property OF THE PAGE; asserting it
 * anywhere narrower is asserting that two implementations agree today.
 *
 * ## Why the fake backend REFUSES equality instead of answering it
 *
 * The defect is invisible to a permissive backend. A fake that answers bare
 * equality against an array-valued column with "no rows" — or worse, with the
 * rows — turns a driver-level refusal into a plausible number, and every
 * assertion here would then be satisfied by the broken filter. The real driver
 * does not do that: `driver-sql` answers the equality form on a multi-value
 * column with `400 INVALID_FILTER`, which is the behaviour `RelatedList` cites
 * as its reason for compiling by arity. So the evaluator below THROWS on that
 * exact combination, and `FIXTURE` asserts that it does — in both directions.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';

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
// related list's own fetch and the tab strip's count probe.
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
const OTHER_ID = 'tv-2';

/** The multi-value relationship field — an ARRAY of parent ids per child row. */
const MULTI_REF = 'task_versions';
/** The single-value control's field — one parent id per child row. */
const SINGLE_REF = 'task_version';

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
 * The child object, in the two arities this card is about. Only the ONE field
 * def differs between them — `multiple: true` — so every difference the page
 * shows is attributable to the arity and to nothing else.
 */
const multiChild = {
  name: CHILD,
  label: 'Check Item',
  managedBy: 'platform',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    [MULTI_REF]: {
      type: 'lookup',
      reference: PARENT,
      multiple: true,
      label: 'Task Versions',
      relatedListColumns: ['name'],
    },
  },
};

const singleChild = {
  name: CHILD,
  label: 'Check Item',
  managedBy: 'platform',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    [SINGLE_REF]: {
      type: 'lookup',
      reference: PARENT,
      label: 'Task Version',
      relatedListColumns: ['name'],
    },
  },
};

/** Rows for the multi-value world — the relationship column stores an array. */
const MULTI_ROWS = [
  { id: 'ci-a', name: 'Multi Item A', [MULTI_REF]: [RECORD_ID] },
  { id: 'ci-b', name: 'Multi Item B', [MULTI_REF]: [OTHER_ID, RECORD_ID] },
  { id: 'ci-c', name: 'Other Parent Only', [MULTI_REF]: [OTHER_ID] },
];

/** Rows for the single-value control — the relationship column stores an id. */
const SINGLE_ROWS = [
  { id: 'ci-a', name: 'Single Item A', [SINGLE_REF]: RECORD_ID },
  { id: 'ci-b', name: 'Single Item B', [SINGLE_REF]: RECORD_ID },
  { id: 'ci-c', name: 'Other Parent Only', [SINGLE_REF]: OTHER_ID },
];

// --- the filter evaluator ---------------------------------------------------

/** What `driver-sql` answers the equality form with on a multi-value column. */
class InvalidFilterError extends Error {
  code = 'INVALID_FILTER';
  status = 400;
}

/**
 * Compare one field against one scalar, the way a real driver does.
 *
 * An array-valued column under a bare scalar equality is REFUSED, not answered:
 * that is the whole mechanism of this card. Returning `false` here would make
 * the defect look like an empty related list; returning the members would make
 * it look like it works. Neither is what the driver does.
 */
function scalarEquals(stored: unknown, value: unknown, field: string): boolean {
  if (Array.isArray(stored)) {
    throw new InvalidFilterError(
      `[fixture] 400 INVALID_FILTER: '${field}' stores multiple values; ` +
        `equality cannot be evaluated against an array (use $contains)`,
    );
  }
  return stored === value;
}

/** Membership against a multi-value column; a scalar column holds one member. */
function containsValue(stored: unknown, value: unknown): boolean {
  return Array.isArray(stored) ? stored.includes(value) : stored === value;
}

/**
 * Evaluate one filter node against a row. Handles exactly the two shapes this
 * repo's single filter sink puts on the wire — the MongoDB-style object and the
 * ObjectQL AST array — and THROWS on anything else, for the reason its
 * neighbour file gives: a permissive evaluator answers "all rows" for a shape
 * it does not understand, and every assertion here would be satisfied by it.
 */
function matchesFilter(row: Record<string, any>, node: unknown): boolean {
  if (node === undefined || node === null) {
    throw new Error('[fixture] a child query reached the backend with no $filter at all');
  }
  if (Array.isArray(node)) {
    const [head, ...rest] = node as any[];
    if (head === 'and') return rest.every((n) => matchesFilter(row, n));
    if (head === 'or') return rest.some((n) => matchesFilter(row, n));
    if (node.length !== 3) {
      throw new Error(`[fixture] unsupported AST node: ${JSON.stringify(node)}`);
    }
    const [field, op, value] = node as [string, string, any];
    switch (op) {
      case '=':
        return scalarEquals(row[field], value, field);
      case '!=':
        return !scalarEquals(row[field], value, field);
      case 'contains':
        return containsValue(row[field], value);
      default:
        throw new Error(`[fixture] unsupported AST operator '${op}' in ${JSON.stringify(node)}`);
    }
  }
  if (typeof node === 'object') {
    return Object.entries(node as Record<string, any>).every(([field, cond]) => {
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        return Object.entries(cond as Record<string, any>).every(([op, value]) => {
          if (op === '$eq') return scalarEquals(row[field], value, field);
          if (op === '$ne') return !scalarEquals(row[field], value, field);
          if (op === '$contains') return containsValue(row[field], value);
          throw new Error(`[fixture] unsupported operator '${op}' on '${field}'`);
        });
      }
      return scalarEquals(row[field], cond, field);
    });
  }
  throw new Error(`[fixture] unsupported filter: ${JSON.stringify(node)}`);
}

function makeDataSource(rows: Record<string, any>[], objects: any[]) {
  return {
    find: vi.fn(async (objectName: string, params: any) => {
      if (objectName !== CHILD) return { data: [], total: 0 };
      // Not a rejected promise built by hand: the evaluator throws from inside
      // this async function, which is the same refusal an adapter surfaces.
      const matched = rows.filter((r) => matchesFilter(r, params?.$filter));
      const skip = typeof params?.$skip === 'number' ? params.$skip : 0;
      const data =
        typeof params?.$top === 'number' ? matched.slice(skip, skip + params.$top) : matched;
      return { data, total: matched.length };
    }),
    getObjectSchema: vi.fn(async (objectName: string) =>
      objects.find((o) => o.name === objectName),
    ),
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
 * The child object is queried TWICE and the two reads are the two halves of
 * this card: the ROW query (windowed, `$top` = page size, no `$count`) and the
 * tab strip's BADGE probe (`$top: 1`, `$count: true`).
 */
const isRowQuery = (p: any) => !p?.$count && typeof p?.$top === 'number';
const isBadgeProbe = (p: any) => p?.$count === true;

async function renderAndCollect(child: any, rows: Record<string, any>[]) {
  const objects = [parentObject, child];
  const ds = makeDataSource(rows, objects);
  renderPage(objects, ds);
  const childCalls = () => ds.find.mock.calls.filter((c: any[]) => c[0] === CHILD);
  // Fail loudly if either read never happened, rather than returning "no
  // filter" — which every counter-probe here would read as a pass.
  await waitFor(() => {
    expect(childCalls().some((c: any[]) => isRowQuery(c[1]))).toBe(true);
    expect(childCalls().some((c: any[]) => isBadgeProbe(c[1]))).toBe(true);
  });
  const rowQueries = (): Record<string, any>[] =>
    childCalls().filter((c: any[]) => isRowQuery(c[1])).map((c: any[]) => c[1]);
  return {
    ds,
    rowQueries,
    // The SETTLED row query, the last one. Since objectui#10690 `RelatedList`
    // waits for the child definition to settle before its first row query, so
    // the arity is known when it is sent. Parity is a property of where the two
    // reads LAND, so this is the one the badge is compared against — and
    // `rowQueries()` keeps every attempt visible, so a regression back to an
    // early equality attempt is not hidden.
    rowQuery: rowQueries()[rowQueries().length - 1] as Record<string, any>,
    badgeProbe: childCalls().find((c: any[]) => isBadgeProbe(c[1]))![1] as Record<string, any>,
  };
}

/** The digits rendered inside the Related tab's count badge, or `null`. */
async function relatedTabBadge(): Promise<string | null> {
  const tab = await screen.findByRole('tab', { name: /Related/i });
  // The badge is the only span in the trigger carrying an accessible name
  // (the label span has none) — see `page:tabs` in components/layout.
  return tab.querySelector('span[aria-label]')?.textContent?.trim() ?? null;
}

/** How many child rows the related list actually drew. */
function renderedRowNames(rows: Record<string, any>[]): string[] {
  return rows.map((r) => r.name as string).filter((n) => screen.queryByText(n) !== null);
}

beforeEach(() => {
  cleanup();
  // The count store is module-scoped and shared by every consumer in the
  // process, so a warm entry from a previous case would badge this one.
  RelatedCountStore._reset();
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

describe('related-list tab badge — parent scope compiled by ARITY (objectui#8882)', () => {
  it('FIXTURE — the backend refuses equality on the array column and answers membership', () => {
    // Forward: equality against the stored ARRAY is a refusal, not an answer.
    expect(() => matchesFilter(MULTI_ROWS[0], { [MULTI_REF]: RECORD_ID })).toThrow(
      /INVALID_FILTER/,
    );
    // Reverse: membership answers it, and answers it SELECTIVELY — two of the
    // three rows carry this parent, so an evaluator that admitted everything
    // (the one bug that would make this whole file lie) reads 3 here.
    expect(MULTI_ROWS.filter((r) => matchesFilter(r, { [MULTI_REF]: { $contains: RECORD_ID } }))
      .map((r) => r.id)).toEqual(['ci-a', 'ci-b']);
    // And the single-value control's column is answered by plain equality, so
    // the control below is not passing for want of a working evaluator.
    expect(SINGLE_ROWS.filter((r) => matchesFilter(r, { [SINGLE_REF]: RECORD_ID }))
      .map((r) => r.id)).toEqual(['ci-a', 'ci-b']);
  });

  it('SUBJECT — the badge probe sends the SAME parent condition as the rows', async () => {
    const { rowQuery, badgeProbe, rowQueries } = await renderAndCollect(multiChild, MULTI_ROWS);
    // The row side settles on the membership question, because the field
    // declares `multiple: true` (objectui#7299).
    await waitFor(() => {
      expect(rowQueries()[rowQueries().length - 1].$filter).toEqual({
        [MULTI_REF]: { $contains: RECORD_ID },
      });
    });
    // Byte-equal, not merely equivalent: ONE composition of the parent
    // relationship, used by both reads. Two compilers that happen to agree are
    // what produced this card.
    expect(badgeProbe.$filter).toEqual(rowQueries()[rowQueries().length - 1].$filter);
    expect(badgeProbe.$filter).toEqual({ [MULTI_REF]: { $contains: RECORD_ID } });
    // Nothing above is read off the first attempt: `rowQuery` is the settled
    // one, and it is the same value.
    expect(rowQuery.$filter).toEqual(badgeProbe.$filter);
  });

  it('ONE READ EACH — the rows wait for the arity as the badge does, and each side reads once (objectui#10690)', async () => {
    // This case was the MEASURED DIFFERENCE: `RelatedList` did not gate its rows
    // on the child definition, so its first row query on a multi-value
    // relationship was the equality the driver refuses, and it refetched once
    // the arity was known, while the BADGE resolved the arity first and probed
    // once. objectui#10690 gates the rows on the SETTLED definition
    // (`useSettledSchema`, which settles with none when there is no
    // `getObjectSchema` or the read throws, so no list is left empty). Both
    // sides now wait for the arity and read once, already correct. The
    // badge's own reason to wait is unchanged: the store caches the first
    // answer it gets and never re-probes.
    const { rowQueries, ds } = await renderAndCollect(multiChild, MULTI_ROWS);
    await waitFor(() => {
      expect(renderedRowNames(MULTI_ROWS)).toEqual(['Multi Item A', 'Multi Item B']);
    });
    // The rows: one query, and it is the membership one.
    expect(rowQueries().map((q) => q.$filter)).toEqual([{ [MULTI_REF]: { $contains: RECORD_ID } }]);
    // The badge: one probe, the same condition.
    const badgeProbes = ds.find.mock.calls
      .filter((c: any[]) => c[0] === CHILD && isBadgeProbe(c[1]));
    expect(badgeProbes.map((c: any[]) => c[1].$filter)).toEqual([{ [MULTI_REF]: { $contains: RECORD_ID } }]);
  });

  it('SUBJECT — badge/row parity on a multi-value relationship, at a POSITIVE count', async () => {
    await renderAndCollect(multiChild, MULTI_ROWS);
    // The rows the list drew — read off the screen, not off the fixture.
    await waitFor(() => {
      expect(renderedRowNames(MULTI_ROWS)).toEqual(['Multi Item A', 'Multi Item B']);
    });
    const drawn = renderedRowNames(MULTI_ROWS).length;
    // TWO ZEROS ARE EQUAL — so parity is only evidence at a positive count.
    // Without this the assertion below is satisfied by a page that shows no
    // rows and badges none, which is a different bug wearing this one's face.
    expect(drawn).toBeGreaterThan(0);
    await waitFor(async () => {
      expect(await relatedTabBadge()).toBe(String(drawn));
    });
    expect(await relatedTabBadge()).not.toBe('0');
    expect(await relatedTabBadge()).not.toBeNull();
  });

  it('LIVE CONTROL — a single-value relationship is correct today and stays correct', async () => {
    const { rowQuery, badgeProbe } = await renderAndCollect(singleChild, SINGLE_ROWS);
    // Byte for byte the plain MongoDB-style equality object both reads have
    // always sent — not a freshly lowered AST that means the same thing.
    expect(rowQuery.$filter).toEqual({ [SINGLE_REF]: RECORD_ID });
    expect(badgeProbe.$filter).toEqual({ [SINGLE_REF]: RECORD_ID });
    await waitFor(() => {
      expect(renderedRowNames(SINGLE_ROWS)).toEqual(['Single Item A', 'Single Item B']);
    });
    const drawn = renderedRowNames(SINGLE_ROWS).length;
    expect(drawn).toBeGreaterThan(0);
    await waitFor(async () => {
      expect(await relatedTabBadge()).toBe(String(drawn));
    });
    // The other parent's row is excluded on both sides, arity or no arity.
    expect(screen.queryByText('Other Parent Only')).toBeNull();
  });
});
