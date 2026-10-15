// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the **composed `ReadableIds` leaf** — ADR-0139
 * D3: "The leaf joins the per-driver conformance case-sets, so a driver that
 * compiles it is measured and one that refuses is recorded as refusing."
 *
 * # The property
 *
 * `{ record_id: { $in: ReadableIds.compose(ReadableIds.of(P), scope) } }`
 * matches exactly the rows whose `record_id` is the id of a row of `P` that
 * `scope` admits, inside the driver's own tenant wall: the semi-join
 * `record_id IN (SELECT id FROM P WHERE scope AND tenant)` (D3, `driver-sql`),
 * however a driver evaluates it. `scope: undefined` is "no row restriction",
 * and the rows of `P` that exist are then the whole set.
 *
 * # Who builds the leaf, and why a driver never sees `ReadableIds.of`
 *
 * The engine composes every leaf at its executor boundary, immediately before
 * the driver call (D2), so a driver is handed composed leaves only. An
 * UNCOMPOSED leaf reaching a driver means something bypassed that seam, and
 * the driver refuses it with D3's envelope ({@link READABLE_IDS_REFUSAL}) —
 * ⛔ never evaluated as "no restriction". The cases build both shapes with the
 * spec's own factory (`./readable-ids.ts`), exactly as the engine does, and a
 * driver tells them apart with `isComposedReadableIds` / `isReadableIds`,
 * which answer disjointly.
 *
 * A caller the parent denies is answered `$in: []` by the engine (D2 steps 1
 * and 2, the deny sentinel included) and never reaches a driver as a composed
 * leaf, so the table carries that answer as an ordinary empty list.
 *
 * # How a driver suite consumes this table
 *
 * Seed {@link READABLE_IDS_PARENT_ROWS} as {@link READABLE_IDS_PARENT_OBJECT}
 * and {@link READABLE_IDS_CHILD_ROWS} as {@link READABLE_IDS_CHILD_OBJECT}, both
 * declaring `organization_id` as their tenant field, then for each case call
 * the driver's own `find` on the child object with `where: c.where()` and the
 * case's `options`:
 *
 * - a driver that COMPILES the leaf (D3: the SQL family, both Turso
 *   transports, `driver-memory`) asserts the child ids of each `matches` case
 *   — ascending — and D3's envelope on the `refuses-uncomposed` case;
 * - a driver that REFUSES the leaf (D3: `driver-mongodb`, until a card
 *   measures a pipeline form) asserts D3's envelope on every case that holds a
 *   composed leaf ({@link readableIdsCaseHoldsComposedLeaf}), and the row ids on
 *   the rest. That is what "recorded as refusing" means.
 *
 * A case with {@link ReadableIdsMatchesCase.requiresTenantWall} reads under a
 * tenant: it is the one that fails when the subquery is compiled without the
 * driver's tenant scope. A driver that refuses multi-tenant boot
 * (`driver-memory`, `memory-tenancy-guard.ts`) owes no wall (D3) and records
 * that refusal for the case instead of rows.
 *
 * # What belongs here
 *
 * Only what a driver decides: which rows the composed leaf admits, how it
 * composes under `$and` / `$or` / `$not`, and the refusal of the uncomposed
 * leaf. What the ENGINE decides — the composition itself, the write-verb and
 * `having` refusals, D5's three classes — is pinned in `@objectstack/objectql`.
 * The cases build every leaf from a factory, because the leaf is frozen and
 * branded and one shared instance across driver suites would let one suite's
 * run judge another's object.
 *
 * @see ./readable-ids.ts for the leaf, the composed leaf and the deny sentinel
 */

import type { FilterCondition } from './filter.zod';
import { ReadableIds } from './readable-ids';

/** The parent object — `P` in ADR-0139's notation. */
export const READABLE_IDS_PARENT_OBJECT = 'rid_parent';

/** The child object every case reads; its `record_id` points at the parent. */
export const READABLE_IDS_CHILD_OBJECT = 'rid_child';

/** A row of the parent object. `owner` is what the cases' scopes narrow on. */
export interface ReadableIdsParentRow {
  id: string;
  owner: string;
  organization_id: string;
}

/**
 * A row of the child object: the ActivityPointer pair the six consumers key on
 * (`object_name`, `record_id`), plus a column for the `$and` case to narrow on.
 */
export interface ReadableIdsChildRow {
  id: string;
  object_name: string;
  record_id: string | null;
  label: string;
  organization_id: string;
}

/**
 * Four parents. `p4` belongs to another tenant, so only a read under a tenant
 * can tell a walled subquery from an unwalled one.
 */
export const READABLE_IDS_PARENT_ROWS: readonly ReadableIdsParentRow[] = [
  { id: 'p1', owner: 'u1', organization_id: 'org_a' },
  { id: 'p2', owner: 'u2', organization_id: 'org_a' },
  { id: 'p3', owner: 'u1', organization_id: 'org_a' },
  { id: 'p4', owner: 'u1', organization_id: 'org_b' },
];

/**
 * Seven children, all in `org_a`, so the OUTER read's tenant wall excludes none
 * of them and every difference a tenant makes comes from the subquery's wall.
 *
 * - `c4` points at a parent that no longer exists (excluded: the subquery
 *   finds no such id);
 * - `c5` names no parent (excluded by `$in`, admitted by the NULL-safe `$not`);
 * - `c6` points across the tenant wall, at `p4`;
 * - `c7` names ANOTHER object with an id that `rid_parent` also carries: the
 *   leaf matches ids, and pairing them with `object_name` is the consumer's
 *   branch (ADR-0139 D4), so `c7` is in every case that does not say
 *   `object_name`.
 */
export const READABLE_IDS_CHILD_ROWS: readonly ReadableIdsChildRow[] = [
  { id: 'c1', object_name: 'rid_parent', record_id: 'p1', label: 'keep', organization_id: 'org_a' },
  { id: 'c2', object_name: 'rid_parent', record_id: 'p2', label: 'keep', organization_id: 'org_a' },
  { id: 'c3', object_name: 'rid_parent', record_id: 'p3', label: 'drop', organization_id: 'org_a' },
  { id: 'c4', object_name: 'rid_parent', record_id: 'p9', label: 'keep', organization_id: 'org_a' },
  { id: 'c5', object_name: 'rid_parent', record_id: null, label: 'keep', organization_id: 'org_a' },
  { id: 'c6', object_name: 'rid_parent', record_id: 'p4', label: 'keep', organization_id: 'org_a' },
  { id: 'c7', object_name: 'rid_other', record_id: 'p1', label: 'keep', organization_id: 'org_a' },
];

/**
 * D3's refusal envelope (ADR-0112): a composition fault, not an author error,
 * so ⛔ not `INVALID_FILTER`. A suite asserts `code` AND `status`; the message
 * (it names the driver, the leaf and the remedy) is not pinned here.
 */
export const READABLE_IDS_REFUSAL = Object.freeze({ code: 'INTERNAL_ERROR', status: 500 } as const);

interface ReadableIdsCaseBase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /**
   * Builds the `where` for a `find` on {@link READABLE_IDS_CHILD_OBJECT}. A
   * FACTORY: every call builds fresh leaves.
   */
  readonly where: () => FilterCondition;
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/** A case whose `where` the driver must EVALUATE, matching exactly {@link expected}. */
export interface ReadableIdsMatchesCase extends ReadableIdsCaseBase {
  readonly verdict: 'matches';
  /** Ids of the matching child rows, ascending. */
  readonly expected: readonly string[];
  /**
   * `where` holds a composed leaf. `false` only where the case carries the
   * engine's denial answer instead; a driver that refuses the leaf answers
   * {@link READABLE_IDS_REFUSAL} exactly on the cases where this is `true`.
   */
  readonly holdsComposedLeaf: boolean;
  /** The read's driver options; absent means an unscoped read. */
  readonly options?: { readonly tenantId: string };
  /**
   * The read is under a tenant, and the case fails when the subquery is
   * compiled without the driver's tenant scope (D3).
   */
  readonly requiresTenantWall?: true;
}

/** A case the driver must REFUSE with {@link READABLE_IDS_REFUSAL}: an uncomposed leaf reached it. */
export interface ReadableIdsRefusesUncomposedCase extends ReadableIdsCaseBase {
  readonly verdict: 'refuses-uncomposed';
}

export type ReadableIdsCase = ReadableIdsMatchesCase | ReadableIdsRefusesUncomposedCase;

const P = READABLE_IDS_PARENT_OBJECT;

/** The composed leaf for {@link READABLE_IDS_PARENT_OBJECT} under `scope`, built as the engine builds it. */
const composed = (scope: FilterCondition | undefined) => ReadableIds.compose(ReadableIds.of(P), scope);

/**
 * The cases: the leaf alone (no restriction, a narrowing scope, a scope that
 * admits nothing, the engine's denial answer), the leaf under each combinator,
 * the tenant wall, the consumers' branch shape, and the uncomposed leaf.
 */
export const READABLE_IDS_CASES: readonly ReadableIdsCase[] = [
  {
    name: 'no row restriction: every child whose parent exists',
    where: () => ({ record_id: { $in: composed(undefined) } }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c1', 'c2', 'c3', 'c6', 'c7'],
    note: 'c4 points at a parent that no longer exists and c5 names none: neither id is in the subquery. '
      + 'A driver that evaluates the leaf as "no restriction" returns them.',
  },
  {
    name: 'a scope narrows the parents whose children match',
    where: () => ({ record_id: { $in: composed({ owner: 'u1' }) } }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c1', 'c3', 'c6', 'c7'],
  },
  {
    name: 'a scope that admits no parent matches no child',
    where: () => ({ record_id: { $in: composed({ owner: 'nobody' }) } }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: [],
  },
  {
    name: 'the engine\'s denial answer, $in: [], matches no child',
    where: () => ({ record_id: { $in: [] } }),
    verdict: 'matches',
    holdsComposedLeaf: false,
    expected: [],
    note: 'ADR-0139 D2 steps 1 and 2: a caller the parent denies (canReadObject false, or the deny sentinel '
      + 'as its scope) is answered with an empty list, never a composed leaf. Every driver already answers it.',
  },
  {
    name: 'the leaf ANDs with a predicate on the child',
    where: () => ({ $and: [{ label: 'keep' }, { record_id: { $in: composed({ owner: 'u1' }) } }] }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c1', 'c6', 'c7'],
  },
  {
    name: 'the leaf is one arm of an $or',
    where: () => ({ $or: [{ record_id: null }, { record_id: { $in: composed({ owner: 'u2' }) } }] }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c2', 'c5'],
  },
  {
    name: '$not over the leaf is NULL-safe: it admits the child that names no parent',
    where: () => ({ $not: { record_id: { $in: composed(undefined) } } }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c4', 'c5'],
    note: 'ADR-0139 D1: the NULL-safe $not of the shared lowering applies to the leaf unchanged. '
      + 'A three-valued NOT IN drops c5.',
  },
  {
    name: 'the tenant wall binds the subquery: a parent in another tenant is not readable',
    where: () => ({ record_id: { $in: composed(undefined) } }),
    options: { tenantId: 'org_a' },
    requiresTenantWall: true,
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c1', 'c2', 'c3', 'c7'],
    note: 'ADR-0139 D2 step 3: the tenant wall is not in the scope; the driver applies its own tenant scope to '
      + 'the parent table with the outer read\'s options. c6 points at p4, in org_b: an unwalled subquery admits it.',
  },
  {
    name: 'the consumers\' branch: the leaf paired with the object it names',
    where: () => ({ object_name: P, record_id: { $in: composed(undefined) } }),
    verdict: 'matches',
    holdsComposedLeaf: true,
    expected: ['c1', 'c2', 'c3', 'c6'],
    note: 'The branch shape ADR-0139 D4 has each consumer emit per parent object. c7 carries an id that '
      + 'rid_parent also carries, under another object name.',
  },
  {
    name: 'an uncomposed leaf is refused, never evaluated as no restriction',
    where: () => ({ record_id: { $in: ReadableIds.of(P) } }),
    verdict: 'refuses-uncomposed',
    note: 'ADR-0139 D2\'s last paragraph and D3: a leaf that reached the driver without passing the engine\'s '
      + 'seam fails closed, loudly.',
  },
];
