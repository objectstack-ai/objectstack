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
 * ## Why this module lives in `@objectstack/metadata-core` and not in `objectql`
 *
 * Same story as the twin, and the same answer — see the corresponding section of
 * `engine-delete-dispatch.ts` for the measured turbo cycle that forced it. In
 * short: `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so
 * that package's thirteen fake engines could not import this predicate without
 * closing a dependency cycle; `@objectstack/metadata-core` is a package **both**
 * already depend on and which does not depend on `objectql`, so sinking the two
 * dispatch modules here (objectstack#5619) is the one route that pins those
 * doubles without inventing an edge. A **move**, not a rewrite: the predicate
 * below is byte-for-byte the decision `ObjectQL.update` has dispatched on since
 * #5480, and `@objectstack/objectql` re-exports every symbol from its original
 * path so no caller and no public export changes.
 *
 * ## The contract, normatively
 *
 * `update(object, data, options)` dispatches on exactly one question — *does
 * this call identify a single row by primary key?* — asked of two places, in
 * this order:
 *
 *  - **`data.id`** is a **scalar** (`string` / `number` / `bigint`, not `null`)
 *    **and truthy** → `by-id`: routes to `driver.update(object, id, data, …)`.
 *  - otherwise, `options.where.id` is a **scalar** **and truthy** → `by-id`,
 *    same route.
 *  - otherwise, `options.multi` is truthy → `multi`: routes to
 *    `driver.updateMany` with the middleware-composed AST (#2982).
 *  - otherwise → **`reject`**. The call names neither one row nor a bulk
 *    intent, and the engine throws rather than rewriting every row it can see.
 *
 * **[#11009] One overriding clause on the two by-id arms:** the by-id route
 * binds ONLY the primary key, so a `where` carrying any key besides `id` is a
 * predicate the by-id path would silently discard. Such a call is never
 * dispatched `by-id`:
 *
 *  - id sourced from `where`, `multi` truthy → **`multi`** — a declared
 *    predicate call; the full `where` (scalar id included, as an equality
 *    term) rides the AST to `driver.updateMany`. The compare-and-set spelling.
 *  - anything else (no `multi`; or the id came from `data.id`, which outranks
 *    `multi` per #5748 and cannot be demoted onto the predicate path) →
 *    **`reject`**, naming the keys that would have been dropped.
 *
 * A PURE-id `where` (`{ where: { id } }`) is untouched by this clause: it
 * stays `by-id` even beside `multi: true` (LifecycleService's guarded-reap
 * idiom — pinned in the case-set below).
 *
 * **[#11142] A second overriding clause, on the PAYLOAD-sourced by-id arm:**
 * a truthy scalar `options.where.id` naming a DIFFERENT row than the bound
 * payload id is refused (`UPDATE_ID_MISMATCH`, 400) rather than silently
 * discarded. `where.id` is a declared predicate exactly like #11009's extra
 * keys — the caller wrote "update <data.id> where id = <where.id>", a
 * condition that can never hold — and the by-id path would have dropped it
 * with no diagnostic. This deliberately reverses the #5748-pinned verdict
 * (`a SCALAR data.id still wins over a scalar where.id`) for the UNEQUAL
 * shape ONLY (maintainer ruling on #11142, 2026-08-23):
 *
 *  - `data.id === where.id` stays `by-id`, untouched — the REST ingress folds
 *    the path id into the payload, so the redundant-but-agreeing spelling is
 *    a normal one (pinned below).
 *  - A FALSY scalar `where.id` (`0`, `''`) conflicts with nothing: a falsy id
 *    never identifies a row anywhere on this ladder (point 3 below), so there
 *    is no second row address to disagree with.
 *  - A NON-scalar `where.id` (`{ $in: [...] }`, an array, `null`) beside a
 *    scalar payload id keeps its #5748 verdict (`by-id`, payload wins) — that
 *    pin was not reversed, and widening over it is a separate decision, not a
 *    rider here (#6435's own boundary, one shape over).
 *
 * Three things about that list are load-bearing and easy to get wrong when
 * copying it by hand — which is the whole argument for importing it instead:
 *
 * 1. **The scalar test, on BOTH id sources.** `{ id: { $in: [...] } }` /
 *    `{ id: [...] }` / `{ id: null }` are predicates over many rows. Treating
 *    one as an id would bind the operator object literally into
 *    `driver.update(object, {$in: […]}, …)` **and** skip the #2982 row-scoping
 *    AST seeding. So they are `reject` unless the caller also said `multi` —
 *    and that holds wherever the non-scalar sits, `options.where.id` or the
 *    payload's `data.id`.
 * 2. **`data.id` outranks `where.id`, but only when it IS an id.** The payload
 *    is read first, so a scalar `data.id` still wins over `where` and over an
 *    explicit `multi: true`; `update(o, { id: 'rec_1', … }, { multi: true })`
 *    is one by-id write, unchanged. Since #11142, "wins over `where`" no
 *    longer includes silently overriding a truthy scalar `where.id` that
 *    names a DIFFERENT row — that call is refused (see the clause above);
 *    what stays is precedence, not the silent drop. What a non-scalar
 *    `data.id` no longer does
 *    is *outrank* anything: it is not an id, so the decision falls through to
 *    `where.id`, then to `multi`, then to `reject` — exactly the ladder a
 *    non-scalar `where.id` falls down. Until objectstack#5748 the payload half
 *    took `data.id` verbatim whenever it was truthy, which made the same
 *    operator object an id in `data` and a predicate in `where` — two rules
 *    for one primary key inside one method, with the payload one binding
 *    `{$in: […]}` into the primary-key position and swallowing a declared
 *    `multi: true` with no diagnostic. Now there is one rule, defined once
 *    below and reached by both halves.
 * 3. **Truthiness, not `!== undefined`.** The engine branches on
 *    `if (hookContext.input.id)`, so a falsy scalar id — `where: { id: 0 }`,
 *    `data: { id: 0 }`, `where: { id: '' }` — does **not** take the by-id
 *    route; it falls through to `multi`/`reject` like any other
 *    non-identifying call.
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
 * @see ObjectQL.update in `packages/objectql/src/engine.ts` — the only production caller.
 * @see engine-delete-dispatch.ts — the twin, and the precedent.
 * @see packages/objectql/src/engine-update-dispatch.ts — the re-export shim that keeps
 *      objectql's original import path (and its public API) working.
 * @see packages/objectql/src/engine-update-dispatch.test.ts — the test that drives the
 *      REAL engine over `ENGINE_UPDATE_DISPATCH_CASES`; it stays in objectql because it
 *      needs `ObjectQL`, which this package must never depend on.
 * @see scripts/check-engine-double-contract.mjs — the gate that keeps doubles on both.
 */

import {
  engineByIdUnhonouredPredicateMessage,
  unhonouredByIdPredicateKeys,
} from './engine-dispatch-unhonoured-predicate.js';

/** The message `update()` throws when a call identifies neither one row nor a bulk intent. */
export const ENGINE_UPDATE_REJECT_MESSAGE = 'Update requires an ID or options.multi=true';

/**
 * [#11142] The `error.code` of the conflicting-id refusal: a by-id update
 * whose truthy scalar `options.where.id` names a different row than the bound
 * payload `data.id`. Registered in the spec's `ERROR_CODE_LEDGER` (ADR-0112)
 * under `@objectstack/objectql`, the production thrower; travels with
 * {@link ENGINE_UPDATE_ID_CONFLICT_STATUS} on the thrown error's own property
 * bag (the `recordNotFoundError` convention), so the REST boundary's
 * status/code passthrough answers 400 instead of a sanitised 500.
 */
export const ENGINE_UPDATE_ID_CONFLICT_CODE = 'UPDATE_ID_MISMATCH';

/** [#11142] The HTTP status the conflicting-id refusal declares: a caller error, 400. */
export const ENGINE_UPDATE_ID_CONFLICT_STATUS = 400;

/** What `ObjectQLEngine.update` will do with a given `(data, options)` pair. */
export type EngineUpdateDispatch =
  /** A truthy scalar `data.id`, or a truthy scalar `where.id` — `driver.update`. */
  | { readonly kind: 'by-id'; readonly id: unknown }
  /** No single id but `options.multi` — `driver.updateMany` with the composed AST. */
  | { readonly kind: 'multi' }
  /**
   * Neither — the engine throws `ENGINE_UPDATE_REJECT_MESSAGE`, the #11009
   * unhonoured-predicate message, or (#11142) the conflicting-id message.
   *
   * `code`/`status` are present only when the refusal declares an ADR-0112
   * envelope of its own (today: the #11142 conflict,
   * {@link ENGINE_UPDATE_ID_CONFLICT_CODE} / 400). The #5748 / #11009
   * refusals deliberately stay undecorated — adding an envelope to them is a
   * wire-contract change this module must not make by side effect. Throwers
   * go through {@link engineUpdateDispatchRejectError} so the decoration has
   * one spelling.
   */
  | { readonly kind: 'reject'; readonly message: string; readonly code?: string; readonly status?: number };

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
 * "Is this VALUE a primary key, or a predicate over many rows?" — the one
 * scalar test, so that the two places an update can carry an id
 * (`options.where.id` and `data.id`) cannot answer it differently.
 *
 * `null`, `undefined`, arrays and operator objects (`{ $in: [...] }`,
 * `{ $ne: … }`) all yield `undefined`: they select a SET, and binding one into
 * the primary-key position of `driver.update(object, id, …)` is the #4434 /
 * #4550 failure the whole family exists to prevent.
 *
 * Not exported: callers want a verdict about a CALL, which is
 * {@link resolveEngineUpdateDispatch}, or about the `where` half, which is
 * {@link scalarUpdateId}. Adding a third public spelling of the same question
 * is how a rule with one definition grows a second one.
 */
function asScalarId(value: unknown): string | number | bigint | undefined {
  const t = typeof value;
  if (value !== null && (t === 'string' || t === 'number' || t === 'bigint')) {
    return value as string | number | bigint;
  }
  return undefined;
}

/**
 * Extract the SCALAR `where.id`, or `undefined` when the call's `where` does
 * not name one row by primary key.
 *
 * Byte-for-byte the same rule as `scalarDeleteId` — `null`, `undefined`,
 * arrays and operator objects (`{ $in: [...] }`, `{ $ne: … }`) all yield
 * `undefined`, because they are predicates over many rows.
 *
 * Note this covers only the `where` half of the update decision; a scalar
 * `data.id` outranks it (see the module header, point 2). Use
 * {@link resolveEngineUpdateDispatch} for the whole answer.
 */
export function scalarUpdateId(
  options?: EngineUpdateDispatchInput | null,
): string | number | bigint | undefined {
  const where = options?.where;
  if (!where || typeof where !== 'object') return undefined;
  if (!('id' in (where as Record<string, unknown>))) return undefined;
  return asScalarId((where as Record<string, unknown>).id);
}

/**
 * How a scalar id is quoted inside a refusal message: strings keep their
 * quotes so `'42'` (a string) and `42` (a number) stay visibly different —
 * the strict-identity conflict test below treats them as different ids, and
 * the message must let a reader see why. `JSON.stringify` is not used because
 * it throws on `bigint`.
 */
function spellScalarId(value: string | number | bigint): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/**
 * [#11142] The message a by-id update is refused with when its truthy scalar
 * `options.where.id` names a different row than the bound payload `data.id`.
 *
 * The same defect class as the #11009 refusal one clause over: a declared
 * predicate the by-id path would silently discard — here the predicate IS the
 * primary key, spelled twice with two different values, a condition that can
 * never hold. Refusing it deliberately reverses the #5748-pinned verdict for
 * the UNEQUAL shape only (maintainer ruling on #11142, 2026-08-23); the
 * equal-ids spelling (the REST ingress folds the path id into the payload)
 * stays honoured.
 */
export function engineUpdateIdConflictMessage(
  payloadId: string | number | bigint,
  whereId: string | number | bigint,
): string {
  return (
    `Update binds the payload id ${spellScalarId(payloadId)} as the row address, but options.where.id ` +
    `names a DIFFERENT row: ${spellScalarId(whereId)}. The by-id path binds ONLY one primary key — the ` +
    `losing spelling is never evaluated — so the write would land on ${spellScalarId(payloadId)} with the ` +
    `where.id condition silently ignored (#11142). Two ids are the same row only when they are identical, ` +
    `type included. If both spellings mean one row, make them equal; otherwise drop one: ` +
    `update(object, { id, ...fields }) addresses the row by the payload id, and ` +
    `update(object, fields, { where: { id } }) — with no id in the payload — addresses it by where.id.`
  );
}

/**
 * The one spelling of "throw a `reject` verdict" (#11142) — used by
 * {@link assertEngineUpdateDispatch} and by `ObjectQL.update` itself, so a
 * pinned fake's refusal carries exactly the envelope the real engine's does.
 * Rejects without a declared `code`/`status` (the #5748 / #11009 family) stay
 * plain `Error`s, byte-identical to what both threw before this helper.
 */
export function engineUpdateDispatchRejectError(
  reject: Extract<EngineUpdateDispatch, { kind: 'reject' }>,
): Error {
  const err = new Error(reject.message) as Error & { code?: string; status?: number };
  if (reject.code !== undefined) err.code = reject.code;
  if (reject.status !== undefined) err.status = reject.status;
  return err;
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
  // The payload is still read FIRST and still outranks `where` — but it only
  // outranks with an actual id. `data.id` goes through the same scalar test as
  // `where.id` (objectstack#5748), so an operator object / array / `null`
  // parked in the payload is not an id and does not shadow the ladder below
  // it. `data.id` stays UNGUARDED so a missing payload is the producer's
  // `TypeError`, not a kinder verdict.
  const payloadId = asScalarId(data.id);
  let id: unknown = payloadId;
  if (!id) {
    const fromWhere = scalarUpdateId(options);
    if (fromWhere !== undefined) id = fromWhere;
  }
  // The engine branches on `if (hookContext.input.id)` — truthiness, so a
  // falsy scalar id is not an identifying call. See header point 3.
  if (id) {
    // [#11009] A `where` carrying more than the primary key is a REAL
    // predicate, and the by-id path does not evaluate predicates — it binds
    // only the id, so every extra key used to be silently discarded (a
    // compare-and-set guard that evaluated to nothing). Two honest verdicts
    // replace that silent drop:
    //
    //  - the caller ALSO declared `multi: true`, and the id came from `where`
    //    → `multi`: a declared predicate call, routed to the predicate path
    //    where `applyFilters` compiles every key (a scalar `where.id` is an
    //    ordinary equality term there). This is the compare-and-set spelling.
    //    ⚠️ A PURE-id `where` (`{ where: { id } }`) never reaches this branch
    //    and stays by-id even under `multi: true` — LifecycleService's guarded
    //    reap depends on that for per-record cascade handling.
    //  - otherwise → `reject`, loudly naming the keys the by-id path would
    //    have dropped. A truthy scalar `data.id` lands here even with
    //    `multi: true`: the payload id outranks `multi` (#5748), and silently
    //    demoting the row address into a bulk write would be the same class
    //    of dropped declaration this refusal exists to prevent.
    const unhonoured = unhonouredByIdPredicateKeys(options?.where);
    if (unhonoured.length > 0) {
      if (!payloadId && options?.multi) return { kind: 'multi' };
      return {
        kind: 'reject',
        message: engineByIdUnhonouredPredicateMessage('Update', unhonoured),
      };
    }
    // [#11142] The payload id won the ladder, and `where.id` — the only
    // `where` key left after the #11009 check above — is itself a truthy
    // scalar naming a DIFFERENT row. That is a predicate the by-id path would
    // silently discard, exactly like #11009's extra keys: "update <payload id>
    // where id = <where.id>" can never hold, and the write used to land on the
    // payload row with no diagnostic (the #5748-pinned verdict, reversed for
    // this UNEQUAL shape only by the maintainer ruling on #11142). Strict
    // identity on purpose: `42` and `'42'` are two ids until the caller says
    // otherwise, and a coercing comparison here would be the lenient-consumer
    // move Prime Directive #12 forbids. A declared `multi: true` cannot
    // rescue the call — the payload id outranks `multi` (#5748), so the
    // conflict stands wherever the flag sits. Falsy and non-scalar `where.id`
    // shapes never reach this check with a conflict verdict: a falsy scalar
    // identifies no row (header point 3), and a non-scalar keeps its #5748
    // by-id verdict (widening over it is a separate decision).
    if (payloadId) {
      const conflictingWhereId = scalarUpdateId(options);
      if (conflictingWhereId && conflictingWhereId !== payloadId) {
        return {
          kind: 'reject',
          message: engineUpdateIdConflictMessage(payloadId, conflictingWhereId),
          code: ENGINE_UPDATE_ID_CONFLICT_CODE,
          status: ENGINE_UPDATE_ID_CONFLICT_STATUS,
        };
      }
    }
    return { kind: 'by-id', id };
  }
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
  // [#11142] Through the shared helper, so a refusal that declares an
  // ADR-0112 `code`/`status` (the conflicting-id reject) carries it here
  // exactly as it does from the real engine; undecorated rejects throw the
  // same plain `Error` they always have.
  if (dispatch.kind === 'reject') throw engineUpdateDispatchRejectError(dispatch);
  return dispatch;
}

/**
 * The shared conformance case-set for the update dispatch — the same role
 * `ENGINE_DELETE_DISPATCH_CASES` plays for `delete`, and the same role
 * `packages/spec/src/data/*-conformance.ts` plays for drivers.
 *
 * Every case names a call shape and the verdict the **real engine** gives it.
 * A double proved against these is proved against the producer, including the
 * shapes that look like an id and are not — in `where` and, since
 * objectstack#5748, in the payload too.
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
  /**
   * For a `by-id` case, the value that must land in the PRIMARY-KEY position
   * of `driver.update(object, id, …)`.
   *
   * `expect` alone cannot separate "picked the right id" from "picked an id":
   * a payload carrying `{ id: { $in: […] } }` beside a scalar `where.id`
   * dispatches `by-id` under both the old rule and the new one, and only the
   * bound value says which id source won — the operator object (#5748's bug)
   * or the scalar (#5748's fix). Optional: omit it when the case's id source
   * is unambiguous.
   */
  readonly expectId?: unknown;
}

export const ENGINE_UPDATE_DISPATCH_CASES: readonly EngineUpdateDispatchCase[] = [
  // ── by-id via `where`.
  { what: 'scalar string where.id', data: { title: 'x' }, options: { where: { id: 'rec_1' } }, expect: 'by-id' },
  { what: 'scalar number where.id', data: { title: 'x' }, options: { where: { id: 42 } }, expect: 'by-id' },
  // [#11009] A PURE-id `where` stays by-id even under a declared `multi` —
  // there is no predicate the by-id path could drop, and LifecycleService's
  // guarded reap relies on this shape taking the per-record path.
  { what: 'scalar where.id with multi:true and NOTHING else in where — still one by-id write (#11009)', data: { title: 'x' }, options: { where: { id: 'rec_1' }, multi: true }, expect: 'by-id', expectId: 'rec_1' },
  // ── by-id via the PAYLOAD. A SCALAR `data.id` still outranks `where` and
  //    `multi` alike — that is the common, legal `update(o, { id, …fields })`
  //    spelling and objectstack#5748 left it exactly as it was.
  { what: 'id carried in the data payload, no where at all', data: { id: 'rec_1', title: 'x' }, options: undefined, expect: 'by-id', expectId: 'rec_1' },
  { what: 'a SCALAR data.id still wins over an explicit multi:true', data: { id: 'rec_1', title: 'x' }, options: { multi: true }, expect: 'by-id', expectId: 'rec_1' },
  // [#11142] The REVERSED #5748 pin. This row read
  // `expect: 'by-id', expectId: 'rec_1'` from #5748 until the maintainer
  // ruling on #11142 (2026-08-23) flipped the UNEQUAL shape to a refusal: a
  // truthy scalar `where.id` naming a different row than the payload id is a
  // predicate the by-id path would silently discard — the last silent member
  // of the #5748/#11009 dropped-declaration family. The pin flips, it does
  // not disappear; the EQUAL spelling keeps its own passing pin right below.
  { what: 'a SCALAR data.id beside a DIFFERENT scalar where.id — refused, no longer silently wins (#11142 reverses the #5748 pin for the unequal shape)', data: { id: 'rec_1', title: 'x' }, options: { where: { id: 'rec_2' } }, expect: 'reject' },
  // [#11142] The equal-ids spelling stays honoured: the REST ingress folds
  // the path id into the payload (`{ ...data, id: request.id }` beside
  // `where: { id: request.id }`), so redundant-but-agreeing is a NORMAL
  // spelling, not a conflict.
  { what: 'data.id === where.id — the redundant-but-agreeing spelling (REST folds the path id into the payload) stays by-id (#11142)', data: { id: 'rec_1', title: 'x' }, options: { where: { id: 'rec_1' } }, expect: 'by-id', expectId: 'rec_1' },
  // [#11142] `multi: true` cannot rescue the conflict: the payload id outranks
  // `multi` (#5748), so the call is still a by-id write carrying a where.id it
  // can never honour.
  { what: 'a SCALAR data.id beside a DIFFERENT scalar where.id and multi:true — still refused, the payload id outranks multi (#11142)', data: { id: 'rec_1', title: 'x' }, options: { where: { id: 'rec_2' }, multi: true }, expect: 'reject' },
  // ── The payload's scalar test (objectstack#5748). A non-scalar `data.id`
  //    names no row, so it stops shadowing everything under it: the decision
  //    falls through to `where.id`, then `multi`, then `reject`. Before #5748
  //    each of these dispatched `by-id` with the operator object itself bound
  //    into `driver.update`'s primary-key position.
  { what: 'operator object in data.id, scalar where.id — the WHERE id wins, the operator is not one', data: { id: { $in: ['a', 'b'] }, title: 'x' }, options: { where: { id: 'rec_1' } }, expect: 'by-id', expectId: 'rec_1' },
  // ── multi.
  { what: 'multi with a predicate', data: { title: 'x' }, options: { where: { tenant: 't1' }, multi: true }, expect: 'multi' },
  { what: 'multi with no predicate at all', data: { title: 'x' }, options: { multi: true }, expect: 'multi' },
  { what: 'multi alongside an $in id set', data: { title: 'x' }, options: { where: { id: { $in: ['a', 'b'] } }, multi: true }, expect: 'multi' },
  // [#11009] The compare-and-set spelling: a scalar `where.id` beside real
  // predicate keys WITH a declared `multi` is a predicate call — every key
  // (the id included, as an equality term) rides the AST to
  // `driver.updateMany`, so the declared condition is honoured in full.
  { what: 'scalar where.id + extra predicate keys + multi:true — the predicate path honours ALL of it (#11009)', data: { title: 'x' }, options: { where: { id: 'rec_1', status: 'draft' }, multi: true }, expect: 'multi' },
  { what: 'multi with a FALSY data.id (0 does not identify a row)', data: { id: 0, title: 'x' }, options: { multi: true }, expect: 'multi' },
  { what: 'operator object in data.id WITH multi:true — the declared bulk intent is honoured (#5748)', data: { id: { $in: ['a', 'b'] }, title: 'x' }, options: { multi: true }, expect: 'multi' },
  { what: 'array data.id with multi:true', data: { id: ['a', 'b'], title: 'x' }, options: { multi: true }, expect: 'multi' },
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
  // ── The typo shape #5748's B option was worried about, pinned LOUD: an
  //    operator object in the payload with NO declared bulk intent is a
  //    rejection, never a silent promotion to a bulk write.
  { what: 'operator object in data.id, NO multi — rejected, NOT silently promoted to a bulk write (#5748)', data: { id: { $in: ['a', 'b'] }, title: 'x' }, options: undefined, expect: 'reject' },
  { what: 'operator object in data.id, multi explicitly false', data: { id: { $in: ['a', 'b'] }, title: 'x' }, options: { multi: false }, expect: 'reject' },
  { what: 'array data.id, no multi', data: { id: ['a', 'b'], title: 'x' }, options: undefined, expect: 'reject' },
  { what: 'null data.id, no multi', data: { id: null, title: 'x' }, options: undefined, expect: 'reject' },
  // ── [#11009] The unhonoured-predicate refusals. Each of these used to
  //    dispatch `by-id` and silently DISCARD every `where` key other than
  //    `id` — a compare-and-set guard that evaluated to nothing, reading
  //    exactly like a working conditional write. Now they are loud: the
  //    refusal names the dropped keys and prescribes the predicate path
  //    (`multi: true`), which honours the full `where`.
  { what: 'scalar where.id alongside other predicates, NO multi — the guard would be silently dropped (#11009)', data: { title: 'x' }, options: { where: { id: 'rec_1', tenant: 't1' } }, expect: 'reject' },
  { what: 'scalar where.id + a CAS operator predicate, multi explicitly false (#11009 — the redeliver shape)', data: { title: 'x' }, options: { where: { id: 'rec_1', status: { $in: ['done'] } }, multi: false }, expect: 'reject' },
  { what: 'scalar data.id + extra where predicate, no multi — same drop through the payload door (#11009)', data: { id: 'rec_1', title: 'x' }, options: { where: { tenant: 't1' } }, expect: 'reject' },
  // The payload id outranks `multi` (#5748), so a declared `multi: true`
  // cannot re-route it onto the predicate path — and the unhonourable
  // predicate is REFUSED rather than silently dropped (the pre-#11009
  // behaviour) or silently promoted to a bulk write.
  { what: 'scalar data.id + extra where predicate + multi:true — refused, the payload id cannot take the predicate path (#11009)', data: { id: 'rec_1', title: 'x' }, options: { where: { tenant: 't1' }, multi: true }, expect: 'reject' },
];
