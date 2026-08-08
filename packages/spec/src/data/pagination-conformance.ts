// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for **deterministic paged reads** — the single
 * standard every driver's `find()` is held to whenever `limit`/`offset` slice
 * the result set, with or without an `orderBy`.
 *
 * # The property
 *
 * Reading a collection page by page must visit every matching row **exactly
 * once**. Nothing here is about *which* order the rows come back in — where the
 * caller asked for one, that is their `orderBy`. It is about the order being
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
 * Dropping the `ORDER BY` does not escape that — it is the same defect at full
 * strength, because now *every* row ties with every other. SQL leaves the row
 * order of an unordered read to the plan (insertion order in practice on a
 * small table, and not once it goes parallel, switches to an index scan, or is
 * `VACUUM`ed), and MongoDB's natural order moves whenever a document does. This
 * matters more than the sorted case rather than less: a list view with no `sort`
 * configured, which nobody has clicked a column header on, is the single most
 * common paged read there is.
 *
 * What that costs the user is worth being precise about, because the failure is
 * invisible from any single response: every page is full, every row is real,
 * every row belongs. A record simply never appears, and a different one appears
 * twice — several screens apart, where nobody is comparing.
 *
 * The fix is one clause: order by a column that *is* unique — appended to the
 * caller's sort keys, or standing alone when they gave none. Drivers do this
 * themselves (they are the ones who know their key column and whether the table
 * has one), which is exactly why the standard has to live somewhere they can
 * all be checked against.
 *
 * # What belongs here
 *
 * Only the shape of the read: rows whose sort keys repeat heavily, and the
 * `orderBy` + page size to walk them with. Storage form, id generation and the
 * identity of the ordering column are per-driver by design and asserted in each
 * driver's own suite — as is *how* a driver keeps the promise. A backend whose
 * own read order is already steady between reads (`driver-memory`) satisfies
 * these cases without emitting a sort at all; the cases test the property, not
 * the clause.
 *
 * # Scope
 *
 * The guarantee is on `find()` (and whatever a driver builds on it), and only
 * where the read is **paged**. It says
 * nothing about an unpaged read with no `orderBy`: nothing is being sliced, so
 * no caller can be shown a partial view of the set, and imposing an order there
 * would change plan selection across the majority of reads to buy nothing.
 * Drivers are expected to leave that shape exactly as it was (objectstack#4363).
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

/**
 * One paged read with **no `orderBy` at all** to walk end to end.
 *
 * Deliberately a separate type from {@link PaginationConformanceCase} rather
 * than the same one with an empty `orderBy`: the shape under test is a query
 * that carries no sort *key* — `{ limit, offset }` and nothing else — and
 * `orderBy: []` is a different value a driver may well treat differently.
 * Keeping them apart means a suite cannot accidentally cover this case by
 * spreading an empty array into the sorted one.
 */
export interface UnorderedPaginationConformanceCase {
    /** Case label, used as the test name. */
    name: string;
    /** Page size to walk the twelve rows with. */
    pageSize: number;
}

/**
 * The unordered cases. Same twelve rows, same walk, no `orderBy` — the shape a
 * list view issues when its metadata configures no `sort` and the user has not
 * clicked a column header, which is the majority of list reads.
 *
 * Two of the page sizes do not divide 12, so the walk ends on a short page and
 * its last `offset` lands past the final full page — the boundary an
 * off-by-one reads wrong. The third is 1, which puts a boundary between every
 * adjacent pair of rows, so nowhere is left for an unstable arrangement to hide
 * inside a page.
 */
export const PAGINATION_UNORDERED_CASES: readonly UnorderedPaginationConformanceCase[] = [
    { name: 'page size 5 over 12 rows', pageSize: 5 },
    { name: 'page size 7 leaves a short last page', pageSize: 7 },
    { name: 'page size 1 walks every boundary', pageSize: 1 },
];

/** Every id in {@link PAGINATION_ROWS}, for the "visited exactly once" check. */
export const PAGINATION_ALL_IDS: readonly string[] = PAGINATION_ROWS.map((r) => r.id);

/**
 * One read whose `limit` must be honoured **as written** — including when it is
 * `0`.
 *
 * # The ruling
 *
 * `limit: 0` means **return no records** (objectstack#6485). It is not "no
 * limit", and it is not a value a layer may drop on its way down.
 *
 * # Why this is a separate case-set from {@link PAGINATION_CASES}
 *
 * Everything above is about a *page* being a partition. This is about the page
 * SIZE being read at all, and the two fail independently: a driver can walk
 * twelve rows in a perfect partition and still answer `{ limit: 0 }` with the
 * whole table, because the two live at different lines. Keeping them apart is
 * also what keeps the coverage ledger honest — a driver that answers one and
 * not the other is a half-covered cell, and a shared marker would let it import
 * its way to green.
 *
 * # The defect this exists to catch
 *
 * `if (query.limit) { ... }` — truthiness where the contract asks for presence.
 * `0` is falsy, so the clause is dropped and the read that asked for nothing is
 * answered with everything: the widest possible answer to the narrowest
 * possible request. It is invisible from any single backend, which is why it
 * needs a shared standard — two shipped drivers answered the same `QueryAST`
 * with opposite result sets, and the one that disagreed returned MORE data than
 * was asked for rather than less (objectstack#6577).
 *
 * # Why the controls are not padding
 *
 * A driver that returns `[]` for every query passes every `limit: 0` row here
 * and fails its users completely. So each zero case is stated beside the
 * non-zero read it must NOT become. The property is "`limit` is honoured as
 * written", not "`limit: 0` is special-cased".
 *
 * # Scope
 *
 * `find()` and whatever a driver builds on it. Nothing here says HOW a driver
 * keeps the promise, and the answers genuinely differ — which is the reason
 * this is a shared case-set rather than a lint rule. The SQL family needed a
 * presence check; `driver-memory` needed the same on its slice; and
 * `driver-mongodb` needed neither, because it already forwarded `0` faithfully
 * — into a client that DEFINES `limit: 0` as *no limit*. There the contract has
 * to be answered BEFORE the client is consulted, by a short-circuit that
 * returns the empty result without a round trip. Same standard, three
 * mechanisms; the cases test the property, not the clause.
 */
export interface ZeroLimitConformanceCase {
    /** Case label, used as the test name. */
    name: string;
    /** The query, exactly as a caller writes it. */
    query: { limit?: number; offset?: number };
    /**
     * How many of the twelve {@link PAGINATION_ROWS} must come back. A count
     * rather than an id set on purpose: `offset` with no `orderBy` leaves
     * *which* rows unspecified, and that is
     * {@link PAGINATION_UNORDERED_CASES}' question, not this one.
     */
    expectedRowCount: number;
}

/**
 * The cases. Three ask for nothing and must get nothing; three are the controls
 * that stop "return nothing, always" from passing.
 */
export const PAGINATION_ZERO_LIMIT_CASES: readonly ZeroLimitConformanceCase[] = [
    { name: 'limit 0 returns no records', query: { limit: 0 }, expectedRowCount: 0 },
    { name: 'limit 0 with an explicit offset 0 returns no records', query: { limit: 0, offset: 0 }, expectedRowCount: 0 },
    { name: 'limit 0 past the first page still returns no records', query: { limit: 0, offset: 5 }, expectedRowCount: 0 },
    { name: 'control — limit 2 returns two records', query: { limit: 2 }, expectedRowCount: 2 },
    { name: 'control — offset 0 alone does not truncate', query: { offset: 0 }, expectedRowCount: PAGINATION_ROWS.length },
    { name: 'control — no limit returns every record', query: {}, expectedRowCount: PAGINATION_ROWS.length },
];
