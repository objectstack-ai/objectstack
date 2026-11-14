// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the Filter Protocol's **comparand-type
 * door** (#7872) — the pins the ruling asked for, in both directions, run on
 * every driver path:
 *
 * 1. **Each of the six accepted types compiles on every driver path** —
 *    `string | number | bigint | boolean | null | Date`, the measured superset
 *    of #7956's divergence matrix. `bigint` arrives at the driver already
 *    narrowed to its exact number by the door, which is what makes this true
 *    on the memory path (mingo cannot serialize a bigint at any value — the
 *    crash cell this card was filed over).
 * 2. **A refused type gets the loud refusal** — `undefined`, Symbol, function,
 *    `Map`, a class instance, a plain object in a scalar slot, a bigint beyond
 *    ±2^53 — with the `INVALID_FILTER` / 400 envelope, BEFORE any driver runs.
 *    This includes the two worst measured cells, which become refusals: the
 *    mongo silent-edit cell (`{qty: undefined}` encoded to `{}` = match
 *    everything) and the memory BigInt crash cell (a raw mingo `TypeError`).
 *
 * ## How a driver suite consumes this table
 *
 * The door sits UPSTREAM of every driver (`parseFilterAST` and the engine's
 * lowering seam), so a driver's conformance is two-sided:
 *
 * - `door-refusal` cases: assert `parseFilterAST(filter)` throws the envelope
 *   (`code` AND `status`, plus {@link ComparandTypeRefusalCase.mustMention}) —
 *   proving the input can never reach this driver through a platform door.
 *   This is how a driver that carries no comparand-type policy of its own
 *   inherits this one without a driver-local patch. The property was argued
 *   for while `driver-memory` and `driver-mongodb` were frozen (#5499, lifted
 *   2026-08-11) and does not depend on that: the door sits upstream of every
 *   driver, so no driver has to hold a second copy of the rule.
 * - `matches` / `compiles` cases: hand `parseFilterAST(filter)` — the
 *   door-validated, bigint-narrowed condition — to the driver's own execution
 *   path and assert the row ids (`matches`) or merely that execution succeeds
 *   (`compiles` — used for `Date`, whose ROW agreement is temporal-conformance's
 *   subject, not this table's).
 *
 * `driver-mongodb` evaluates its emitted documents in-process (its real-mongod
 * suites are opt-in, #5517) — the same server-free judgement its logic/text
 * conformance suites make, stated in its suite as the accepted substitute.
 *
 * ## What belongs here
 *
 * Comparand TYPE policy only. Comparand SHAPE (`$in: 'scalar'`, `$between`
 * arity) is the engine gate's subject (#5869); text-operator VALUE rules
 * (`$icontains: 42` is refused per-operator) are `FILTER_TEXT_CASES`'; storage
 * forms are `TEMPORAL_CASES`'. The same one-axis bar the sibling tables set.
 *
 * [#19757] One row family sits on that line and lives HERE: an ARRAY as an
 * EQUALITY comparand (implicit `{ field: [...] }`, or `$eq`). An array is
 * none of the six accepted types, and the row is the direct sibling of "a
 * plain object in a scalar slot" below — the same question, "is this ONE
 * comparable value", one JS type over. It is ANSWERED by the comparand-SHAPE
 * door (`assertListComparandShapes`, ruled 2026-09-23), which runs inside
 * `parseFilterAST` before the type door does; a `door-refusal` row asks only
 * that `parseFilterAST` refuse before any driver runs, which is the whole of
 * what the ruling promises every driver, and this is the one table every
 * driver suite already runs through that door. `driver-mongodb` was the backend
 * that ANSWERED the shape; the nested row is the one `driver-sql` answered with
 * a 500 rather than its 400.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/7872 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/7956 (the matrix)
 */

import type { FilterCondition } from './filter.zod';
import { ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE } from './filter-comparand-type';

/** A row in the conformance fixture. */
export interface ComparandTypeRow {
  id: string;
  /** number — the column the #7956 matrix probed (`{qty: {$eq: …}}`). */
  qty: number;
  label: string;
  active: boolean;
  note: string | null;
}

/**
 * The fixture: #7956's one-row table, plus a second row so a wrongly-inverted
 * predicate returns visibly wrong ids rather than the same count by luck.
 */
export const FILTER_COMPARAND_TYPE_ROWS: readonly ComparandTypeRow[] = [
  { id: '1', qty: 100, label: 'alpha', active: true, note: null },
  { id: '2', qty: 250, label: 'beta', active: false, note: 'kept' },
] as const;

/** The class-instance refused comparand — the matrix row's shape, shared so every suite probes the same value. */
export class ComparandTypeProbe {
  constructor(readonly v: number = 100) {}
}

interface ComparandTypeCaseBase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /**
   * Builds the filter under test. A FACTORY rather than a value because
   * several cases carry a fresh `Date` / `Map` / class instance, and a shared
   * mutable instance across five suites would let one suite's run change what
   * another judged.
   */
  readonly filter: () => FilterCondition;
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/** A case whose door-validated filter must be EVALUATED, matching exactly {@link expected}. */
export interface ComparandTypeMatchesCase extends ComparandTypeCaseBase {
  readonly verdict: 'matches';
  /** Ids of matching rows, ascending. */
  readonly expected: readonly string[];
}

/**
 * A case whose door-validated filter must EXECUTE without refusal; the row set
 * is deliberately not asserted (per-backend storage forms are another table's
 * subject).
 */
export interface ComparandTypeCompilesCase extends ComparandTypeCaseBase {
  readonly verdict: 'compiles';
}

/** A case the DOOR must refuse — before any driver runs. */
export interface ComparandTypeRefusalCase extends ComparandTypeCaseBase {
  readonly verdict: 'door-refusal';
  /** The ADR-0112 code the refusal must carry, beside `status: 400`. */
  readonly code: 'INVALID_FILTER';
  /** Substrings the refusal message must contain. */
  readonly mustMention: readonly string[];
}

export type ComparandTypeCase =
  | ComparandTypeMatchesCase
  | ComparandTypeCompilesCase
  | ComparandTypeRefusalCase;

/**
 * The cases. Direction one (the six accepted types, operator form,
 * implicit-equality form and list members), then direction two (the refused
 * types at every judged position, the two worst measured cells included).
 */
export const FILTER_COMPARAND_TYPE_CASES: readonly ComparandTypeCase[] = [
  // ── Direction one: the six accepted types compile on every driver path ────
  {
    name: 'string compiles and matches — operator form',
    filter: () => ({ label: { $eq: 'beta' } }),
    verdict: 'matches',
    expected: ['2'],
  },
  {
    name: 'number compiles and matches — the control cell of the cross-driver comparand-type measurement',
    filter: () => ({ qty: { $eq: 100 } }),
    verdict: 'matches',
    expected: ['1'],
    note: 'The matrix\'s control: this row returning on every driver is what made its zeros real answers.',
  },
  {
    name: 'bigint compiles and matches — the crash cell, dead at the shared comparand door',
    filter: () => ({ qty: { $eq: BigInt(100) } }),
    verdict: 'matches',
    expected: ['1'],
    note: 'driver-memory answered this exact filter with a raw mingo TypeError out of Query.compile; '
      + 'the door narrows the bigint to its exact number, so no driver path sees a bigint at all.',
  },
  {
    name: 'bigint compiles and matches — implicit-equality form',
    filter: () => ({ qty: BigInt(250) }),
    verdict: 'matches',
    expected: ['2'],
  },
  {
    name: 'bigint compiles and matches — as an $in member',
    filter: () => ({ qty: { $in: [BigInt(100), 999] } }),
    verdict: 'matches',
    expected: ['1'],
    note: '$in/$nin members are comparands in their own right, each judged like a scalar comparand — the door narrows each.',
  },
  {
    name: 'boolean compiles and matches — implicit-equality form',
    filter: () => ({ active: true }),
    verdict: 'matches',
    expected: ['1'],
  },
  {
    name: 'null compiles and matches — the declared null predicate',
    filter: () => ({ note: null }),
    verdict: 'matches',
    expected: ['1'],
    note: 'null IS a comparand and IS the null predicate — the half left untouched when an undefined comparand was ruled a loud refusal — so the door must not confuse it with undefined.',
  },
  {
    name: 'Date compiles — row agreement is temporal-conformance\'s subject',
    filter: () => ({ label: { $gte: new Date('2020-01-01T00:00:00.000Z') as unknown as string } }),
    verdict: 'compiles',
    note: 'A Date comparand must pass the door and execute everywhere; what it MATCHES against a stored '
      + 'text/date column legitimately differs per storage form (ADR-0053), so no row set is asserted here.',
  },

  // ── Direction two: everything else is refused loudly, at the door ─────────
  {
    name: 'undefined is refused — operator form',
    filter: () => ({ qty: { $eq: undefined as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['undefined', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
  {
    name: 'undefined is refused — implicit-equality form (the mongo silent-edit worst cell, dead)',
    filter: () => ({ qty: undefined as unknown as number }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['undefined', 'null'],
    note: 'Measured on the wire: {qty: undefined} BSON-encoded to {} — MATCH EVERYTHING, the one cell '
      + 'that returned MORE data rather than less. It is also the one refused value that arrives by '
      + 'accident ({owner: someVar} with someVar unset), so the message carries the null/omit prescription.',
  },
  {
    name: 'undefined is refused — as an $in member',
    filter: () => ({ qty: { $in: [100, undefined as unknown as number] } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['$in[1]'],
  },
  {
    name: 'a function is refused',
    filter: () => ({ qty: { $eq: ((): number => 1) as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['a function', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
  {
    name: 'a Symbol is refused',
    filter: () => ({ qty: { $eq: Symbol('x') as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['a Symbol', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
  {
    name: 'a Map is refused',
    filter: () => ({ qty: { $eq: new Map() as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['a Map instance', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
  {
    name: 'a class instance is refused',
    filter: () => ({ qty: { $eq: new ComparandTypeProbe() as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['instance', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
  {
    name: 'a class instance is refused — implicit-equality form',
    filter: () => ({ qty: new ComparandTypeProbe() as unknown as number }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['instance'],
    note: 'On the wire this encoded to {qty: {"v":100}} — a document match the author never wrote.',
  },
  {
    name: 'a plain object in a scalar slot is refused',
    filter: () => ({ qty: { $eq: { v: 100 } as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['a plain object', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
    note: 'The SQL family already refused this ("cannot be bound"); the door makes the answer uniform '
      + 'instead of deep-equality-on-two-drivers, refusal-on-three.',
  },
  {
    name: 'an ARRAY in the implicit-equality slot is refused at the shared face',
    filter: () => ({ label: ['alpha'] as unknown as string }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['at where.label.', '{"$in": […]}', '{"$contains": "…"}'],
    note: 'Ruled 2026-09-23: refused at the shared face for every driver at once. Before it, the SQL '
      + 'family and driver-memory refused it, formula excluded every row, and driver-mongodb ANSWERED '
      + 'it with MongoDB\'s array equality (a stored array equal to the list, or holding it as an element).',
  },
  {
    name: 'an ARRAY under $eq is refused at the shared face',
    filter: () => ({ label: { $eq: ['alpha'] as unknown as string } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['Operator "$eq"', 'at where.label.$eq.', '{"$in": […]}'],
  },
  {
    name: 'an ARRAY in the equality slot is refused nested in $or too, at the shared face',
    filter: () => ({ $or: [{ qty: 100 }, { label: ['alpha'] as unknown as string }] }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['at where.$or[1].label.'],
    note: 'The nested form is the cell driver-sql answered with a 500 DATABASE_ERROR (SQLite could not '
      + 'bind the list) where its top-level twin got the 400 — the door now answers both alike.',
  },
  {
    name: 'a bigint beyond ±2^53 is refused — precision loss must not answer silently',
    filter: () => ({ qty: { $eq: (BigInt(2) ** BigInt(53) + BigInt(1)) as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['2^53', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
] as const;

/* ────────────────────────────────────────────────────────────────────────────
 * [#29486] A number or boolean comparand on a STRING-STORED field
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The fixture's declared fields: a text-family field and an option-family
 * field, each holding the string the write door stores for a number or a
 * boolean (`42` → `"42"`, `3` → `"3"`, `true` → `"true"`; #29241, #29562), in
 * the `{ name, type }` slice a driver's `syncSchema` and the engine's registry
 * both take.
 *
 * `stage` declares no `options`, the shape the write door's own option pins
 * register: a declared option code is a system identifier (a lower-case
 * letter first), so `"3"` is never one, and the write door refuses `3` on a
 * select that declares its codes. A number reaches an option field's storage
 * only where the field declares none (an object registered in code, with no
 * authoring parse) or from a row written before the rule; `"true"` /
 * `"false"` are legal codes anywhere. `FieldSchema` refuses this `stage` at
 * authoring for that reason; `code` is a legal `FieldSchema` input.
 */
export const FILTER_STRING_STORED_COMPARAND_FIELDS = {
  id: { name: 'id', type: 'text' },
  code: { name: 'code', type: 'text' },
  stage: { name: 'stage', type: 'select' },
} as const;

/** A row in the string-stored fixture — every value is the STORED string. */
export interface StringStoredComparandRow {
  id: string;
  /** text — the text family. */
  code: string;
  /** select — the option family. */
  stage: string;
}

/**
 * The fixture: one row per stored reading (a number's, `true`'s, `false`'s)
 * and one plain string, so a wrongly-widened or inverted predicate returns
 * visibly wrong ids. No `null` cell: the NULL polarity of `$ne` / `$nin` is
 * another table's subject.
 */
export const FILTER_STRING_STORED_COMPARAND_ROWS: readonly StringStoredComparandRow[] = [
  { id: '1', code: '42', stage: '3' },
  { id: '2', code: 'true', stage: 'true' },
  { id: '3', code: 'false', stage: 'false' },
  { id: '4', code: 'alpha', stage: 'open' },
] as const;

/**
 * One case: the filter as an author writes it (a number or boolean comparand),
 * the filter the engine's declared-type door hands every driver (each such
 * comparand narrowed to `String(value)` —
 * `filter-string-stored-comparand-declared-type.ts`), and the rows it matches.
 *
 * ## How the suites consume it
 *
 * - **The engine suite** (`@objectstack/objectql`, a recording driver):
 *   `engine.find` with {@link StringStoredComparandCase.filter} hands the
 *   driver exactly {@link StringStoredComparandCase.stored} (after the shared
 *   lowering), and the caller's filter is not edited.
 * - **Each driver suite**: seed {@link FILTER_STRING_STORED_COMPARAND_ROWS}
 *   and assert `parseFilterAST(c.stored())` matches {@link
 *   StringStoredComparandCase.expected} — the driver's half of the promise,
 *   with no field-aware policy of its own. Together: the number `42` matches
 *   the row written `42` on every driver path.
 */
export interface StringStoredComparandCase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /** The filter as written — a factory, so no suite can edit what another judges. */
  readonly filter: () => FilterCondition;
  /** The filter every driver receives once the engine's door has narrowed it. */
  readonly stored: () => FilterCondition;
  /** Ids of matching rows, ascending. */
  readonly expected: readonly string[];
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/**
 * The cases: a number and a boolean comparand on the text field and on the
 * option field, at the implicit slot, under `$eq` / `$ne`, and as members of
 * `$in` / `$nin` mixed with other scalars (a string member passes as written).
 */
export const FILTER_STRING_STORED_COMPARAND_CASES: readonly StringStoredComparandCase[] = [
  {
    name: 'a number on a text field — implicit equality (the card)',
    filter: () => ({ code: 42 }),
    stored: () => ({ code: '42' }),
    expected: ['1'],
    note: 'Before the door: no row on any driver, no error — the row holds the string "42".',
  },
  {
    name: 'a number on a text field — $eq',
    filter: () => ({ code: { $eq: 42 } }),
    stored: () => ({ code: { $eq: '42' } }),
    expected: ['1'],
  },
  {
    name: 'a boolean on a text field — implicit equality',
    filter: () => ({ code: true }),
    stored: () => ({ code: 'true' }),
    expected: ['2'],
  },
  {
    name: 'a number on a text field — $ne',
    filter: () => ({ code: { $ne: 42 } }),
    stored: () => ({ code: { $ne: '42' } }),
    expected: ['2', '3', '4'],
    note: 'Before the door: every row, the one written 42 included.',
  },
  {
    name: 'mixed scalars in $in on a text field — a number, a boolean and a string',
    filter: () => ({ code: { $in: [42, false, 'alpha'] } }),
    stored: () => ({ code: { $in: ['42', 'false', 'alpha'] } }),
    expected: ['1', '3', '4'],
  },
  {
    name: 'mixed scalars in $nin on a text field',
    filter: () => ({ code: { $nin: [42, true] } }),
    stored: () => ({ code: { $nin: ['42', 'true'] } }),
    expected: ['3', '4'],
  },
  {
    name: 'a number on an option field — implicit equality',
    filter: () => ({ stage: 3 }),
    stored: () => ({ stage: '3' }),
    expected: ['1'],
    note: 'Before the door: no row on any driver — the write stored the option code "3".',
  },
  {
    name: 'a boolean on an option field — $eq',
    filter: () => ({ stage: { $eq: false } }),
    stored: () => ({ stage: { $eq: 'false' } }),
    expected: ['3'],
  },
  {
    name: 'a boolean on an option field — $ne',
    filter: () => ({ stage: { $ne: true } }),
    stored: () => ({ stage: { $ne: 'true' } }),
    expected: ['1', '3', '4'],
  },
  {
    name: 'mixed scalars in $in on an option field — a number, a boolean and a string',
    filter: () => ({ stage: { $in: [3, true, 'open'] } }),
    stored: () => ({ stage: { $in: ['3', 'true', 'open'] } }),
    expected: ['1', '2', '4'],
  },
  {
    name: 'mixed scalars in $nin on an option field',
    filter: () => ({ stage: { $nin: [3, false] } }),
    stored: () => ({ stage: { $nin: ['3', 'false'] } }),
    expected: ['2', '4'],
  },
] as const;
