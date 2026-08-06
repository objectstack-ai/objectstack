// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **one** answer to "what does `ObjectQLEngine.update` do with this call?"
 * — the twin of `engine-delete-dispatch.ts`, extracted for the same reason and
 * on the same terms (objectstack#5480, from objectstack#4550 / objectstack#4434).
 *
 * ## Why this exists as a module
 *
 * `delete` got its shared predicate because #4434 shipped a dead REST route
 * green: a fake engine accepted the one call shape the real `delete` refuses,
 * so the suite proved nothing about the path it was written for. `update` has
 * the *same* three-way dispatch and — until this module — none of the defence.
 * #5393 hit the asymmetry from the consumer side: writing real contract tests
 * for the flow `update_record` / `delete_record` executors, the delete half
 * could bind its fake to `assertEngineDeleteDispatch` while the update half
 * could only assert the options bag the executor hands over, "without a second
 * opinion on whether the engine would accept it" — because the only
 * alternative was hand-copying the rule into the fake, which is the failure
 * mode this family of modules exists to remove.
 *
 * A double that *imports the producer's own decision* cannot be looser than
 * the producer, ever. A hand-mirrored `if` can only stay honest until someone
 * edits one side — and the half a copy drops is always the same one:
 * `where: { id: { $in: [...] } }` looks like an id and is a multi-row
 * predicate.
 *
 * ## The contract, normatively
 *
 * `update(object, data, options)` dispatches on exactly one question — *does
 * this call identify a single row by primary key?* — asked of two places, in
 * this order:
 *
 *  - **`data.id`, taken verbatim when truthy** → `by-id`: routes to
 *    `driver.update(object, id, data, …)`.
 *  - otherwise, `options.where.id` is a **scalar** (`string` / `number` /
 *    `bigint`, not `null`) **and truthy** → `by-id`, same route.
 *  - otherwise, `options.multi` is truthy → `multi`: routes to
 *    `driver.updateMany` with the middleware-composed AST (#2982).
 *  - otherwise → **`reject`**. The call names neither one row nor a bulk
 *    intent, and the engine throws rather than rewriting every row it can see.
 *
 * Three things about that list are load-bearing and easy to get wrong when
 * copying it by hand — which is the whole argument for importing it instead:
 *
 * 1. **The `where.id` scalar test.** `{ id: { $in: [...] } }` / `{ id: [...] }`
 *    / `{ id: null }` are predicates over many rows. Treating one as an id
 *    would bind the operator object literally into `driver.update(object,
 *    {$in: […]}, …)` **and** skip the #2982 row-scoping AST seeding. So they
 *    are `reject` unless the caller also said `multi`.
 * 2. **`data.id` is NOT scalar-tested.** `ObjectQL.update` reads `data.id`
 *    first and uses it as-is whenever it is truthy, so an operator object
 *    parked there wins over everything below it — including an explicit
 *    `multi: true`. This module reports that verdict rather than quietly
 *    improving on it: a predicate that is *better* than the producer is a
 *    second opinion, which is exactly what #4550 removed. (The asymmetry
 *    itself is filed as objectstack#5748; when it is fixed, it is fixed **here
 *    and in `engine.ts` together**, which is now one edit instead of two.)
 * 3. **Truthiness, not `!== undefined`.** The engine branches on
 *    `if (hookContext.input.id)`, so a falsy scalar id — `where: { id: 0 }`,
 *    `where: { id: '' }` — does **not** take the by-id route; it falls through
 *    to `multi`/`reject` like any other non-identifying call.
 *
 * ## What the predicate deliberately does NOT model
 *
 * `engine.ts`'s bulk branch reads `options.multi && driver.updateMany`, i.e. a
 * driver with no `updateMany` turns a `multi` call into the same throw. That
 * is a *driver capability*, not a property of the call, and a double answering
 * for a fixture's own storage has no `driver.updateMany` to consult. Same
 * choice `resolveEngineDeleteDispatch` makes for `driver.deleteMany`: this
 * module classifies the CALL, and the engine keeps the capability check.
 *
 * @see ObjectQL.update in `engine.ts` — the only production caller.
 * @see engine-delete-dispatch.ts — the twin, and the precedent.
 * @see scripts/check-engine-double-contract.mjs — the gate that keeps doubles on both.
 */

/** The message `update()` throws when a call identifies neither one row nor a bulk intent. */
export const ENGINE_UPDATE_REJECT_MESSAGE = 'Update requires an ID or options.multi=true';

/** What `ObjectQLEngine.update` will do with a given `(data, options)` pair. */
export type EngineUpdateDispatch =
  /** A truthy `data.id`, or a truthy scalar `where.id` — `driver.update`. */
  | { readonly kind: 'by-id'; readonly id: unknown }
  /** No single id but `options.multi` — `driver.updateMany` with the composed AST. */
  | { readonly kind: 'multi' }
  /** Neither — the engine throws `ENGINE_UPDATE_REJECT_MESSAGE`. */
  | { readonly kind: 'reject'; readonly message: string };

/** The subset of `EngineUpdateOptions` the dispatch decision actually reads. */
export interface EngineUpdateDispatchInput {
  readonly where?: unknown;
  readonly multi?: unknown;
  readonly [k: string]: unknown;
}

/** The subset of the update PAYLOAD the dispatch decision reads: `id`, and nothing else. */
export interface EngineUpdateDispatchData {
  readonly id?: unknown;
  readonly [k: string]: unknown;
}

/**
 * Extract the SCALAR `where.id`, or `undefined` when the call's `where` does
 * not name one row by primary key.
 *
 * Byte-for-byte the same rule as `scalarDeleteId` — `null`, `undefined`,
 * arrays and operator objects (`{ $in: [...] }`, `{ $ne: … }`) all yield
 * `undefined`, because they are predicates over many rows.
 *
 * Note this covers only the `where` half of the update decision; `data.id`
 * outranks it and is taken verbatim (see the module header, point 2). Use
 * {@link resolveEngineUpdateDispatch} for the whole answer.
 */
export function scalarUpdateId(
  options?: EngineUpdateDispatchInput | null,
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
 * Decide what `ObjectQLEngine.update` does with `(data, options)`, without
 * doing it.
 *
 * Pure and side-effect free, so a test double can call it to *classify* a call
 * and then implement `by-id` / `multi` however its fixture stores rows — while
 * being bound to the real engine's `reject` surface for free.
 *
 * `data` is read UNGUARDED (`data.id`, no optional chaining) on purpose:
 * `ObjectQL.update` reads it that way, so `update(object, undefined)` is a
 * `TypeError` there and must be a `TypeError` here. A double that is kinder
 * than the producer about a missing payload is a double that hides the
 * producer's behaviour — the thing this module exists to prevent.
 */
export function resolveEngineUpdateDispatch(
  data: EngineUpdateDispatchData,
  options?: EngineUpdateDispatchInput | null,
): EngineUpdateDispatch {
  // `let id = data.id; if (!id && <scalar where.id>) id = whereId;` — the
  // producer's own two lines, in the producer's own order.
  let id: unknown = data.id;
  if (!id) {
    const fromWhere = scalarUpdateId(options);
    if (fromWhere !== undefined) id = fromWhere;
  }
  // The engine branches on `if (hookContext.input.id)` — truthiness, so a
  // falsy scalar id is not an identifying call. See header point 3.
  if (id) return { kind: 'by-id', id };
  if (options?.multi) return { kind: 'multi' };
  return { kind: 'reject', message: ENGINE_UPDATE_REJECT_MESSAGE };
}

/**
 * Throw exactly what `ObjectQLEngine.update` throws when a call is neither
 * `by-id` nor `multi`; return the resolved dispatch otherwise.
 *
 * This is the line a fake engine's `update` opens with. One call pins the fake
 * to the producer's rejection surface, and — unlike a mirrored `if` — it cannot
 * drift when the producer's rule changes.
 *
 * ```ts
 * async update(object: string, data: any, options?: any) {
 *   assertEngineUpdateDispatch(data, options);   // refuses what a real server refuses
 *   …
 * }
 * ```
 */
export function assertEngineUpdateDispatch(
  data: EngineUpdateDispatchData,
  options?: EngineUpdateDispatchInput | null,
): Exclude<EngineUpdateDispatch, { kind: 'reject' }> {
  const dispatch = resolveEngineUpdateDispatch(data, options);
  if (dispatch.kind === 'reject') throw new Error(dispatch.message);
  return dispatch;
}

/**
 * The shared conformance case-set for the update dispatch — the same role
 * `ENGINE_DELETE_DISPATCH_CASES` plays for `delete`, and the same role
 * `packages/spec/src/data/*-conformance.ts` plays for drivers.
 *
 * Every case names a call shape and the verdict the **real engine** gives it.
 * A double proved against these is proved against the producer, including the
 * shapes that look like an id and are not — and the one that does not look
 * like an id and is (`data.id`).
 */
export interface EngineUpdateDispatchCase {
  /** What the shape is, in the words a failure message should use. */
  readonly what: string;
  /** The payload handed to `update(object, data, options)`. */
  readonly data: EngineUpdateDispatchData;
  /** The options bag handed to `update(object, data, options)`. */
  readonly options: EngineUpdateDispatchInput | undefined;
  /** The verdict the engine gives it. */
  readonly expect: EngineUpdateDispatch['kind'];
}

export const ENGINE_UPDATE_DISPATCH_CASES: readonly EngineUpdateDispatchCase[] = [
  // ── by-id via `where`.
  { what: 'scalar string where.id', data: { title: 'x' }, options: { where: { id: 'rec_1' } }, expect: 'by-id' },
  { what: 'scalar number where.id', data: { title: 'x' }, options: { where: { id: 42 } }, expect: 'by-id' },
  { what: 'scalar where.id alongside other predicates', data: { title: 'x' }, options: { where: { id: 'rec_1', tenant: 't1' } }, expect: 'by-id' },
  // ── by-id via the PAYLOAD, which outranks `where` and `multi` alike.
  { what: 'id carried in the data payload, no where at all', data: { id: 'rec_1', title: 'x' }, options: undefined, expect: 'by-id' },
  { what: 'data.id wins over an explicit multi:true', data: { id: 'rec_1', title: 'x' }, options: { where: { tenant: 't1' }, multi: true }, expect: 'by-id' },
  // ── multi.
  { what: 'multi with a predicate', data: { title: 'x' }, options: { where: { tenant: 't1' }, multi: true }, expect: 'multi' },
  { what: 'multi with no predicate at all', data: { title: 'x' }, options: { multi: true }, expect: 'multi' },
  { what: 'multi alongside an $in id set', data: { title: 'x' }, options: { where: { id: { $in: ['a', 'b'] } }, multi: true }, expect: 'multi' },
  { what: 'multi with a FALSY data.id (0 does not identify a row)', data: { id: 0, title: 'x' }, options: { multi: true }, expect: 'multi' },
  // ── The rejects. Every one of these is a call a fake that mirrors the rule
  //    by hand tends to accept, and a running server answers 500 to.
  { what: 'predicate on a non-id column, no multi', data: { title: 'x' }, options: { where: { tenant: 't1' } }, expect: 'reject' },
  { what: '$in over ids, no multi (an operator object is NOT an id)', data: { title: 'x' }, options: { where: { id: { $in: ['a', 'b'] } } }, expect: 'reject' },
  { what: 'array id, no multi', data: { title: 'x' }, options: { where: { id: ['a', 'b'] } }, expect: 'reject' },
  { what: 'null id, no multi', data: { title: 'x' }, options: { where: { id: null } }, expect: 'reject' },
  { what: 'falsy scalar where.id (0), no multi', data: { title: 'x' }, options: { where: { id: 0 } }, expect: 'reject' },
  { what: 'empty where, no multi', data: { title: 'x' }, options: { where: {} }, expect: 'reject' },
  { what: 'no options at all', data: { title: 'x' }, options: undefined, expect: 'reject' },
  { what: 'multi explicitly false with a predicate', data: { title: 'x' }, options: { where: { tenant: 't1' }, multi: false }, expect: 'reject' },
];
