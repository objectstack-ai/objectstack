/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8883 — `record:reference_rail` compiles its parent scope by the
 * relationship field's ARITY, and refuses to render a "View All" link it
 * cannot express.
 *
 * The rail took an author-supplied `relationshipField` and compiled it as bare
 * equality TWICE, in two different grammars: the `$filter` it puts on the wire
 * and the `filter[<field>]=<value>` URL its "View All" link points at. On a
 * `multiple: true` relationship the stored value is an ARRAY of parent ids, so
 * equality asks whether that whole array IS one id — which `driver-sql`
 * refuses with `400 INVALID_FILTER` while prescribing `$contains`.
 *
 * ## Two halves, two different answers
 *
 * The `$filter` half is repairable and is repaired: it goes through
 * `composeParentScopeFilter` from `@object-ui/core`, the ONE compiler the
 * related list's rows (objectui#7299) and its tab badge (objectui#8882)
 * already share, whose verdict is `@objectstack/spec/data`'s own
 * `isMultiValueField`.
 *
 * ⚠️ That verdict is the SPEC's, and it is NOT the driver's — the two rules
 * are not one predicate, and this file does not assert that they agree. The
 * spec gates on the field TYPE (`MULTI_OPTION_TYPES.has(type) ||
 * (MULTI_CAPABLE_TYPES.has(type) && multiple === true)`), while `driver-sql`
 * decides storage on `!!field.multiple` whatever the type is, so a
 * `multiple: true` def on a type OUTSIDE the spec's multi-capable set is
 * single-valued to the renderer and a JSON column to the driver. Which of the
 * two is right is owned upstream by objectstack#17469; ⛔ nothing here decides
 * it. The cases below stay clear of that disagreement on purpose: they relate
 * through a `lookup` field, which both rules call multi-valued, so what they
 * measure is the rail's compilation and not the open question.
 *
 * The LINK half is not repairable at this layer and is not repaired: no URL
 * spelling on this surface carries membership, so the link is SUPPRESSED on a
 * multi-value relationship rather than pointed at an unscoped child table.
 * Landing the filter alone would have produced a rail that shows the right
 * rows above a link that goes somewhere else — a disagreement invisible until
 * the user clicks. Both halves are pinned below, and so is the LINK's
 * survival on the single-value arm that was already correct.
 *
 * ## Why the fake backend REFUSES equality instead of answering it
 *
 * The defect is invisible to a permissive backend: a fake that answers bare
 * equality against an array-valued column with "no rows" turns a driver-level
 * refusal into a plausible empty rail, and one that answers with the rows
 * makes the bug look like a working feature. Either way every assertion here
 * would be satisfied by the broken filter. The evaluator below therefore
 * throws on that exact combination — and on any filter shape it does not
 * recognise — and `FIXTURE` asserts that it does, in both directions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RecordContextProvider } from '@object-ui/react';

import { RecordReferenceRailRenderer } from '../record-reference-rail';

/** The rail gates its queries on an IntersectionObserver. Report intersecting
 *  immediately so the fetch effect runs deterministically under jsdom. */
class ImmediateIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

const APP = 'demo';
const PARENT = 'account';
const CHILD = 'contact';
const RECORD_ID = 'A1';
const OTHER_ID = 'A2';

/** The multi-value relationship field — an ARRAY of parent ids per child row. */
const MULTI_REF = 'accounts';
/** The single-value control's field — one parent id per child row. */
const SINGLE_REF = 'account_id';

/**
 * The child object in the two arities this card is about. Only the ONE field
 * member differs — `multiple: true` — so every difference the rail shows is
 * attributable to the arity and to nothing else.
 */
const multiChildSchema = {
  name: CHILD,
  label: 'Contact',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    [MULTI_REF]: { type: 'lookup', reference: PARENT, multiple: true, label: 'Accounts' },
  },
};

const singleChildSchema = {
  name: CHILD,
  label: 'Contact',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    [SINGLE_REF]: { type: 'lookup', reference: PARENT, label: 'Account' },
  },
};

const MULTI_ROWS = [
  { id: 'c1', name: 'Ada', [MULTI_REF]: [RECORD_ID] },
  { id: 'c2', name: 'Grace', [MULTI_REF]: [OTHER_ID, RECORD_ID] },
  { id: 'c3', name: 'Other Parent Only', [MULTI_REF]: [OTHER_ID] },
];

const SINGLE_ROWS = [
  { id: 'c1', name: 'Ada', [SINGLE_REF]: RECORD_ID },
  { id: 'c2', name: 'Grace', [SINGLE_REF]: RECORD_ID },
  { id: 'c3', name: 'Other Parent Only', [SINGLE_REF]: OTHER_ID },
];

// --- the filter evaluator ---------------------------------------------------

/** What `driver-sql` answers the equality form with on a multi-value column. */
class InvalidFilterError extends Error {
  code = 'INVALID_FILTER';
  status = 400;
}

/**
 * Compare one field against one scalar, the way a real driver does. An
 * array-valued column under a bare scalar equality is REFUSED, not answered.
 */
function scalarEquals(stored: unknown, value: unknown, field: string): boolean {
  if (Array.isArray(stored)) {
    throw new InvalidFilterError(
      `[fixture] 400 INVALID_FILTER: '${field}' stores multiple values; ` +
        'equality cannot be evaluated against an array (use $contains)',
    );
  }
  return stored === value;
}

/** Membership against a multi-value column; a scalar column holds one member. */
function containsValue(stored: unknown, value: unknown): boolean {
  return Array.isArray(stored) ? stored.includes(value) : stored === value;
}

/**
 * Evaluate one filter node against a row. Handles exactly the MongoDB-style
 * object this rail puts on the wire and THROWS on anything else — a permissive
 * evaluator answers "all rows" for a shape it does not understand, and every
 * assertion here would be satisfied by it.
 */
function matchesFilter(row: Record<string, any>, node: unknown): boolean {
  if (node === undefined || node === null) {
    throw new Error('[fixture] a rail query reached the backend with no $filter at all');
  }
  if (typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`[fixture] unsupported filter: ${JSON.stringify(node)}`);
  }
  return Object.entries(node as Record<string, any>).every(([field, cond]) => {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond as Record<string, any>).every(([op, value]) => {
        if (op === '$eq') return scalarEquals(row[field], value, field);
        if (op === '$contains') return containsValue(row[field], value);
        throw new Error(`[fixture] unsupported operator '${op}' on '${field}'`);
      });
    }
    return scalarEquals(row[field], cond, field);
  });
}

/**
 * A rail-shaped DataSource. `schema` of `null` models the adapter that cannot
 * serve metadata at all — the degradation control — by omitting
 * `getObjectSchema` entirely.
 */
function makeDataSource(rows: Record<string, any>[], schema: unknown | null) {
  const find = vi.fn(async (objectName: string, params: any) => {
    if (objectName !== CHILD) return { data: [], total: 0 };
    const matched = rows.filter((r) => matchesFilter(r, params?.$filter));
    const top = typeof params?.$top === 'number' ? params.$top : matched.length;
    return { data: matched.slice(0, top), total: matched.length };
  });
  const ds: Record<string, unknown> = { find };
  if (schema !== null) {
    ds.getObjectSchema = vi.fn(async (objectName: string) =>
      objectName === CHILD ? schema : undefined,
    );
  }
  return ds as any;
}

function renderRail(dataSource: any, relationshipField: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/${PARENT}/record/${RECORD_ID}`]}>
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={
            <RecordContextProvider
              objectName={PARENT}
              recordId={RECORD_ID}
              dataSource={dataSource}
            >
              <RecordReferenceRailRenderer
                schema={{
                  hideEmpty: false,
                  entries: [{ objectName: CHILD, relationshipField, title: 'Contacts' }],
                }}
              />
            </RecordContextProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** The child queries the rail actually issued, newest last. */
const childQueries = (ds: any): Record<string, any>[] =>
  ds.find.mock.calls.filter((c: any[]) => c[0] === CHILD).map((c: any[]) => c[1]);

/** Wait until the rail has settled: the entry's skeletons are gone. */
async function settled(ds: any): Promise<Record<string, any>[]> {
  await waitFor(() => {
    expect(childQueries(ds).length).toBeGreaterThan(0);
    expect(document.querySelector('.tabular-nums')).not.toBeNull();
  });
  return childQueries(ds);
}

/** The count badge's digits. */
const badgeText = (): string =>
  document.querySelector('.tabular-nums')?.textContent?.trim() ?? '';

/** Which fixture rows the rail actually drew. */
const drawnRowNames = (rows: Record<string, any>[]): string[] =>
  rows.map((r) => r.name as string).filter((n) => screen.queryByText(n) !== null);

const viewAllLink = (): HTMLAnchorElement | null =>
  screen.queryByRole('link', { name: /View All/i }) as HTMLAnchorElement | null;

let warnSpy: ReturnType<typeof vi.spyOn>;

/** The rail's own `console.warn` calls, by their first argument. */
const railWarnings = (): string[] =>
  (warnSpy.mock.calls as unknown[][])
    .map((c) => c[0])
    .filter((first): first is string =>
      typeof first === 'string' && first.includes('RecordReferenceRail'),
    );

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('reference rail parent scope — compiled by ARITY (objectui#8883)', () => {
  it('FIXTURE — the backend refuses equality on the array column and answers membership', () => {
    // Forward: equality against the stored ARRAY is a refusal, not an answer.
    expect(() => matchesFilter(MULTI_ROWS[0], { [MULTI_REF]: RECORD_ID })).toThrow(
      /INVALID_FILTER/,
    );
    // Reverse: membership answers it, and answers it SELECTIVELY — two of the
    // three rows carry this parent, so an evaluator that admitted everything
    // (the one bug that would make this whole file lie) reads 3 here.
    expect(
      MULTI_ROWS.filter((r) => matchesFilter(r, { [MULTI_REF]: { $contains: RECORD_ID } })).map(
        (r) => r.id,
      ),
    ).toEqual(['c1', 'c2']);
    // The single-value control's column is answered by plain equality, so the
    // LIVE CONTROL below is not passing for want of a working evaluator.
    expect(
      SINGLE_ROWS.filter((r) => matchesFilter(r, { [SINGLE_REF]: RECORD_ID })).map((r) => r.id),
    ).toEqual(['c1', 'c2']);
    // And an unrecognised shape is refused rather than answered "all rows".
    expect(() => matchesFilter(MULTI_ROWS[0], { [MULTI_REF]: { $in: [RECORD_ID] } })).toThrow(
      /unsupported operator/,
    );
  });

  it('SUBJECT — a multi-value relationship is queried by MEMBERSHIP, selectively', async () => {
    const ds = makeDataSource(MULTI_ROWS, multiChildSchema);
    renderRail(ds, MULTI_REF);
    const queries = await settled(ds);
    expect(queries[queries.length - 1].$filter).toEqual({
      [MULTI_REF]: { $contains: RECORD_ID },
    });
    await waitFor(() => {
      expect(drawnRowNames(MULTI_ROWS)).toEqual(['Ada', 'Grace']);
    });
    // TWO ZEROS ARE EQUAL — parity between the badge and the drawn rows is only
    // evidence at a positive count.
    const drawn = drawnRowNames(MULTI_ROWS).length;
    expect(drawn).toBeGreaterThan(0);
    expect(badgeText()).toBe(String(drawn));
    // The other parent's row is excluded — a rail that fetched the whole child
    // table would draw it and badge 3.
    expect(screen.queryByText('Other Parent Only')).toBeNull();
  });

  it('SUBJECT — the "View All" link is SUPPRESSED on a multi-value relationship, loudly', async () => {
    const ds = makeDataSource(MULTI_ROWS, multiChildSchema);
    renderRail(ds, MULTI_REF);
    await settled(ds);
    // The rows above it are correct; the link is the half no URL spelling on
    // this surface can express, so it is absent rather than unscoped.
    await waitFor(() => {
      expect(viewAllLink()).toBeNull();
    });
    // Absent on screen ⇒ the developer console is the only place it can be
    // said at all, and it IS said — once, naming the field and the reason.
    const suppressionWarnings = railWarnings();
    expect(suppressionWarnings.length).toBe(1);
    expect(suppressionWarnings[0]).toContain(MULTI_REF);
    expect(suppressionWarnings[0]).toContain('View All');
  });

  it('MEASURED DIFFERENCE — the rail resolves the arity BEFORE its one read', async () => {
    // Not symmetry for its own sake: the rail makes a DIFFERENT trade with this
    // seam than `RelatedList`'s rows do, and the difference is worth pinning
    // because a reader would otherwise call it a bug.
    //
    // The ROWS deliberately attempt equality, are refused, and refetch once the
    // arity lands — their fetch effect re-runs on the verdict. This rail cannot
    // copy that: its `fetchedSigRef` latch keys on (parentId + entries), the
    // arity is in neither, so a refused first attempt would be the ONLY
    // attempt and the entry would sit on its error state. It also renders a
    // navigational link decided by the same verdict, so deferring the verdict
    // would ship the right rows under the wrong link.
    const ds = makeDataSource(MULTI_ROWS, multiChildSchema);
    renderRail(ds, MULTI_REF);
    const queries = await settled(ds);
    // Exactly ONE read, and it was already the membership question — no
    // refused first attempt, and therefore nothing to recover from.
    expect(queries.length).toBe(1);
    expect(queries[0].$filter).toEqual({ [MULTI_REF]: { $contains: RECORD_ID } });
    // The metadata read that decided it happened first.
    expect(ds.getObjectSchema).toHaveBeenCalledWith(CHILD);
    expect(ds.getObjectSchema.mock.invocationCallOrder[0]).toBeLessThan(
      ds.find.mock.invocationCallOrder[0],
    );
  });

  it('LIVE CONTROL — a single-value entry is byte-identical on BOTH halves', async () => {
    const ds = makeDataSource(SINGLE_ROWS, singleChildSchema);
    renderRail(ds, SINGLE_REF);
    const queries = await settled(ds);
    // Half one: the plain MongoDB-style equality object this rail has always
    // sent, not a freshly lowered AST that means the same thing.
    expect(queries.length).toBe(1);
    expect(queries[0].$filter).toEqual({ [SINGLE_REF]: RECORD_ID });
    expect(queries[0].$count).toBe(true);
    // Half two: the rendered href, character for character what it was before
    // this card.
    const link = viewAllLink();
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      `/apps/${APP}/${CHILD}?filter%5B${SINGLE_REF}%5D=${RECORD_ID}`,
    );
    await waitFor(() => {
      expect(drawnRowNames(SINGLE_ROWS)).toEqual(['Ada', 'Grace']);
    });
    const drawn = drawnRowNames(SINGLE_ROWS).length;
    expect(drawn).toBeGreaterThan(0);
    expect(badgeText()).toBe(String(drawn));
    // Nothing was suppressed, so nothing was said.
    expect(railWarnings().length).toBe(0);
  });

  it('DEGRADATION CONTROL — an adapter with no `getObjectSchema` still reads rows, on the historical wire', async () => {
    // ⛔ The arity resolution is NOT a gate. An adapter that cannot serve
    // metadata would otherwise render every rail entry empty — trading this
    // card's loud 400 on one relationship shape for a silent blank rail on all
    // of them.
    const ds = makeDataSource(SINGLE_ROWS, null);
    expect(ds.getObjectSchema).toBeUndefined();
    renderRail(ds, SINGLE_REF);
    const queries = await settled(ds);
    expect(queries.length).toBe(1);
    expect(queries[0].$filter).toEqual({ [SINGLE_REF]: RECORD_ID });
    await waitFor(() => {
      expect(drawnRowNames(SINGLE_ROWS)).toEqual(['Ada', 'Grace']);
    });
    expect(drawnRowNames(SINGLE_ROWS).length).toBeGreaterThan(0);
    // And the link survives: an unknown arity keeps today's affordance rather
    // than losing it on a suspicion.
    expect(viewAllLink()).not.toBeNull();
  });
});
