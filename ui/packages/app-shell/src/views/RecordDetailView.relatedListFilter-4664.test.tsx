/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4664 — a derived related list CONSUMES the FK's `relatedListFilter`.
 *
 * The spec key landed upstream as objectstack#8704 / PR #8955 and ships from
 * `@objectstack/spec` 17.1.0 (this repo's pin resolves 17.2.0). Its published
 * contract text, verbatim from the key's own `describe()`:
 *
 *   "Declarative default filter for the detail-page related list: AND-composed
 *    with the parent-relationship condition { [referenceField]: parentId } — an
 *    authored constraint, never a user-editable suggestion. The related-list tab
 *    badge count honors the same composed filter, so counts match the visible
 *    rows."
 *
 * Two halves, and the second is the one worth guarding: a badge saying 7 above
 * a list showing 3 is not a cosmetic defect, it is the surface telling the user
 * that rows are hidden from them.
 *
 * ## Why this file renders the whole page instead of asserting the descriptor
 *
 * Same reason as its neighbour `RecordDetailView.relatedListInheritedSort-5795`:
 * the descriptor `deriveRelatedLists` emits is several hops from the wire, and
 * every hop re-drops it onto a fresh object literal that names each key it
 * carries forward — so an assertion on the descriptor stays green while any hop
 * silently drops the key. The subject here is what `dataSource.find` is CALLED
 * WITH, on both the row query and the badge probe, plus what ends up on screen.
 *
 * ## Why the fake backend EVALUATES the filter instead of being asserted against
 *
 * A test that only compares `$filter` to an expected literal cannot tell
 * AND-composition from REPLACEMENT unless a human keeps the literal honest — and
 * replacement is the dangerous failure here, because it silently widens a
 * related list to OTHER parents' rows, which reads on screen as a plausible
 * list. So the fake `find` runs the composed predicate over a four-row fixture
 * built so that each conjunct alone admits a row the other excludes:
 *
 *   | row                  | parent | status   | parent scope | declared filter | AND |
 *   |----------------------|--------|----------|--------------|-----------------|-----|
 *   | Live Item            | tv-1   | open     | ✅           | ✅              | ✅  |
 *   | Archived Item        | tv-1   | archived | ✅           | ❌              | ❌  |
 *   | Other Parent Item    | tv-2   | open     | ❌           | ✅              | ❌  |
 *   | Other Parent Archived| tv-2   | archived | ❌           | ❌              | ❌  |
 *
 * Parent scope alone answers 2 rows, the declared filter alone answers 2 rows,
 * the conjunction answers 1 — so dropping EITHER conjunct changes the number
 * this file reads, in both directions. Those three numbers are asserted from
 * the fixture itself (`FIXTURE_ARITHMETIC`) rather than written in prose, so a
 * later edit that flattens the fixture into a single-condition one fails here
 * instead of quietly weakening every assertion below it.
 *
 * The evaluator THROWS on any filter shape it does not recognise. A permissive
 * evaluator is the one bug that would make this whole file lie: it would answer
 * "all rows" for a malformed filter, which is exactly the observation the
 * counter-probes below read as a pass.
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

/** The FK's declared scope — the soft-delete shape the card's provenance names. */
const DECLARED_FILTER = { status: { $ne: 'archived' } } as const;
/** The parent-relationship condition the declared filter may only NARROW. */
const PARENT_SCOPE = { [PARENT]: RECORD_ID } as const;

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
 * The child object. `relatedListFilter` is optional here so every assertion has
 * a matching counter-probe with the SAME fixture and no declared filter.
 */
const childObject = (relatedListFilter?: unknown) => ({
  name: CHILD,
  label: 'Check Item',
  managedBy: 'platform',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
    [PARENT]: {
      type: 'master_detail',
      reference: PARENT,
      label: 'Task Version',
      // Declared so the table renders real cells without a `getObjectSchema`
      // on the fake adapter — the rendered-row half of the parity assertion
      // needs the row VALUES on screen, not just a fetch that happened.
      relatedListColumns: ['name', 'status'],
      ...(relatedListFilter === undefined ? {} : { relatedListFilter }),
    },
  },
});

const CHILD_ROWS = [
  { id: 'ci-live', name: 'Live Item', status: 'open', [PARENT]: RECORD_ID },
  { id: 'ci-archived', name: 'Archived Item', status: 'archived', [PARENT]: RECORD_ID },
  { id: 'ci-other', name: 'Other Parent Item', status: 'open', [PARENT]: OTHER_ID },
  { id: 'ci-other-archived', name: 'Other Parent Archived', status: 'archived', [PARENT]: OTHER_ID },
];

// ─── the filter evaluator ────────────────────────────────────────────────────

/**
 * Evaluate one filter node against a row. Handles exactly the two shapes this
 * repo's single filter sink puts on the wire — the MongoDB-style object (what
 * an unfiltered parent scope stays) and the ObjectQL AST array `toFilterNode` /
 * `mergeFilterNodes` lower a composed pair to — and THROWS on anything else.
 *
 * Throwing is load-bearing. A permissive evaluator returns "all rows" for a
 * shape it does not understand, and every assertion in this file would then be
 * satisfied by a broken filter that fetched everything.
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
        return row[field] === value;
      case '!=':
        return row[field] !== value;
      case 'in':
        return Array.isArray(value) && value.includes(row[field]);
      default:
        throw new Error(`[fixture] unsupported AST operator '${op}' in ${JSON.stringify(node)}`);
    }
  }
  if (typeof node === 'object') {
    return Object.entries(node as Record<string, any>).every(([field, cond]) => {
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        return Object.entries(cond as Record<string, any>).every(([op, value]) => {
          if (op === '$eq') return row[field] === value;
          if (op === '$ne') return row[field] !== value;
          if (op === '$in') return Array.isArray(value) && value.includes(row[field]);
          throw new Error(`[fixture] unsupported operator '${op}' on '${field}'`);
        });
      }
      return row[field] === cond;
    });
  }
  throw new Error(`[fixture] unsupported filter: ${JSON.stringify(node)}`);
}

const countMatching = (node: unknown) => CHILD_ROWS.filter((r) => matchesFilter(r, node)).length;

/**
 * The fixture's whole point, asserted rather than described: each conjunct
 * ALONE admits a row the other excludes, so the conjunction is strictly
 * narrower than either. Without this, a later fixture edit could make every
 * assertion below pass under replacement as well as under AND.
 */
const FIXTURE_ARITHMETIC = {
  total: CHILD_ROWS.length,
  parentScopeAlone: countMatching(PARENT_SCOPE),
  declaredFilterAlone: countMatching(DECLARED_FILTER),
  composed: CHILD_ROWS.filter(
    (r) => matchesFilter(r, PARENT_SCOPE) && matchesFilter(r, DECLARED_FILTER),
  ).length,
};

function makeDataSource() {
  return {
    find: vi.fn(async (objectName: string, params: any) => {
      if (objectName !== CHILD) return { data: [], total: 0 };
      const matched = CHILD_ROWS.filter((r) => matchesFilter(r, params?.$filter));
      const skip = typeof params?.$skip === 'number' ? params.$skip : 0;
      const data =
        typeof params?.$top === 'number' ? matched.slice(skip, skip + params.$top) : matched;
      return { data, total: matched.length };
    }),
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
 * The child object is queried TWICE on this page and the two reads are the two
 * halves of this card: the ROW query (windowed, `$top` = page size, no
 * `$count`) and the tab strip's BADGE probe (`$top: 1`, `$count: true`).
 * Telling them apart explicitly is what keeps a half from passing because it
 * read the other one's query.
 */
const isRowQuery = (p: any) => !p?.$count && typeof p?.$top === 'number';
const isBadgeProbe = (p: any) => p?.$count === true;

async function renderAndCollect(relatedListFilter?: unknown) {
  const ds = makeDataSource();
  renderPage([parentObject, childObject(relatedListFilter)], ds);
  const childCalls = () => ds.find.mock.calls.filter((c: any[]) => c[0] === CHILD);
  // Fail loudly if either read never happened, rather than returning
  // "no filter" — which every counter-probe here would read as a pass.
  await waitFor(() => {
    expect(childCalls().some((c: any[]) => isRowQuery(c[1]))).toBe(true);
    expect(childCalls().some((c: any[]) => isBadgeProbe(c[1]))).toBe(true);
  });
  return {
    ds,
    rowQuery: childCalls().find((c: any[]) => isRowQuery(c[1]))![1] as Record<string, any>,
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

describe('derived related list — declared relatedListFilter on the wire (objectui#4664)', () => {
  it('FIXTURE — each conjunct alone admits a row the other excludes', () => {
    // 4 rows; parent scope alone → 2; declared filter alone → 2; AND → 1.
    expect(FIXTURE_ARITHMETIC).toEqual({
      total: 4,
      parentScopeAlone: 2,
      declaredFilterAlone: 2,
      composed: 1,
    });
    // Stated as the property rather than the numbers: the conjunction is
    // STRICTLY narrower than either conjunct, in both directions.
    expect(FIXTURE_ARITHMETIC.composed).toBeLessThan(FIXTURE_ARITHMETIC.parentScopeAlone);
    expect(FIXTURE_ARITHMETIC.composed).toBeLessThan(FIXTURE_ARITHMETIC.declaredFilterAlone);
  });

  it('SUBJECT — the row query is the declared filter AND the parent scope', async () => {
    const { rowQuery } = await renderAndCollect(DECLARED_FILTER);
    // Read as an ANSWER, not as a literal: run the composed predicate the page
    // actually sent over the fixture. Replacement in either direction lands on
    // 2 rows, so this single number separates AND from both failures.
    const answered = CHILD_ROWS.filter((r) => matchesFilter(r, rowQuery.$filter));
    expect(answered.map((r) => r.id)).toEqual(['ci-live']);
    // The parent conjunct SURVIVED: the other parent's matching row — the one
    // the declared filter alone would admit — is not in the answer. This is the
    // dangerous failure, so it gets its own assertion.
    expect(answered.map((r) => r.id)).not.toContain('ci-other');
    // The declared conjunct was APPLIED: this parent's archived row is gone.
    expect(answered.map((r) => r.id)).not.toContain('ci-archived');
  });

  it('SUBJECT — the badge probe sends the SAME composed filter as the rows', async () => {
    const { rowQuery, badgeProbe } = await renderAndCollect(DECLARED_FILTER);
    // Byte-equal, not merely equivalent: one composition, used twice. Two
    // filters that happen to agree on this fixture would be a coincidence to
    // maintain; one shared value is a property.
    expect(badgeProbe.$filter).toEqual(rowQuery.$filter);
    expect(CHILD_ROWS.filter((r) => matchesFilter(r, badgeProbe.$filter)).map((r) => r.id)).toEqual([
      'ci-live',
    ]);
  });

  it('PARITY — the badge and the rendered rows agree, and 1 !== the unfiltered 2', async () => {
    await renderAndCollect(DECLARED_FILTER);
    // The list shows exactly the AND-matching row.
    expect(await screen.findByText('Live Item')).toBeTruthy();
    expect(screen.queryByText('Archived Item')).toBeNull();
    expect(screen.queryByText('Other Parent Item')).toBeNull();
    // …and the badge counts the same set. The unfiltered parent-scoped count is
    // 2, so a badge that ignored the filter would read '2' here — which is the
    // exact "badge says 7 above a list showing 3" defect, at fixture scale.
    await waitFor(async () => {
      expect(await relatedTabBadge()).toBe('1');
    });
    expect(String(FIXTURE_ARITHMETIC.parentScopeAlone)).not.toBe('1');
  });

  it('COUNTER-PROBE — no declared filter leaves both queries byte-identical', async () => {
    const { rowQuery, badgeProbe } = await renderAndCollect(undefined);
    // Not "equivalent to" the parent scope — the very same MongoDB-style object
    // both queries have always sent. A freshly lowered AST would mean the same
    // thing and be invisible on screen, and would still break every caller
    // pinning this wire.
    expect(rowQuery.$filter).toEqual({ [PARENT]: RECORD_ID });
    expect(badgeProbe.$filter).toEqual({ [PARENT]: RECORD_ID });
    // Live control: the unfiltered page really does show the archived row and
    // badge 2. Without this the case above could pass by fetching nothing.
    expect(await screen.findByText('Archived Item')).toBeTruthy();
    await waitFor(async () => {
      expect(await relatedTabBadge()).toBe('2');
    });
    // …and the other parent's row is still excluded, filter or no filter.
    expect(screen.queryByText('Other Parent Item')).toBeNull();
  });

  it('COUNTER-PROBE — a non-object relatedListFilter is not forwarded', async () => {
    // The renderer refuses to guess at an off-spec value (`FilterConditionSchema`
    // is an object) rather than coercing it into something that "works". The
    // page stays exactly as it is with nothing declared.
    const { rowQuery, badgeProbe } = await renderAndCollect([{ field: 'status' }]);
    expect(rowQuery.$filter).toEqual({ [PARENT]: RECORD_ID });
    expect(badgeProbe.$filter).toEqual({ [PARENT]: RECORD_ID });
  });
});
