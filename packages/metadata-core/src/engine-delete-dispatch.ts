// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **one** answer to "what does `ObjectQLEngine.delete` do with this call?"
 * — extracted so that the engine and every test double that stands in for it
 * read the same predicate rather than two hand-written approximations of it
 * (objectstack#4550, from objectstack#4434).
 *
 * ## Why this is a shared module and not four lines inside `engine.ts`
 *
 * `#4434` shipped green. `DELETE /api/v1/sharing/rules/:idOrName` answered 500
 * for **both** address forms the route advertises, for every rule, from the day
 * it was written — and `plugin-sharing`'s `deleteRule drops rule + all its
 * grants` test asserted success against it the whole time. The route was not
 * untested; it was tested against a **fake engine whose `delete` accepted a
 * call the real engine refuses**. A predicate-shaped purge of
 * `sys_record_share` (no scalar `where.id`, no `options.multi`) is precisely
 * the one shape `delete()` throws on, and the fake happily deleted by
 * predicate.
 *
 * The fix for #4434 mirrored the guard into that fake by hand. That closes one
 * fake and starts a second copy of the contract — the failure mode this module
 * exists to remove. A double that *imports the producer's own decision* cannot
 * be looser than the producer, ever, which is the property the gate wants and
 * the property a copy can only have until someone edits one side.
 *
 * Same reasoning as `packages/spec/src/data/*-conformance.ts` for drivers, and
 * the same shape as objectstack#4455: **the scan and the validator must answer
 * with one predicate.**
 *
 * ## Why this module lives in `@objectstack/metadata-core` and not in `objectql`
 *
 * It was written in `packages/objectql/src/` next to its only production caller
 * (objectstack#4550) and moved here unchanged by objectstack#5619 — a **move**,
 * not a rewrite: not one line of the predicate below differs from the version
 * `ObjectQL.delete` has been dispatching on since #4550.
 *
 * The move is what made a whole package's doubles pinnable. Thirteen fake
 * engines in `@objectstack/metadata-protocol` were structurally unable to reach
 * this predicate: `@objectstack/objectql` **depends on**
 * `@objectstack/metadata-protocol`, so the import a pin needs would have closed
 * a cycle — measured, not assumed, on turbo 2.10.7:
 *
 * ```
 *  WARNING  Circular package dependency detected: @objectstack/objectql, @objectstack/metadata-protocol
 *   x Cyclic dependency detected:
 *   | 	@objectstack/objectql#build, @objectstack/metadata-protocol#build
 * ```
 *
 * When a reverse import is impossible, the only honest way out is to sink the
 * predicate into a package **both sides already depend on** — the criterion
 * `packages/spec/src/contracts/data-engine.test.ts`'s EXEMPT entry in the gate's
 * ledger states. `@objectstack/metadata-core` is exactly that package:
 * `objectql -> metadata-core` and `metadata-protocol -> metadata-core` both
 * pre-date this change, and this package's own dependencies are
 * `{ @objectstack/spec, zod }` — no `objectql`, so no new edge and no new cycle.
 * This module importing nothing at all is what makes that free.
 *
 * `@objectstack/objectql` re-exports every symbol below from its original path,
 * so the 24+ call sites already pinned to it, and the public API, are unchanged.
 *
 * ## The contract, normatively
 *
 * `delete(object, options)` dispatches on exactly one question — *does this
 * call identify a single row by primary key?*
 *
 *  - `options.where.id` is a **scalar** (`string` / `number` / `bigint`, not
 *    `null`) → `by-id`: routes to `driver.delete`, runs cascade-delete and the
 *    by-id RLS pre-image check.
 *  - otherwise, `options.multi` is truthy → `multi`: routes to
 *    `driver.deleteMany` with the middleware-composed AST.
 *  - otherwise → **`reject`**. The call names neither one row nor a bulk
 *    intent, and the engine throws rather than guessing.
 *
 * The scalar test is load-bearing and is the half a hand-written double most
 * often drops: `where: { id: { $in: [...] } }` is a *multi-row predicate*, not
 * an id. Treating it as an id would bind the operator object literally into
 * `driver.delete(object, {$in: […]})` **and** skip both the row-scoping AST
 * seeding (#2982) and the by-id pre-image check. So it is `reject` unless the
 * caller also said `multi`.
 *
 * @see ObjectQL.delete in `packages/objectql/src/engine.ts` — the only production caller.
 * @see packages/objectql/src/engine-delete-dispatch.ts — the re-export shim that keeps
 *      objectql's original import path (and its public API) working.
 * @see packages/objectql/src/engine-delete-dispatch.test.ts — the test that drives the
 *      REAL engine over `ENGINE_DELETE_DISPATCH_CASES`; it stays in objectql because it
 *      needs `ObjectQL`, which this package must never depend on.
 * @see scripts/check-engine-double-contract.mjs — the gate that keeps doubles on it.
 */

/** The message `delete()` throws when a call identifies neither one row nor a bulk intent. */
export const ENGINE_DELETE_REJECT_MESSAGE = 'Delete requires an ID or options.multi=true';

/** What `ObjectQLEngine.delete` will do with a given options bag. */
export type EngineDeleteDispatch =
  /** A scalar `where.id` — `driver.delete`, cascade + by-id RLS pre-image. */
  | { readonly kind: 'by-id'; readonly id: string | number | bigint }
  /** No single id but `options.multi` — `driver.deleteMany` with the composed AST. */
  | { readonly kind: 'multi' }
  /** Neither — the engine throws `ENGINE_DELETE_REJECT_MESSAGE`. */
  | { readonly kind: 'reject'; readonly message: string };

/** The subset of `EngineDeleteOptions` the dispatch decision actually reads. */
export interface EngineDeleteDispatchInput {
  readonly where?: unknown;
  readonly multi?: unknown;
  readonly [k: string]: unknown;
}

/**
 * Extract the SCALAR `where.id`, or `undefined` when the call does not name one
 * row by primary key.
 *
 * `null`, `undefined`, arrays, and operator objects (`{ $in: [...] }`,
 * `{ $ne: … }`) all yield `undefined` — they are predicates over many rows, not
 * a primary key.
 */
export function scalarDeleteId(
  options?: EngineDeleteDispatchInput | null,
): string | number | bigint | undefined {
  const where = options?.where;
  if (!where || typeof where !== 'object') return undefined;
  if (!('id' in (where as Record<string, unknown>))) return undefined;
  const whereId = (where as Record<string, unknown>).id;
  const t = typeof whereId;
  if (whereId !== null && (t === 'string' || t === 'number' || t === 'bigint')) {
    return whereId as string | number | bigint;
  }
  return undefined;
}

/**
 * Decide what `ObjectQLEngine.delete` does with `options`, without doing it.
 *
 * Pure and side-effect free, so a test double can call it to *classify* a call
 * and then implement `by-id` / `multi` however its fixture stores rows — while
 * being bound to the real engine's `reject` surface for free.
 */
export function resolveEngineDeleteDispatch(
  options?: EngineDeleteDispatchInput | null,
): EngineDeleteDispatch {
  const id = scalarDeleteId(options);
  if (id !== undefined) return { kind: 'by-id', id };
  if (options?.multi) return { kind: 'multi' };
  return { kind: 'reject', message: ENGINE_DELETE_REJECT_MESSAGE };
}

/**
 * Throw exactly what `ObjectQLEngine.delete` throws when a call is neither
 * `by-id` nor `multi`; return the resolved dispatch otherwise.
 *
 * This is the line a fake engine's `delete` opens with. One call pins the fake
 * to the producer's rejection surface, and — unlike a mirrored `if` — it cannot
 * drift when the producer's rule changes.
 *
 * ```ts
 * async delete(object: string, options?: any) {
 *   assertEngineDeleteDispatch(options);   // refuses what a real server refuses
 *   …
 * }
 * ```
 */
export function assertEngineDeleteDispatch(
  options?: EngineDeleteDispatchInput | null,
): Exclude<EngineDeleteDispatch, { kind: 'reject' }> {
  const dispatch = resolveEngineDeleteDispatch(options);
  if (dispatch.kind === 'reject') throw new Error(dispatch.message);
  return dispatch;
}

/**
 * The shared conformance case-set for the delete dispatch — the same role
 * `packages/spec/src/data/*-conformance.ts` plays for drivers.
 *
 * Every case names a call shape and the verdict the **real engine** gives it.
 * A double proved against these is proved against the producer, including the
 * three shapes that look like an id and are not.
 */
export interface EngineDeleteDispatchCase {
  /** What the shape is, in the words a failure message should use. */
  readonly what: string;
  /** The options bag handed to `delete(object, options)`. */
  readonly options: EngineDeleteDispatchInput | undefined;
  /** The verdict the engine gives it. */
  readonly expect: EngineDeleteDispatch['kind'];
}

export const ENGINE_DELETE_DISPATCH_CASES: readonly EngineDeleteDispatchCase[] = [
  { what: 'scalar string id', options: { where: { id: 'rec_1' } }, expect: 'by-id' },
  { what: 'scalar number id', options: { where: { id: 42 } }, expect: 'by-id' },
  { what: 'scalar id alongside other predicates', options: { where: { id: 'rec_1', tenant: 't1' } }, expect: 'by-id' },
  { what: 'multi with a predicate', options: { where: { rule_id: 'r1' }, multi: true }, expect: 'multi' },
  { what: 'multi with no predicate at all', options: { multi: true }, expect: 'multi' },
  { what: 'multi alongside an $in id set', options: { where: { id: { $in: ['a', 'b'] } }, multi: true }, expect: 'multi' },
  // ── The rejects. Everything below is what #4434 shipped against a fake that
  //    accepted it, and what a running server answers 500 to.
  { what: 'predicate on a non-id column, no multi', options: { where: { rule_id: 'r1' } }, expect: 'reject' },
  { what: '$in over ids, no multi (an operator object is NOT an id)', options: { where: { id: { $in: ['a', 'b'] } } }, expect: 'reject' },
  { what: 'array id, no multi', options: { where: { id: ['a', 'b'] } }, expect: 'reject' },
  { what: 'null id, no multi', options: { where: { id: null } }, expect: 'reject' },
  { what: 'empty where, no multi', options: { where: {} }, expect: 'reject' },
  { what: 'no options at all', options: undefined, expect: 'reject' },
  { what: 'multi explicitly false with a predicate', options: { where: { rule_id: 'r1' }, multi: false }, expect: 'reject' },
];
