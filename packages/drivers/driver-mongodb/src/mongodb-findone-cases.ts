// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared cases for the two halves of the `findOne` query-execution proof
 * (objectstack#4419), so neither half can drift from the other.
 *
 * The defect being pinned — `MongoDBDriver.findOne` translating `where` and
 * dropping `orderBy` / `fields` / `offset` — needs BOTH halves, and each is
 * blind to something the other sees:
 *
 * - `mongodb-findone-options.test.ts` asserts the `FindOptions` the driver
 *   emits, and executes the cases against a controlled in-process collection.
 *   It needs no server, so it always runs — which matters, because a driver
 *   defect only a downloadable binary can catch is a defect nobody catches on
 *   a restricted network. What it cannot prove is that MongoDB agrees.
 * - `mongodb-findone-query.test.ts` runs the same cases against a real mongod,
 *   and skips when the binary cannot be fetched. It proves the server agrees;
 *   it proves nothing when it skips.
 *
 * One table, two readers. An expectation edited on one side moves both.
 *
 * `b` and `d` deliberately TIE on `rank`: equal sort keys have no defined
 * relative order in MongoDB, so a tie is the only place the driver's appended
 * `id` tie-breaker is observable in the ROWS at all.
 */

export interface FindOneRow {
  id: string;
  name: string;
  rank: number;
  secret: string;
}

export const FINDONE_ROWS: readonly FindOneRow[] = [
  { id: 'a', name: 'Alpha', rank: 3, secret: 'sa' },
  { id: 'b', name: 'Bravo', rank: 1, secret: 'sb' },
  { id: 'c', name: 'Charlie', rank: 2, secret: 'sc' },
  { id: 'd', name: 'Delta', rank: 1, secret: 'sd' },
];

export interface FindOneCase {
  /** Test name, used verbatim by both suites. */
  name: string;
  /** The QueryAST `findOne` receives — the engine always supplies `limit: 1`. */
  query: Record<string, unknown>;
  /** `id` of the row that must come back, or `null` for a miss. */
  expectId: string | null;
  /**
   * The `sort` the driver must put on the wire. `undefined` asserts that NO
   * ordering was imposed — the #4363 carve-out that makes `findOne` keep the
   * plan its predicate earned. Only the options suite can check this; it is not
   * observable in the rows.
   */
  expectSort: Record<string, 1 | -1> | undefined;
  /** Keys the returned row must have exactly, when the case projects. */
  expectKeys?: string[];
  /** `skip` the driver must put on the wire, when the case paginates. */
  expectSkip?: number;
}

export const FINDONE_CASES: readonly FindOneCase[] = [
  // ── orderBy: the half that used to vanish entirely ──────────────────
  {
    name: 'orderBy rank asc returns the lowest-ranked row, not an arbitrary one',
    query: { orderBy: [{ field: 'rank', order: 'asc' }], limit: 1 },
    expectId: 'b',
    expectSort: { rank: 1, id: 1 },
  },
  {
    name: 'orderBy rank desc returns the highest-ranked row',
    query: { orderBy: [{ field: 'rank', order: 'desc' }], limit: 1 },
    expectId: 'a',
    expectSort: { rank: -1, id: -1 },
  },
  {
    name: 'orderBy composes with a predicate — the first of the MATCHING rows',
    query: { where: { id: { $in: ['a', 'c'] } }, orderBy: [{ field: 'rank', order: 'asc' }], limit: 1 },
    expectId: 'c', // rank 2 < rank 3
    expectSort: { rank: 1, id: 1 },
  },

  // ── the id tie-breaker, in the LAST requested direction ─────────────
  {
    name: 'a tie on the sort key is broken by id, ascending',
    query: { where: { rank: 1 }, orderBy: [{ field: 'rank', order: 'asc' }], limit: 1 },
    expectId: 'b',
    expectSort: { rank: 1, id: 1 },
  },
  {
    name: 'a tie on the sort key is broken by id, descending',
    query: { where: { rank: 1 }, orderBy: [{ field: 'rank', order: 'desc' }], limit: 1 },
    expectId: 'd',
    expectSort: { rank: -1, id: -1 },
  },

  // ── fields / offset ─────────────────────────────────────────────────
  {
    name: 'fields projects — a column not asked for does not come back',
    query: { where: { id: 'a' }, fields: ['name'], limit: 1 },
    expectId: 'a',
    expectSort: undefined,
    expectKeys: ['id', 'name'], // `id` always kept, `_id` never
  },
  {
    name: 'offset skips, so an ordered walk can step past the first match',
    query: { orderBy: [{ field: 'rank', order: 'asc' }], offset: 1, limit: 1 },
    expectId: 'd', // ranks asc → b, d (tied, id asc), c, a
    expectSort: { rank: 1, id: 1 },
    expectSkip: 1,
  },

  // ── and the half that must stay ABSENT (#4363) ──────────────────────
  {
    name: 'an unsorted single-row lookup imposes no order — its limit: 1 is not a page',
    query: { where: { id: 'a' }, limit: 1 },
    expectId: 'a',
    expectSort: undefined,
  },
  {
    name: 'a miss is still null',
    query: { where: { id: 'nope' }, limit: 1 },
    expectId: null,
    expectSort: undefined,
  },
];
