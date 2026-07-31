// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for **deterministic paged reads** — the single
 * standard every driver's `find()` is held to when `orderBy` and `limit`/
 * `offset` arrive together.
 *
 * # The property
 *
 * Reading a collection page by page under one `orderBy` must visit every
 * matching row **exactly once**. Nothing here is about *which* order the rows
 * come back in — that is the caller's `orderBy`. It is about the order being
 * the *same* order on page 2 as it was on page 1.
 *
 * # Why it is not free
 *
 * `ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify
 * a row. Neither SQL nor MongoDB promises anything about how rows with equal
 * keys are arranged relative to each other, and neither promises the *same*
 * arrangement across two separate queries — the plan is free to differ, and on
 * MongoDB the documented behavior is that `sort` + `skip`/`limit` on a
 * non-unique key may return one document twice and another not at all. Each
 * page is individually correct; the sequence of pages is not a partition of the
 * collection.
 *
 * What that costs the user is worth being precise about, because the failure is
 * invisible from any single response: every page is full, every row is real,
 * every row belongs. A record simply never appears, and a different one appears
 * twice — several screens apart, where nobody is comparing.
 *
 * The fix is one clause: append a column that *is* unique to the ORDER BY, so
 * ties can no longer reorder. Drivers do this themselves (they are the ones who
 * know their key column and whether the table has one), which is exactly why
 * the standard has to live somewhere they can all be checked against.
 *
 * # What belongs here
 *
 * Only the shape of the read: rows whose sort keys repeat heavily, and the
 * `orderBy` + page size to walk them with. Storage form, id generation and the
 * identity of the tie-breaking column are per-driver by design and asserted in
 * each driver's own suite.
 *
 * # Scope
 *
 * The guarantee is on `find()` (and whatever a driver builds on it, e.g. a
 * `findStream` that delegates). It says nothing about a query with NO `orderBy`
 * at all — paging an unordered read is non-deterministic on every backend by
 * definition, and forcing an order onto callers who asked for none is a much
 * larger change to plan selection than this one. That gap is tracked separately
 * (objectstack#4363); an unordered paged read is not covered by these cases and
 * a driver is not failing them by reshuffling one.
 *
 * @see IDataDriver.find in `contracts/data-driver.ts` for the normative wording
 */

/**
 * A row of the shared fixture. `status` and `rank` both repeat heavily — four
 * rows per `status`, three per `rank` — so the tie population is large enough
 * that an unstable arrangement cannot hide inside a single page.
 *
 * `id` is deliberately NOT in insertion order: a backend that returns ties in
 * physical/insertion order is then visibly not returning them in id order, so a
 * driver test that wants to assert the tie-breaker's *direction* has something
 * to distinguish it from "did nothing".
 */
export interface PaginationConformanceRow {
    id: string;
    status: string;
    rank: number;
    name: string;
}

/**
 * Twelve rows, seeded in the order listed. Sort keys repeat; `id` is unique and
 * shuffled relative to insertion order.
 */
export const PAGINATION_ROWS: readonly PaginationConformanceRow[] = [
    { id: 'r07', status: 'open', rank: 2, name: 'Alpha' },
    { id: 'r03', status: 'done', rank: 1, name: 'Bravo' },
    { id: 'r11', status: 'open', rank: 3, name: 'Charlie' },
    { id: 'r01', status: 'hold', rank: 2, name: 'Delta' },
    { id: 'r09', status: 'done', rank: 3, name: 'Echo' },
    { id: 'r05', status: 'open', rank: 1, name: 'Foxtrot' },
    { id: 'r12', status: 'hold', rank: 1, name: 'Golf' },
    { id: 'r02', status: 'done', rank: 2, name: 'Hotel' },
    { id: 'r08', status: 'hold', rank: 3, name: 'India' },
    { id: 'r04', status: 'open', rank: 2, name: 'Juliett' },
    { id: 'r10', status: 'done', rank: 1, name: 'Kilo' },
    { id: 'r06', status: 'hold', rank: 3, name: 'Lima' },
];

/** One paged read to walk end to end. */
export interface PaginationConformanceCase {
    /** Case label, used as the test name. */
    name: string;
    /** The `orderBy` the caller asked for — never unique on its own. */
    orderBy: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }>;
    /** Page size; every case's total (12) is deliberately not a multiple of it. */
    pageSize: number;
}

/**
 * The cases. Every one sorts by a key that repeats, so every one is a paged
 * read whose page boundaries fall *inside* a group of equal keys — which is the
 * only place the defect can appear.
 *
 * The multi-key case matters on its own: two sort keys narrow the ties but do
 * not eliminate them (`status` × `rank` still leaves pairs), and a driver that
 * appends a tie-breaker only for single-key sorts passes everything else here.
 */
export const PAGINATION_CASES: readonly PaginationConformanceCase[] = [
    { name: 'single ascending key with 4-row ties', orderBy: [{ field: 'status', order: 'asc' }], pageSize: 5 },
    { name: 'single descending key with 4-row ties', orderBy: [{ field: 'status', order: 'desc' }], pageSize: 5 },
    { name: 'numeric key with 4-row ties', orderBy: [{ field: 'rank', order: 'asc' }], pageSize: 4 },
    { name: 'page size 1 walks every boundary', orderBy: [{ field: 'status', order: 'asc' }], pageSize: 1 },
    {
        name: 'multi-key sort with residual ties',
        orderBy: [{ field: 'status', order: 'asc' }, { field: 'rank', order: 'desc' }],
        pageSize: 5,
    },
];

/** Every id in {@link PAGINATION_ROWS}, for the "visited exactly once" check. */
export const PAGINATION_ALL_IDS: readonly string[] = PAGINATION_ROWS.map((r) => r.id);
