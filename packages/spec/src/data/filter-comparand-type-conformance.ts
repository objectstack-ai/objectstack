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
 *   This is how the frozen drivers (#5499) inherit the policy without a
 *   driver-local patch.
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
    name: 'number compiles and matches — the #7956 control cell',
    filter: () => ({ qty: { $eq: 100 } }),
    verdict: 'matches',
    expected: ['1'],
    note: 'The matrix\'s control: this row returning on every driver is what made its zeros real answers.',
  },
  {
    name: 'bigint compiles and matches — the crash cell, dead (#7872)',
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
    note: '$in/$nin members are comparands in their own right (#5234) — the door narrows each.',
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
    note: 'null IS a comparand and IS the null predicate (#6050\'s untouched half) — the door must not confuse it with undefined.',
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
    name: 'a bigint beyond ±2^53 is refused — precision loss must not answer silently',
    filter: () => ({ qty: { $eq: (BigInt(2) ** BigInt(53) + BigInt(1)) as unknown as number } }),
    verdict: 'door-refusal',
    code: 'INVALID_FILTER',
    mustMention: ['2^53', ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE],
  },
] as const;
