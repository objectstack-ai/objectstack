// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D4] Canonical conformance cases for the **fixed-read leaves**
 * (`./fixed-read-leaf.ts`): one case-set, built once in the two-leaf shape,
 * with a set of cases per leaf. Today it holds `SharedRecordIds`
 * (`./shared-record-ids.ts`, ADR-0155 D1); ADR-0147's leaf adds its own
 * {@link FixedReadLeafCaseSet} to {@link FIXED_READ_LEAF_CASE_SETS} when its
 * spec card lands, ⛔ never a private copy of this module.
 *
 * # The property (ADR-0155 D-0)
 *
 * `{ id: { $in: SharedRecordIds.read(P, U) } }` matches exactly the rows of `P`
 * whose `id` is in G(P, U): the `record_id` values of the `sys_record_share`
 * rows with `object_name = P`, `recipient_type = 'user'`, `recipient_id = U`, a
 * `record_id` that is neither NULL nor empty and, on the write form, an
 * `access_level` among the levels the leaf carries. No tenant scope on that
 * inner read (① ruled A), inside the driver's own tenant wall on the outer
 * statement. Below today's cap the list the share arm binds is G, so the leaf
 * and that list answer the same rows: the `D-0` case pair holds them side by
 * side.
 *
 * # How a driver suite consumes a case-set
 *
 * Seed every {@link FixedReadLeafCaseSet.tables} entry as an object of that
 * name with the columns its rows carry (every column text, and nullable: the
 * NULL `record_id` row is the blank-id guard's witness, so a table that refuses
 * it cannot witness the guard), each declaring
 * {@link FixedReadLeafCaseSet.tenantField} as its tenant field. Then, for each
 * case, call the driver's own `find` on the case's `object` with
 * `where: c.where()` and the case's `options`:
 *
 * - a driver that EVALUATES the leaf (ADR-0155 D5: the SQL family, both Turso
 *   transports, `driver-memory`) asserts the ids of each case, ascending, and
 *   asserts `count` with the same `where` answers as many;
 * - a driver that REFUSES the leaf (ADR-0155 ② ruled: `driver-mongodb`,
 *   `driver-odata`, R2 with R1 behind it) asserts ADR-0139 D3's envelope,
 *   `READABLE_IDS_REFUSAL` (`./readable-ids-conformance.ts`), on every case
 *   that holds a leaf ({@link FixedReadLeafMatchesCase.holdsLeaf}), and the
 *   rows on the rest. That is what "recorded as refusing" means. ADR-0155 D4
 *   keeps ONE refusal envelope for every engine-internal leaf, so this module
 *   declares no second one.
 *
 * A case with {@link FixedReadLeafMatchesCase.requiresUnwalledInnerRead} reads
 * under a tenant: it is the one that fails when the inner read is compiled WITH
 * the driver's tenant scope. A driver that refuses a tenant-scoped call
 * (`driver-memory`, `memory-tenancy-guard.ts`) records that refusal for every
 * case that carries `options` instead of rows (ADR-0155 D5: ① does not arise
 * there).
 *
 * A driver whose predicate update compiles its `where` with the compiler it
 * reads with (`driver-sql`'s `updateMany`) owes the write-form cases on that
 * path too: the rows a predicate update with the same `where` touches are the
 * case's `expected` (ADR-0155 ③ ruled A; the driver card pins them).
 *
 * # The engine seam's cases
 *
 * {@link FixedReadLeafCaseSet.seam} holds, as data, what ADR-0155 D1 and D4
 * say the engine's executor seam admits and refuses: the leaf's position, its
 * verbs and its recipient. Nothing in this package runs them against an
 * engine; `@objectstack/objectql` runs them against its seam
 * (`fixed-read-leaf-seam.ts`). The write form on a read verb is refused like
 * any misplaced leaf (ADR-0155 ③ ruled A); the prior-row read a predicate
 * update makes with its own `where` is that update's, and the seam judges it
 * once, as the update.
 *
 * # What belongs here
 *
 * Only what an evaluator decides (the rows) and what the seam decides (admit
 * or refuse). The cases build every leaf from a factory, because the leaf is
 * frozen and branded and one shared instance across suites would let one
 * suite's run judge another's object.
 *
 * @see ./fixed-read-leaf.ts for the fixed inner read every evaluator compiles
 * @see ./shared-record-ids.ts for the leaf
 */

import type { FilterCondition } from './filter.zod';
import type { FixedReadLeafBrand, FixedReadLeafName } from './fixed-read-leaf';
import { ReadableIds } from './readable-ids';
import { SHARED_RECORD_IDS_BRAND, SharedRecordIds } from './shared-record-ids';

/** A fixture row: every column a string, or NULL. */
export type FixedReadLeafRow = Readonly<Record<string, string | null>>;

/** One table a case-set's suite seeds, by the object name it is registered under. */
export interface FixedReadLeafTable {
  /** The object (and table) name. */
  readonly object: string;
  /** Its rows, each carrying `id` and the case-set's tenant field. */
  readonly rows: readonly FixedReadLeafRow[];
}

interface FixedReadLeafCaseBase {
  /** Stable identifier, usable as a test name. Unique within its case-set. */
  readonly name: string;
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/** A case whose `where` the driver must EVALUATE on {@link object}, matching exactly {@link expected}. */
export interface FixedReadLeafMatchesCase extends FixedReadLeafCaseBase {
  readonly verdict: 'matches';
  /** The fixture object the `find` runs on. */
  readonly object: string;
  /** Builds the `where`. A FACTORY: every call builds fresh leaves. */
  readonly where: () => FilterCondition;
  /** Ids of the matching rows, ascending. Each id once: a record matched by several grant rows is one row. */
  readonly expected: readonly string[];
  /**
   * `where` holds a fixed-read leaf (directly, or inside a composed
   * `ReadableIds` scope). `false` only where the case carries a plain list
   * instead; a driver that refuses the leaf answers the refusal envelope
   * exactly on the cases where this is `true`.
   */
  readonly holdsLeaf: boolean;
  /** The read's driver options; absent means an unscoped read. */
  readonly options?: { readonly tenantId: string };
  /** The read is under a tenant, and the case fails when the inner read takes the driver's tenant scope. */
  readonly requiresUnwalledInnerRead?: true;
}

/**
 * The fields of an `ExecutionContext` (`../kernel/execution-context.zod.ts`)
 * the seam's recipient rule reads: the reading context's user, its delegator
 * (ADR-0090 D10) and the system flag.
 */
export interface FixedReadLeafSeamContext {
  readonly userId?: string;
  readonly onBehalfOf?: { readonly userId: string };
  readonly isSystem?: true;
}

/** An operation the engine's seam judges, and whether it admits the leaves the operation carries. */
export interface FixedReadLeafSeamCase extends FixedReadLeafCaseBase {
  /** The engine operation. `update` is a PREDICATE update: a by-id update carries no `where`. */
  readonly operation: 'find' | 'findOne' | 'count' | 'aggregate' | 'update' | 'delete';
  /** The object the operation runs on. */
  readonly object: string;
  /** Where the filter sits: the operation's `where`, or an aggregate's `having`. */
  readonly clause: 'where' | 'having';
  /**
   * Builds the filter AS THE SEAM SEES IT: after the engine composed every
   * `ReadableIds` leaf, so a composed scope that carries the leaf appears as
   * `ReadableIds.compose(…)`. A FACTORY: every call builds fresh leaves.
   */
  readonly filter: () => FilterCondition;
  /** The context the operation runs under. */
  readonly context: FixedReadLeafSeamContext;
  /**
   * `admits`: the seam hands every leaf to the driver as it stands. `refuses`:
   * the engine refuses the operation before any driver is called, with ADR-0139
   * D3's composition-fault envelope (`READABLE_IDS_REFUSAL`, `INTERNAL_ERROR` /
   * 500), ⛔ not `INVALID_FILTER`: no request can spell the leaf.
   */
  readonly verdict: 'admits' | 'refuses';
}

/** One leaf's cases. */
export interface FixedReadLeafCaseSet {
  /** The leaf the set is for, by its factory's name (`FIXED_READ_LEAF_NAMES`). */
  readonly leaf: FixedReadLeafName;
  /** Its brand: what a door caller names, and what an evaluator recognises. */
  readonly brand: FixedReadLeafBrand;
  /** The tenant field every fixture table declares. */
  readonly tenantField: 'organization_id';
  /** The tables a suite seeds, the inner read's table among them. */
  readonly tables: readonly FixedReadLeafTable[];
  /** What an evaluator answers. */
  readonly cases: readonly FixedReadLeafMatchesCase[];
  /** What the engine's executor seam admits and refuses (ADR-0155 plan step 2 runs them). */
  readonly seam: readonly FixedReadLeafSeamCase[];
}

// ── SharedRecordIds (ADR-0155) ───────────────────────────────────────────────

/** The object the grants are on — `P` in the notation above. */
const DOC = 'srid_doc';
/** A child object whose `record_id` points at a doc: the nested position's reader. */
const NOTE = 'srid_note';
/** Another object, whose grants are never the doc's. */
const OTHER = 'srid_other';

/**
 * The access levels are fixture tokens, ⛔ not plugin-sharing's vocabulary:
 * the leaf carries whatever levels its producer supplies, and an evaluator owes
 * membership in THOSE, never in a list of its own. A driver that compiles
 * plugin-sharing's write levels instead of the leaf's answers no row on the
 * write-form cases.
 */
const LEVEL_READ = 'lvl_read';
const LEVEL_EDIT = 'lvl_edit';
const LEVEL_FULL = 'lvl_full';
const WRITE_LEVELS = [LEVEL_EDIT, LEVEL_FULL] as const;

/** Rows a suite cannot edit: one suite's seeding never changes what the next one reads. */
const frozenRows = (rows: readonly FixedReadLeafRow[]): readonly FixedReadLeafRow[] =>
  Object.freeze(rows.map((row) => Object.freeze({ ...row })));

/**
 * Nine docs. `d8` belongs to another tenant, so only a read under a tenant can
 * tell the outer wall's work apart.
 */
const DOC_ROWS: readonly FixedReadLeafRow[] = frozenRows([
  { id: 'd1', owner: 'u2', label: 'keep', organization_id: 'org_a' },
  { id: 'd2', owner: 'u2', label: 'keep', organization_id: 'org_a' },
  { id: 'd3', owner: 'u1', label: 'keep', organization_id: 'org_a' },
  { id: 'd4', owner: 'u2', label: 'keep', organization_id: 'org_a' },
  { id: 'd5', owner: 'u2', label: 'keep', organization_id: 'org_a' },
  { id: 'd6', owner: 'u2', label: 'keep', organization_id: 'org_a' },
  { id: 'd7', owner: 'u2', label: 'drop', organization_id: 'org_a' },
  { id: 'd8', owner: 'u2', label: 'keep', organization_id: 'org_b' },
  { id: 'd9', owner: 'u3', label: 'keep', organization_id: 'org_a' },
]);

/**
 * Ten grant rows, the inner read's table. Each row exists for one of G's
 * predicates:
 *
 * - `g1`–`g3` grant `d1` and `d2` to `u1`; `d2` holds TWO rows (one per
 *   source, at two levels), and is still one member;
 * - `g4` is `u2`'s, never `u1`'s (`recipient_id`);
 * - `g5` names `d5` under ANOTHER object (`object_name`);
 * - `g6` is a group's grant whose id happens to be `u1` (`recipient_type`
 *   fixed to `'user'`);
 * - `g7` grants `d7`, a doc in `org_a`, on a row stamped `org_b`: it counts,
 *   because the inner read carries no tenant scope (① ruled A), directly and
 *   through the note `n5` in the nested position;
 * - `g8` grants `d8`, a doc in `org_b`: under a tenant read in `org_a` the
 *   OUTER wall drops it, as it does today;
 * - `g9` and `g10` carry a NULL and an empty `record_id` (the blank-id guard).
 *   The empty one names no doc, so no row tells it apart; the NULL one is what
 *   a negation trips on without the guard.
 */
const GRANT_ROWS: readonly FixedReadLeafRow[] = frozenRows([
  { id: 'g1', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: 'd1', access_level: LEVEL_READ, organization_id: 'org_a' },
  { id: 'g2', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: 'd2', access_level: LEVEL_READ, organization_id: 'org_a' },
  { id: 'g3', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: 'd2', access_level: LEVEL_EDIT, organization_id: 'org_a' },
  { id: 'g4', object_name: DOC, recipient_type: 'user', recipient_id: 'u2', record_id: 'd4', access_level: LEVEL_EDIT, organization_id: 'org_a' },
  { id: 'g5', object_name: OTHER, recipient_type: 'user', recipient_id: 'u1', record_id: 'd5', access_level: LEVEL_EDIT, organization_id: 'org_a' },
  { id: 'g6', object_name: DOC, recipient_type: 'group', recipient_id: 'u1', record_id: 'd6', access_level: LEVEL_EDIT, organization_id: 'org_a' },
  { id: 'g7', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: 'd7', access_level: LEVEL_FULL, organization_id: 'org_b' },
  { id: 'g8', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: 'd8', access_level: LEVEL_EDIT, organization_id: 'org_b' },
  { id: 'g9', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: null, access_level: LEVEL_EDIT, organization_id: 'org_a' },
  { id: 'g10', object_name: DOC, recipient_type: 'user', recipient_id: 'u1', record_id: '', access_level: LEVEL_EDIT, organization_id: 'org_a' },
]);

/**
 * Five notes, the nested position's rows. `n4` names no doc; `n5` names `d7`,
 * whose only grant is stamped in another organization, so the nested position
 * crosses an organization too.
 */
const NOTE_ROWS: readonly FixedReadLeafRow[] = frozenRows([
  { id: 'n1', record_id: 'd1', organization_id: 'org_a' },
  { id: 'n2', record_id: 'd3', organization_id: 'org_a' },
  { id: 'n3', record_id: 'd4', organization_id: 'org_a' },
  { id: 'n4', record_id: null, organization_id: 'org_a' },
  { id: 'n5', record_id: 'd7', organization_id: 'org_a' },
]);

const read = (recipient: string) => SharedRecordIds.read(DOC, recipient);
const write = (recipient: string, levels: readonly string[] = WRITE_LEVELS) =>
  SharedRecordIds.write(DOC, recipient, levels);
/** The read scope D3 composes for a caller: the owner match OR the share arm. */
const readScope = (user: string): FilterCondition => ({ $or: [{ owner: user }, { id: { $in: read(user) } }] });

const SHARED_RECORD_IDS_CASES: readonly FixedReadLeafMatchesCase[] = Object.freeze([
  {
    name: 'the read form: every record shared with the recipient, at any level',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: read('u1') } }),
    holdsLeaf: true,
    expected: ['d1', 'd2', 'd7', 'd8'],
    note: 'd4 is u2\'s grant, d5\'s grant names another object, d6\'s recipient is a group, and the NULL and '
      + 'empty record_id rows name no record. A driver that drops one of the fixed predicates admits that row.',
  },
  {
    name: 'D-0: today\'s list of the granted ids answers the same rows',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: ['d1', 'd2', 'd7', 'd8'] } }),
    holdsLeaf: false,
    expected: ['d1', 'd2', 'd7', 'd8'],
    note: 'ADR-0155 D-0: below the cap the list plugin-sharing binds today is G, so the leaf and the list select '
      + 'the same rows. The list is G read from the grant rows as the plugin reads it (nullish and empty ids '
      + 'dropped); every driver already answers it.',
  },
  {
    name: 'another recipient\'s grants are theirs alone',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: read('u2') } }),
    holdsLeaf: true,
    expected: ['d4'],
  },
  {
    name: 'a recipient who holds no grant: the leaf admits nothing',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: read('u3') } }),
    holdsLeaf: true,
    expected: [],
  },
  {
    name: 'several grant rows on one record are one member',
    verdict: 'matches',
    object: DOC,
    where: () => ({ $and: [{ id: 'd2' }, { id: { $in: read('u1') } }] }),
    holdsLeaf: true,
    expected: ['d2'],
    note: 'ADR-0155 D1 and D2: d2 carries two grant rows to u1. The leaf sits in the list\'s own position, so '
      + 'the record is one row; a join answers it twice, and count disagrees with find.',
  },
  {
    name: 'the write form admits only the levels it carries',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: write('u1') } }),
    holdsLeaf: true,
    expected: ['d2', 'd7', 'd8'],
    note: 'ADR-0155 ③ ruled A: d1 is shared at the read level only. d2 is admitted by its edit-level row and is '
      + 'still one row.',
  },
  {
    name: 'the write form with one level: membership is in the leaf\'s own levels',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: write('u1', [LEVEL_FULL]) } }),
    holdsLeaf: true,
    expected: ['d7'],
    note: 'The levels are fixture tokens. A driver that compiles a level list of its own instead of the leaf\'s '
      + 'answers no row here.',
  },
  {
    name: 'the read scope\'s shape: the owner match OR the leaf',
    verdict: 'matches',
    object: DOC,
    where: () => readScope('u1'),
    holdsLeaf: true,
    expected: ['d1', 'd2', 'd3', 'd7', 'd8'],
    note: 'ADR-0155 D3: every arm stays in the same filter. d3 is owned, the rest are shared.',
  },
  {
    name: 'a caller who holds no grant: the leaf arm adds no row to the owner match',
    verdict: 'matches',
    object: DOC,
    where: () => readScope('u3'),
    holdsLeaf: true,
    expected: ['d9'],
    note: 'ADR-0155 D6: for a caller with no grant today\'s scope is the bare owner match; after the switch it is '
      + 'an $or with the leaf, and the rows are the same.',
  },
  {
    name: 'the leaf ANDs with a predicate on the object',
    verdict: 'matches',
    object: DOC,
    where: () => ({ $and: [{ label: 'keep' }, { id: { $in: read('u1') } }] }),
    holdsLeaf: true,
    expected: ['d1', 'd2', 'd8'],
  },
  {
    name: '$not over the leaf answers every record not shared, which needs the blank-id guard',
    verdict: 'matches',
    object: DOC,
    where: () => ({ $not: { id: { $in: read('u1') } } }),
    holdsLeaf: true,
    expected: ['d3', 'd4', 'd5', 'd6', 'd9'],
    note: 'ADR-0155 D2: g9 holds a NULL record_id, and id NOT IN (a subquery holding one NULL) is never true, so '
      + 'an inner read compiled without the blank-id guard answers no row here.',
  },
  {
    name: 'the inner read carries no tenant scope: a grant stamped in another organization still counts',
    verdict: 'matches',
    object: DOC,
    where: () => ({ id: { $in: read('u1') } }),
    options: { tenantId: 'org_a' },
    requiresUnwalledInnerRead: true,
    holdsLeaf: true,
    expected: ['d1', 'd2', 'd7'],
    note: 'ADR-0155 ① ruled A: d7 is in org_a and its grant row is stamped org_b; a walled inner read drops it. '
      + 'd8 is in org_b, and the OUTER wall drops it, as it does today.',
  },
  {
    name: 'inside a composed ReadableIds scope whose parent is the object it names: the subqueries nest',
    verdict: 'matches',
    object: NOTE,
    where: () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), readScope('u1')) } }),
    holdsLeaf: true,
    expected: ['n1', 'n2', 'n5'],
    note: 'ADR-0155 D4: the scope the engine composes for a ReadableIds leaf is the parent\'s read filter, which '
      + 'carries this leaf for a sharing-scoped parent. n1\'s and n5\'s docs are shared, n2\'s is owned, n3\'s is '
      + 'neither and n4 names none. A driver that evaluates the inner leaf as no restriction returns n3 too.',
  },
  {
    name: 'nested, under a tenant: the inner read stays unwalled inside the parent\'s walled subquery',
    verdict: 'matches',
    object: NOTE,
    where: () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), readScope('u1')) } }),
    options: { tenantId: 'org_a' },
    requiresUnwalledInnerRead: true,
    holdsLeaf: true,
    expected: ['n1', 'n2', 'n5'],
    note: 'ADR-0155 ① ruled A, in the nested position: the composed scope\'s subquery takes the outer read\'s '
      + 'tenant wall on the doc (ADR-0139 D3), and the leaf inside it takes none, so n5 counts through d7, whose '
      + 'only grant is stamped org_b. An inner read walled with the driver\'s tenant scope drops n5.',
  },
]);

const ASKER = { userId: 'u1' } as const;
const RECIPIENT_U1 = 'the recipient is the reading context\'s user';

const SHARED_RECORD_IDS_SEAM: readonly FixedReadLeafSeamCase[] = Object.freeze([
  // Position (ADR-0155 D1): the $in comparand of `id` on the object it names.
  { name: 'the read form on id of the object it names, in a find\'s where', operation: 'find', object: DOC, clause: 'where', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'admits', note: RECIPIENT_U1 },
  { name: 'the read form in a findOne\'s where', operation: 'findOne', object: DOC, clause: 'where', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'admits' },
  { name: 'the read form in a count\'s where', operation: 'count', object: DOC, clause: 'where', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'admits' },
  { name: 'the read form in an aggregate\'s where', operation: 'aggregate', object: DOC, clause: 'where', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'admits' },
  {
    name: 'under $and, $or and $not like any $in',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ $and: [{ label: 'keep' }, { $or: [{ owner: 'u1' }, { $not: { id: { $in: read('u1') } } }] }] }),
    context: ASKER, verdict: 'admits',
  },
  { name: 'on a field other than id', operation: 'find', object: DOC, clause: 'where', filter: () => ({ owner: { $in: read('u1') } }), context: ASKER, verdict: 'refuses' },
  {
    name: 'on id of an object it does not name',
    operation: 'find', object: OTHER, clause: 'where',
    filter: () => ({ id: { $in: read('u1') } }),
    context: ASKER, verdict: 'refuses',
  },
  {
    name: 'inside a composed ReadableIds scope whose parent is the object it names',
    operation: 'find', object: NOTE, clause: 'where',
    filter: () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), { id: { $in: read('u1') } }) } }),
    context: ASKER, verdict: 'admits',
    note: 'ADR-0155 D4: the seam descends into composed scopes, and there the leaf names the scope\'s parent.',
  },
  {
    name: 'inside a composed ReadableIds scope whose parent is another object',
    operation: 'find', object: NOTE, clause: 'where',
    filter: () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(OTHER), { id: { $in: read('u1') } }) } }),
    context: ASKER, verdict: 'refuses',
  },
  { name: 'in an aggregate\'s having', operation: 'aggregate', object: DOC, clause: 'having', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'refuses' },
  // Verbs (ADR-0155 D1; ③ ruled A): the write form in a predicate update's where, and nowhere else on a write.
  {
    name: 'the write form in a predicate update\'s where',
    operation: 'update', object: DOC, clause: 'where',
    filter: () => ({ $or: [{ owner: 'u1' }, { id: { $in: write('u1') } }] }),
    context: ASKER, verdict: 'admits',
    note: 'ADR-0155 ③ ruled A: the one write position, admitted for this brand alone.',
  },
  { name: 'the read form in a predicate update\'s where', operation: 'update', object: DOC, clause: 'where', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'refuses' },
  {
    name: 'the write form on delete',
    operation: 'delete', object: DOC, clause: 'where',
    filter: () => ({ id: { $in: write('u1') } }),
    context: ASKER, verdict: 'refuses',
    note: 'ADR-0111 D3: a share widens edit, never delete, so no producer writes the leaf on delete.',
  },
  { name: 'the read form on delete', operation: 'delete', object: DOC, clause: 'where', filter: () => ({ id: { $in: read('u1') } }), context: ASKER, verdict: 'refuses' },
  // The write form on a read verb (ADR-0155 ③ ruled A): refused like any misplaced leaf.
  { name: 'the write form in a find\'s where', operation: 'find', object: DOC, clause: 'where', filter: () => ({ id: { $in: write('u1') } }), context: ASKER, verdict: 'refuses' },
  { name: 'the write form in a findOne\'s where', operation: 'findOne', object: DOC, clause: 'where', filter: () => ({ id: { $in: write('u1') } }), context: ASKER, verdict: 'refuses' },
  { name: 'the write form in a count\'s where', operation: 'count', object: DOC, clause: 'where', filter: () => ({ id: { $in: write('u1') } }), context: ASKER, verdict: 'refuses' },
  { name: 'the write form in an aggregate\'s where', operation: 'aggregate', object: DOC, clause: 'where', filter: () => ({ id: { $in: write('u1') } }), context: ASKER, verdict: 'refuses' },
  {
    name: 'the write form inside a composed ReadableIds scope',
    operation: 'find', object: NOTE, clause: 'where',
    filter: () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), { id: { $in: write('u1') } }) } }),
    context: ASKER, verdict: 'refuses',
    note: 'ADR-0155 D1: a composed scope is the where of a read of its parent, so it holds the read form only.',
  },
  // The leaf outside the $in comparand (ADR-0155 D1): refused at every other position.
  { name: 'as an implicit-equality value', operation: 'find', object: DOC, clause: 'where', filter: () => ({ id: read('u1') }), context: ASKER, verdict: 'refuses' },
  { name: 'as the comparand of $eq', operation: 'find', object: DOC, clause: 'where', filter: () => ({ id: { $eq: read('u1') } }), context: ASKER, verdict: 'refuses' },
  {
    name: 'as the comparand of $nin',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ id: { $nin: read('u1') } }),
    context: ASKER, verdict: 'refuses',
    note: 'ADR-0155 D1: the negation is $not over the $in, which needs the blank-id guard; $nin is not a position.',
  },
  { name: 'as a member of a $in list', operation: 'find', object: DOC, clause: 'where', filter: () => ({ id: { $in: [read('u1')] } }), context: ASKER, verdict: 'refuses' },
  {
    name: 'as a filter node of its own',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ $and: [{ label: 'keep' }, read('u1') as unknown as FilterCondition] }),
    context: ASKER, verdict: 'refuses',
    note: 'Its enumerable inputs would read as an equality filter on fields named object and recipient.',
  },
  {
    name: 'inside a nested-relation condition',
    operation: 'find', object: NOTE, clause: 'where',
    filter: () => ({ record_id: { id: { $in: read('u1') } } } as unknown as FilterCondition),
    context: ASKER, verdict: 'refuses',
    note: 'ADR-0155 D1: legal in the object\'s own where or a composed scope, and a nested-relation condition is neither.',
  },
  // Recipient (ADR-0155 D4): the context's user, its delegator, a system context; any other is refused.
  {
    name: 'the recipient is the reading context\'s delegator',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ id: { $in: read('u1') } }),
    context: { userId: 'agent_1', onBehalfOf: { userId: 'u1' } },
    verdict: 'admits',
  },
  {
    name: 'a delegated operation carries one leaf per identity, each admitted',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ $and: [readScope('agent_1'), readScope('u1')] }),
    context: { userId: 'agent_1', onBehalfOf: { userId: 'u1' } },
    verdict: 'admits',
    note: 'ADR-0155 D3: one leaf on each side of the ADR-0090 D10 intersection.',
  },
  {
    name: 'a system context may carry a scope composed for any principal',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ id: { $in: read('u2') } }),
    context: { isSystem: true },
    verdict: 'admits',
  },
  {
    name: 'any other recipient is refused',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ id: { $in: read('u2') } }),
    context: ASKER, verdict: 'refuses',
    note: 'ADR-0155 D4: a composed scope is trusted only for the principal it was composed for. The seam compares '
      + 'and never replaces the recipient.',
  },
  {
    name: 'the recipient rule holds on the write form',
    operation: 'update', object: DOC, clause: 'where',
    filter: () => ({ id: { $in: write('u2') } }),
    context: ASKER, verdict: 'refuses',
  },
  {
    name: 'the recipient rule holds inside a composed scope',
    operation: 'find', object: NOTE, clause: 'where',
    filter: () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(DOC), { id: { $in: read('u2') } }) } }),
    context: ASKER, verdict: 'refuses',
  },
  {
    name: 'a delegated operation carrying a third identity\'s leaf is refused',
    operation: 'find', object: DOC, clause: 'where',
    filter: () => ({ $and: [readScope('agent_1'), readScope('u2')] }),
    context: { userId: 'agent_1', onBehalfOf: { userId: 'u1' } },
    verdict: 'refuses',
  },
]);

/**
 * [ADR-0155 D1, D4] The `SharedRecordIds` case-set: the docs it is on
 * (`srid_doc`), the grant table its inner read reads (`sys_record_share`), the
 * notes that read the docs through a composed `ReadableIds` scope (`srid_note`),
 * the cases every evaluator answers and the cases the engine's seam judges.
 */
export const SHARED_RECORD_IDS_CASE_SET: FixedReadLeafCaseSet = Object.freeze({
  leaf: 'SharedRecordIds',
  brand: SHARED_RECORD_IDS_BRAND,
  tenantField: 'organization_id',
  tables: Object.freeze([
    Object.freeze({ object: DOC, rows: DOC_ROWS }),
    Object.freeze({ object: SharedRecordIds.innerRead(read('u1')).table, rows: GRANT_ROWS }),
    Object.freeze({ object: NOTE, rows: NOTE_ROWS }),
  ]),
  cases: SHARED_RECORD_IDS_CASES,
  seam: SHARED_RECORD_IDS_SEAM,
} as const);

/**
 * Every fixed-read leaf's case-set, one per leaf. ADR-0147's leaf appends its
 * own; a driver suite iterates this list, so a new leaf reaches every suite
 * that runs it.
 */
export const FIXED_READ_LEAF_CASE_SETS: readonly FixedReadLeafCaseSet[] = Object.freeze([SHARED_RECORD_IDS_CASE_SET]);
