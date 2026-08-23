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
 * This module importing nothing from outside its own package is what makes
 * that free (its one sibling import, the #11009 refusal shared with the
 * update twin, adds no package edge).
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
 *    `null`) **and truthy** → `by-id`: routes to `driver.delete`, runs
 *    cascade-delete and the by-id RLS pre-image check.
 *  - otherwise, `options.multi` is truthy → `multi`: routes to
 *    `driver.deleteMany` with the middleware-composed AST.
 *  - otherwise → **`reject`**. The call names neither one row nor a bulk
 *    intent, and the engine throws rather than guessing.
 *
 * **[#11009] One overriding clause on the by-id arm** (byte-for-byte the
 * update twin's, minus the payload door `delete` does not have): the by-id
 * route binds ONLY the primary key, so a `where` carrying any key besides
 * `id` is a predicate the by-id path would silently discard. Such a call is
 * never dispatched `by-id` — with `multi` truthy it is `multi` (the full
 * `where`, scalar id included, rides the AST to `driver.deleteMany` — the
 * compare-and-set spelling), otherwise it is `reject`, naming the dropped
 * keys. A PURE-id `where` (`{ where: { id } }`) is untouched: it stays
 * `by-id` even beside `multi: true` (LifecycleService's guarded-reap idiom).
 *
 * Two halves of that first line are load-bearing, and a hand-written double
 * drops one or the other — which is the whole argument for importing this
 * instead of copying it:
 *
 * 1. **The scalar test.** `where: { id: { $in: [...] } }` is a *multi-row
 *    predicate*, not an id. Treating it as an id would bind the operator
 *    object literally into `driver.delete(object, {$in: […]})` **and** skip
 *    both the row-scoping AST seeding (#2982) and the by-id pre-image check.
 *    So it is `reject` unless the caller also said `multi`.
 * 2. **Truthiness, not `!== undefined`.** The engine branches on
 *    `if (hookContext.input.id)`, so a falsy scalar id — `where: { id: 0 }`,
 *    `where: { id: '' }` — does **not** take the by-id route; it falls through
 *    to `multi`/`reject` like any other non-identifying call. Byte-for-byte
 *    the rule the twin states as its own point 3, and until objectstack#5747
 *    this module read `!== undefined` and answered `by-id` for both — the one
 *    input on which a double pinned to `assertEngineDeleteDispatch` was still
 *    *looser than the producer* (it accepted `delete(o, { where: { id: '' } })`
 *    while a running server answers `ENGINE_DELETE_REJECT_MESSAGE`), which is
 *    the #4434 shape this module exists to remove. `where: { id: '' }` is a
 *    reachable spelling, not a curiosity: an empty path segment or an unfilled
 *    form field passed straight through to `where.id` produces it.
 *
 *    Note this **changed the predicate, never the engine**. `resolveEngine…`
 *    is a description of `ObjectQL.delete`, and it was the description that
 *    was wrong; `delete(o, { where: { id: 0 } })` threw before this change and
 *    throws after it. Realigning the engine to the old description instead —
 *    making `{ id: 0 }` a real by-id delete — would have been a change to the
 *    producer's behaviour, and was rejected as such (objectstack#5747 option
 *    B, deliberately not taken).
 *
 * @see ObjectQL.delete in `packages/objectql/src/engine.ts` — the only production caller.
 * @see engine-update-dispatch.ts — the twin; its point 3 is this module's point 2.
 * @see packages/objectql/src/engine-delete-dispatch.ts — the re-export shim that keeps
 *      objectql's original import path (and its public API) working.
 * @see packages/objectql/src/engine-delete-dispatch.test.ts — the test that drives the
 *      REAL engine over `ENGINE_DELETE_DISPATCH_CASES`; it stays in objectql because it
 *      needs `ObjectQL`, which this package must never depend on.
 * @see scripts/check-engine-double-contract.mjs — the gate that keeps doubles on it.
 */

import {
  engineByIdUnhonouredPredicateMessage,
  unhonouredByIdPredicateKeys,
} from './engine-dispatch-unhonoured-predicate.js';

/** The message `delete()` throws when a call identifies neither one row nor a bulk intent. */
export const ENGINE_DELETE_REJECT_MESSAGE = 'Delete requires an ID or options.multi=true';

/** What `ObjectQLEngine.delete` will do with a given options bag. */
export type EngineDeleteDispatch =
  /** A TRUTHY scalar `where.id` — `driver.delete`, cascade + by-id RLS pre-image. */
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
 * Extract the SCALAR `where.id`, or `undefined` when `where` carries no scalar
 * there at all.
 *
 * `null`, `undefined`, arrays, and operator objects (`{ $in: [...] }`,
 * `{ $ne: … }`) all yield `undefined` — they are predicates over many rows, not
 * a primary key.
 *
 * This answers only "is that VALUE a scalar?", which is **not** the whole
 * by-id question: the engine additionally requires the id to be TRUTHY, so
 * `scalarDeleteId({ where: { id: 0 } })` is `0` while the call itself
 * dispatches `multi`/`reject` (objectstack#5747). Kept value-faithful on
 * purpose — narrowing it to "truthy scalar" would make the extractor and its
 * name disagree, and a caller asking what the `where` holds would have to
 * reach for a second spelling. Use {@link resolveEngineDeleteDispatch} for the
 * verdict about a CALL; its twin `scalarUpdateId` splits the same way.
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
  // The engine branches on `if (hookContext.input.id)` — truthiness, not
  // `!== undefined`, so a falsy scalar id (`0`, `''`) is not an identifying
  // call and falls down the same ladder as a non-scalar one. See header
  // point 2, and the twin's point 3 (objectstack#5747 / objectstack#5748).
  if (id) {
    // [#11009] The by-id route binds ONLY the primary key, so a `where`
    // carrying any key besides `id` is a predicate the by-id path would
    // silently discard (the guard evaluated to nothing — the shape the update
    // twin measured on `SqlHttpOutbox.redeliver`). Byte-for-byte the twin's
    // rule, minus the payload arm `delete` does not have:
    //
    //  - `multi` truthy → `multi`: a declared predicate call; the full
    //    `where` (scalar id included, as an equality term) rides the AST to
    //    `driver.deleteMany`. The compare-and-set spelling. ⚠️ A PURE-id
    //    `where` never reaches this branch and stays by-id even under
    //    `multi: true` — LifecycleService's guarded reap depends on that for
    //    per-record cascade handling, and the predicate path deliberately
    //    trades cascade for an honoured predicate.
    //  - otherwise → `reject`, loudly naming the keys that would have been
    //    dropped.
    const unhonoured = unhonouredByIdPredicateKeys(options?.where);
    if (unhonoured.length > 0) {
      if (options?.multi) return { kind: 'multi' };
      return {
        kind: 'reject',
        message: engineByIdUnhonouredPredicateMessage('Delete', unhonoured),
      };
    }
    return { kind: 'by-id', id };
  }
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
  // [#11009] A PURE-id `where` stays by-id even under a declared `multi` —
  // there is no predicate the by-id path could drop, and LifecycleService's
  // guarded reap relies on this shape for per-record cascade handling
  // (`engine-data-events.test.ts` pins the event contract of the same shape).
  { what: 'scalar where.id with multi:true and NOTHING else in where — still one by-id delete (#11009)', options: { where: { id: 'rec_1' }, multi: true }, expect: 'by-id' },
  { what: 'multi with a predicate', options: { where: { rule_id: 'r1' }, multi: true }, expect: 'multi' },
  { what: 'multi with no predicate at all', options: { multi: true }, expect: 'multi' },
  { what: 'multi alongside an $in id set', options: { where: { id: { $in: ['a', 'b'] } }, multi: true }, expect: 'multi' },
  // [#11009] The compare-and-set spelling: a scalar `where.id` beside real
  // predicate keys WITH a declared `multi` is a predicate call — every key
  // rides the AST to `driver.deleteMany`, so the condition is honoured.
  { what: 'scalar where.id + extra predicate keys + multi:true — the predicate path honours ALL of it (#11009)', options: { where: { id: 'rec_1', status: 'stale' }, multi: true }, expect: 'multi' },
  // ── The FALSY scalars (objectstack#5747). `0` and `''` are scalars, so
  //    `scalarDeleteId` returns them — but the engine's `if (input.id)` is a
  //    truthiness test, so neither identifies a row. With a declared bulk
  //    intent they are honoured as `multi` (the caller's `where` still rides
  //    onto the AST, so the predicate is `id = 0` / `id = ''`, not "every
  //    row"); without one they are `reject`, below. Same pair the twin pins
  //    on the update side.
  { what: 'falsy scalar where.id (0) with multi:true', options: { where: { id: 0 }, multi: true }, expect: 'multi' },
  { what: "falsy scalar where.id ('') with multi:true", options: { where: { id: '' }, multi: true }, expect: 'multi' },
  // ── The rejects. Everything below is what #4434 shipped against a fake that
  //    accepted it, and what a running server answers 500 to.
  { what: 'predicate on a non-id column, no multi', options: { where: { rule_id: 'r1' } }, expect: 'reject' },
  { what: '$in over ids, no multi (an operator object is NOT an id)', options: { where: { id: { $in: ['a', 'b'] } } }, expect: 'reject' },
  { what: 'array id, no multi', options: { where: { id: ['a', 'b'] } }, expect: 'reject' },
  { what: 'null id, no multi', options: { where: { id: null } }, expect: 'reject' },
  // The two shapes objectstack#5747 was filed for: a fake pinned to
  // `assertEngineDeleteDispatch` ACCEPTED both until this case-set could
  // reach them (#4868 family — a per-case parity run cannot contradict an
  // input nobody listed).
  { what: 'falsy scalar where.id (0), no multi', options: { where: { id: 0 } }, expect: 'reject' },
  { what: "falsy scalar where.id (''), no multi — the empty path segment / unfilled form field", options: { where: { id: '' } }, expect: 'reject' },
  { what: 'empty where, no multi', options: { where: {} }, expect: 'reject' },
  { what: 'no options at all', options: undefined, expect: 'reject' },
  { what: 'multi explicitly false with a predicate', options: { where: { rule_id: 'r1' }, multi: false }, expect: 'reject' },
  // ── [#11009] The unhonoured-predicate refusals — the delete twin of the
  //    update-side cases. Each used to dispatch `by-id` and silently DISCARD
  //    every `where` key other than `id`; now the refusal names the dropped
  //    keys and prescribes the predicate path (`multi: true`).
  { what: 'scalar where.id alongside other predicates, NO multi — the guard would be silently dropped (#11009)', options: { where: { id: 'rec_1', tenant: 't1' } }, expect: 'reject' },
  { what: 'scalar where.id + a CAS operator predicate, multi explicitly false (#11009)', options: { where: { id: 'rec_1', status: { $in: ['done'] } }, multi: false }, expect: 'reject' },
];
