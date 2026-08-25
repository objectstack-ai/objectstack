// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **one** answer to "does this `findOne` call select a particular record?"
 * — the READ-side sibling of {@link ./engine-delete-dispatch.ts} and
 * {@link ./engine-update-dispatch.ts}, extracted so that the engine and every
 * test double standing in for it read the same predicate rather than two
 * hand-written approximations of it (objectstack#11957, from objectstack#11767).
 *
 * ## The failure mode this exists for, measured rather than argued
 *
 * `ObjectQL.findOne` REFUSES a call that selects no particular record
 * (objectstack#4419): `findOne` applies `limit: 1`, so a query with no `where`
 * and no `orderBy` returns an ARBITRARY row — a real, plausible-looking record
 * unrelated to what was asked for, which no caller's null-check can catch.
 *
 * Every in-memory double in this repo instead reads an absent filter as "match
 * everything" and answers happily: `null` on an empty table, an arbitrary row
 * otherwise. So a production call site that violates #4419 reads as *working*
 * under every unit suite and only fails on a real engine.
 *
 * That is not hypothetical. `AuthManager.isBootstrapCreation` probed the
 * bootstrap population with `adapter.findOne({ model: 'user', where: [] })`
 * inside a `try/catch`. On a real engine that call throws; the
 * `catch { return false; }` read the engine's REFUSAL as the data answer "users
 * exist", so the declared first-run bypass never fired and the `invite_only`
 * default refused the operator's own dev-admin seed. Two required gates went red
 * across every shard — while a 641-line posture × creation-method matrix over
 * the in-memory double stayed green, including a case literally named
 * "bootstrap: the very first signup is admitted". A double more permissive than
 * the engine converts a production defect into a green test.
 *
 * ## Why a shared module and not four lines inside each fake
 *
 * The same argument the delete twin's header makes, and the same two halves a
 * hand-written copy drops — both of them measured on the #4419 rule itself:
 *
 * 1. **`where: []` is NOT a predicate.** It is the exact shape #11767 shipped.
 *    A copyist writing `if (!query?.where && !query?.orderBy) throw` accepts it,
 *    because an empty array is truthy. The engine lowers a `FilterArray` at
 *    every entry point and an empty one means "no filter" — this is stated in
 *    `requireFindOnePredicate`'s own header, which records that `where: []`
 *    once walked past the guard and returned an arbitrary row: "the #4419
 *    defect surviving inside #4419's own guard".
 * 2. **`where: {}` is NOT a predicate either, and `filter: {…}` IS one.** The
 *    engine reads "selects nothing" as absent / `null` / `{}` — the three
 *    shapes that mean match-every-row — and folds the `filter` alias into
 *    `where` on every entry point before the guard runs. A copy that tests
 *    `query.where != null` accepts `{}` (looser) and refuses `{ filter }`
 *    (stricter). Looser hides bugs, stricter invents them; importing the
 *    decision is the only spelling that does neither.
 *
 * ## Why this module lives in `@objectstack/metadata-core`
 *
 * Byte-for-byte the twins' reason (objectstack#5619), which is why it is not
 * re-argued here: `@objectstack/objectql` **depends on**
 * `@objectstack/metadata-protocol`, so that package's fake engines cannot
 * import from objectql at all — turbo rejects the resulting task graph
 * outright. Sinking the predicate into a package both sides already depend on
 * is the only route that pins them. This package's dependencies are
 * `{ @objectstack/spec, zod }`, so nothing here adds an edge.
 * `@objectstack/objectql` re-exports every symbol below from
 * `src/engine-findone-predicate.ts`, exactly as it does for the twins.
 *
 * ## The contract, normatively
 *
 * `findOne(object, query)` is SELECTIVE when any one of these holds, read on the
 * CALLER's own spelling (a double is handed the query before the engine folds,
 * lowers or expands anything):
 *
 *  - **`where`** — after folding the `filter` alias and lowering a `FilterArray`:
 *    a non-empty plain object, a non-empty array, or a non-object value
 *    (the engine's own `typeof where !== 'object'` arm, kept as defence in depth
 *    for a caller that reaches the engine without lowering).
 *  - **`orderBy`** — a non-empty ARRAY. "The newest", "the highest priority" is
 *    a legitimate way to be specific and every driver honours it on this path.
 *    Arrayness is load-bearing: the engine tests `Array.isArray`, so a
 *    record-form `orderBy` is not selective there and is not selective here.
 *  - **`search`** — a non-empty search, because the engine expands it into
 *    `where` BEFORE the guard and #4419's own refusal names it as one of the
 *    three ways to select ("Pass 'where' (or a 'search' that resolves to one)").
 *
 * Otherwise the call is **`reject`**, and the message is byte-identical to the
 * engine's, object name included — see {@link engineFindOnePredicateRefusalMessage}.
 *
 * ## ⛔ The two residuals, stated because a closed-sounding contract is worse
 *
 * Both are one-sided by construction — a double is not handed the object's
 * schema, so two of the engine's inputs are structurally unavailable to it.
 * Neither is a place to "improve" the predicate; changing either without
 * changing `engine.ts` re-creates the drift this module removes.
 *
 * 1. **`search` over an object with NO searchable field.** The engine's
 *    `expandSearchOnAst` produces no filter there, so `where` stays absent and
 *    the guard refuses. This predicate accepts it, because resolving searchable
 *    fields needs the registry. The alternative — refusing every `search` — is
 *    stricter than the producer on the mainline shape, which invents failures
 *    a running server does not have. Accepting is the narrower error.
 * 2. **A non-empty `where` ARRAY that is not a well-formed filter AST.** The
 *    engine refuses it too, but with `lowerWhereFilterArray`'s own louder
 *    message rather than this one. Both refuse; only the wording differs, and
 *    reproducing that lowering would mean re-implementing `parseFilterAST`
 *    here — a second copy of a different contract, which is the defect this
 *    module exists to remove.
 *
 * A third, deliberate non-claim: the wire-only spellings (`sort`, `select`,
 * `skip`, `populate`) are rejected by the engine's own entry-point guard with a
 * different message, so `sort` is NOT read as `orderBy` here. This predicate
 * answers the #4419 question and only that one, exactly as
 * `assertEngineDeleteDispatch` answers the delete dispatch and only that one.
 *
 * @see ObjectQL.findOne / `requireFindOnePredicate` in `packages/objectql/src/engine.ts` — the producer.
 * @see packages/objectql/src/engine-findone-predicate.ts — the re-export shim keeping objectql's public API.
 * @see packages/objectql/src/engine-findone-predicate.test.ts — the case-set driven against the REAL engine.
 * @see engine-delete-dispatch.ts / engine-update-dispatch.ts — the write-side twins.
 */

/**
 * The message `findOne` throws when a call selects no particular record —
 * byte-identical to `ObjectQL.requireFindOnePredicate`'s, object name included.
 *
 * A function rather than a constant because the engine's message quotes the
 * object twice, and a fake that reproduced only the prefix would let a test
 * assert on wording the producer never emits.
 */
export function engineFindOnePredicateRefusalMessage(object: string): string {
  return (
    `findOne('${object}') selects no particular record: 'where' is absent or empty ` +
    `and the query carries no 'orderBy'. findOne applies limit: 1, so this would return an ` +
    `ARBITRARY row — a real, plausible-looking record unrelated to what was asked for, which ` +
    `no caller's null-check can catch (#4419). Pass 'where' (or a 'search' that resolves to ` +
    `one) to select the record; pass 'orderBy' if you mean "the first record in THIS order"; ` +
    `or call find('${object}', { limit: 1 }) if any row will genuinely do.`
  );
}

/** What `ObjectQLEngine.findOne` will do with a given query bag. */
export type EngineFindOnePredicate =
  /** The call names a particular record; `by` says which of the three ways. */
  | { readonly kind: 'selective'; readonly by: 'where' | 'orderBy' | 'search' }
  /** It does not — the engine throws {@link engineFindOnePredicateRefusalMessage}. */
  | { readonly kind: 'reject'; readonly message: string };

/** The subset of `EngineQueryOptions` the #4419 decision actually reads. */
export interface EngineFindOneQueryInput {
  readonly where?: unknown;
  /** The alias the engine folds into `where` on every entry point (#4346). */
  readonly filter?: unknown;
  readonly orderBy?: unknown;
  readonly search?: unknown;
  readonly [k: string]: unknown;
}

/**
 * The caller's effective `where`, with the `filter` alias folded exactly as
 * `foldEngineOptionAliases` folds it: a slot is PRESENT when its value is
 * `!= null`, and the canonical spelling wins.
 *
 * An explicit `null` is a withdrawal rather than a value — the same reading
 * `foldQueryAliasSlots` gives it — so `{ where: null, filter: { a: 1 } }` folds
 * to the filter, not to nothing.
 */
function foldedWhere(query?: EngineFindOneQueryInput | null): unknown {
  if (!query) return undefined;
  if (query.where != null) return query.where;
  if (query.filter != null) return query.filter;
  return undefined;
}

/**
 * Is the caller's `where` a predicate, read the way the engine reads it after
 * `lowerWhereFilterArray`?
 *
 * The three arms are the engine's own, in its order: a `null`/absent `where` is
 * nothing; a non-object is the driver's to interpret and counts (defence in
 * depth — every entry point lowers before the guard today); an array counts
 * only when NON-EMPTY, because `[]` is "no filter" and is deleted by the
 * lowering. `{}` is the match-every-row shape and does not count.
 */
function whereIsPredicate(where: unknown): boolean {
  if (where == null) return false;
  if (typeof where !== 'object') return true;
  if (Array.isArray(where)) return where.length > 0;
  return Object.keys(where as Record<string, unknown>).length > 0;
}

/** Does `search` carry anything the engine could expand into a filter? */
function searchIsPredicate(search: unknown): boolean {
  if (search == null) return false;
  if (typeof search === 'string') return search.trim().length > 0;
  if (typeof search !== 'object') return true;
  return Object.keys(search as Record<string, unknown>).length > 0;
}

/**
 * Decide what `ObjectQLEngine.findOne` does with `query`, without doing it.
 *
 * Pure and side-effect free, so a test double can classify a call and then read
 * rows however its fixture stores them — while being bound to the real engine's
 * refusal surface for free.
 */
export function resolveEngineFindOnePredicate(
  object: string,
  query?: EngineFindOneQueryInput | null,
): EngineFindOnePredicate {
  if (whereIsPredicate(foldedWhere(query))) return { kind: 'selective', by: 'where' };
  // Search is expanded INTO `where` before the guard runs, so it is checked
  // ahead of `orderBy` for the same reason the engine checks the expanded
  // `where` first: a resolving search IS a `where` by the time #4419 looks.
  if (searchIsPredicate(query?.search)) return { kind: 'selective', by: 'search' };
  const orderBy = query?.orderBy;
  if (Array.isArray(orderBy) && orderBy.length > 0) return { kind: 'selective', by: 'orderBy' };
  return { kind: 'reject', message: engineFindOnePredicateRefusalMessage(object) };
}

/**
 * Throw exactly what `ObjectQLEngine.findOne` throws when a call selects no
 * particular record; return the resolved verdict otherwise.
 *
 * This is the line a fake engine's `findOne` opens with. One call pins the fake
 * to the producer's refusal surface, and — unlike a mirrored `if` — it cannot
 * drift when the producer's rule changes.
 *
 * ```ts
 * async findOne(object: string, query?: any) {
 *   assertEngineFindOnePredicate(object, query);   // refuses what a real server refuses
 *   …
 * }
 * ```
 */
export function assertEngineFindOnePredicate(
  object: string,
  query?: EngineFindOneQueryInput | null,
): Exclude<EngineFindOnePredicate, { kind: 'reject' }> {
  const verdict = resolveEngineFindOnePredicate(object, query);
  if (verdict.kind === 'reject') throw new Error(verdict.message);
  return verdict;
}

/**
 * The shared conformance case-set for the #4419 predicate — the same role
 * `ENGINE_DELETE_DISPATCH_CASES` plays for the delete dispatch.
 *
 * Every case names a query shape and the verdict the **real engine** gives it,
 * and `packages/objectql/src/engine-findone-predicate.test.ts` drives
 * `ObjectQL.findOne` over every row to prove the two agree. A double proved
 * against these is proved against the producer — including the shapes that look
 * like a predicate and are not.
 */
export interface EngineFindOnePredicateCase {
  /** What the shape is, in the words a failure message should use. */
  readonly what: string;
  /** The query bag handed to `findOne(object, query)`. */
  readonly query: EngineFindOneQueryInput | undefined;
  /** The verdict the engine gives it. */
  readonly expect: EngineFindOnePredicate['kind'];
}

export const ENGINE_FINDONE_PREDICATE_CASES: readonly EngineFindOnePredicateCase[] = [
  // ── Selective. Each is a shape a running server answers a row for.
  { what: 'a scalar equality predicate', query: { where: { id: 'rec_1' } }, expect: 'selective' },
  { what: 'a non-id predicate', query: { where: { status: 'open' } }, expect: 'selective' },
  { what: 'an operator predicate', query: { where: { id: { $in: ['a', 'b'] } } }, expect: 'selective' },
  // The alias the engine folds on every entry point (#4346). Before the fold,
  // `findOne({ filter })` matched the first row of the WHOLE table.
  { what: "the 'filter' alias alone — folded into 'where' before the guard (#4346)", query: { filter: { status: 'open' } }, expect: 'selective' },
  { what: "an explicit null 'where' beside a real 'filter' — null is a withdrawal, not a value", query: { where: null, filter: { status: 'open' } }, expect: 'selective' },
  // A FilterArray that is a well-formed AST lowers to a condition.
  { what: 'a non-empty FilterArray — lowered to a condition before the guard', query: { where: ['status', '=', 'open'] }, expect: 'selective' },
  { what: 'orderBy alone — "the first record in THIS order" is a real answer', query: { orderBy: [{ field: 'title', order: 'desc' }] }, expect: 'selective' },
  { what: 'orderBy beside an empty where', query: { where: {}, orderBy: [{ field: 'title', order: 'desc' }] }, expect: 'selective' },
  { what: 'a search that resolves to a filter', query: { search: 'widget' }, expect: 'selective' },
  // ── The refusals. Every one of these is a shape a double answers happily and
  //    a running server throws on — which is the whole of #11957.
  { what: 'no query at all', query: undefined, expect: 'reject' },
  { what: 'an empty query bag', query: {}, expect: 'reject' },
  { what: "an empty 'where' object — the match-every-row shape (#3896's reading)", query: { where: {} }, expect: 'reject' },
  { what: "an explicitly null 'where'", query: { where: null }, expect: 'reject' },
  // THE #11767 SHAPE. An empty FilterArray is truthy, so every hand-written
  // `if (!query?.where)` copy accepts it; the engine's lowering deletes the key
  // and the guard refuses. This one row is what the card was filed for.
  { what: "an empty FilterArray 'where: []' — truthy, and NOT a predicate (#11767)", query: { where: [] }, expect: 'reject' },
  { what: "a null 'filter' alias — a withdrawal, so nothing folds", query: { filter: null }, expect: 'reject' },
  { what: 'an empty orderBy array', query: { orderBy: [] }, expect: 'reject' },
  { what: 'a projection and a limit but nothing selective', query: { fields: ['id', 'name'], limit: 1 }, expect: 'reject' },
  { what: 'an empty search string', query: { search: '   ' }, expect: 'reject' },
];
