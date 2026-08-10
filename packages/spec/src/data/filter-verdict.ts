// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5659] The Filter Protocol's **boolean identity reduction** — what a filter
 * node is worth before any backend translates it.
 *
 * ## Why this is here and not in each backend
 *
 * `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
 * disjunct that absorbs its `$or`, and `{ $not: {} }` is FALSE. Those four
 * answers are a RULING (#5322/#5134), pinned for every backend by the four
 * identity cases in {@link FILTER_LOGIC_CASES} — and until this module existed
 * the ruling was implemented four times over: `reduceFilterNode` in
 * `driver-sql`, the same function again in `driver-mongodb`, the
 * `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and — nearly
 * — a fifth hand-written copy inside `@objectstack/lint`, which
 * `lint-flow-patterns.ts` declined to write and filed instead:
 *
 *   > Deciding which is which requires the identity REDUCTION, and that
 *   > reduction already exists three times […]. Hand-writing a fourth copy
 *   > inside a linter is how the scan and the validator come to answer with two
 *   > different predicates.
 *
 * One concept, one implementation. A backend that needs the verdict asks for it
 * here; the answer cannot drift from the table that proves it, because
 * `filter-verdict.test.ts` drives {@link FILTER_LOGIC_CASES} through this very
 * function and asserts that a `'true'` verdict means the case expects EVERY
 * fixture row and a `'false'` verdict means it expects none.
 *
 * ## What this deliberately is NOT
 *
 * It is not a validator, and it never throws on its own. Each backend refuses a
 * different set of shapes with its own error envelope and its own wording — the
 * `$`-prefixed unknown combinator and the `undefined` comparand in `driver-sql`,
 * the query-level keys and the `$null` comparand in `driver-mongodb`, nothing at
 * all in a linter that must survive metadata the schema has not accepted yet.
 * Those refusals are supplied as {@link FilterVerdictHooks} and are invoked from
 * exactly the positions the drivers already invoked them from, so folding the
 * shared algebra in changes no message, no code, no status.
 *
 * The hooks are also why this is a walk and not a predicate over a pre-validated
 * tree: the drivers' refusals must fire on EVERY node, including nodes an
 * identity would otherwise let the emitter skip. So the reduction does not
 * short-circuit — a `$or: []` sibling must not stop the walk from reaching, and
 * refusing, a malformed node further along, or the shape gate becomes
 * conditional on key order.
 *
 * ## Hookless defaults are conservative, never optimistic
 *
 * With no hooks (the linter's use), every shape this module cannot reduce
 * answers `'clause'` — a non-array `$and`, a non-plain-object element, a
 * `$not` operand that is not a node. `'clause'` means "carries a real
 * predicate", i.e. the caller learns nothing and must not conclude "matches
 * everything". Answering `'true'` for an unreducible shape is the one direction
 * that turns garbage into a match-all, which is the failure #5239 named when it
 * put the non-node refusal in front of MongoDB's identity reduction.
 *
 * @see FILTER_LOGIC_CASES — the standard this reduction is proven against.
 */

/**
 * What a filter node is worth as a boolean, before any backend emits anything.
 *
 * - `'true'`  — matches every row; a compiler emits no clause for it.
 * - `'false'` — matches no row; a compiler emits its dialect's FALSE constant.
 * - `'clause'` — carries at least one real predicate; compile it normally.
 */
export type FilterVerdict = 'true' | 'false' | 'clause';

/**
 * The per-backend refusals, invoked from the positions the reduction walks.
 *
 * Every hook may throw — that is their whole purpose — and a hook that returns
 * normally leaves the reduction's own defaults in charge. Omitting all three
 * gives the pure predicate described in this module's header.
 */
export interface FilterVerdictHooks {
  /**
   * The operand of `$and` / `$or`, before it is iterated. `driver-sql` and
   * `driver-mongodb` refuse a non-array here rather than coercing it; a caller
   * with no hook gets `'clause'` for the same shape.
   */
  assertNodeList?: (value: unknown, key: string, path: string) => void;
  /**
   * One element of a `$and` / `$or` list, or the operand of `$not`, before it
   * is reduced. This is the gate that gives "this group reduced to empty"
   * exactly one cause (#5239): without it a `Date` — an object that enumerates
   * to nothing — would read as the empty conjunction, i.e. TRUE.
   */
  assertNode?: (value: unknown, path: string) => void;
  /**
   * The verdict of a key that is NOT one of the three declared combinators.
   * Defaults to `'clause'`: a field key always contributes a predicate.
   *
   * Backends override it to refuse (an unknown `$`-prefixed combinator, an
   * empty field constraint, an `undefined` comparand) or to classify
   * (`driver-mongodb`'s query-level keys carry no predicate, so they answer
   * `'true'` and the verdict cannot disagree with the emitter that skips them).
   */
  classifyKey?: (key: string, value: unknown, path: string) => FilterVerdict;
}

/** {@link FilterVerdictHooks} plus the path prefix used in hook messages. */
export interface FilterVerdictOptions extends FilterVerdictHooks {
  /** Prefix for the paths handed to the hooks. Defaults to `''`. */
  path?: string;
}

/**
 * Is `value` a Filter Protocol NODE — the shape `FilterConditionSchema`
 * declares for every element of `$and`/`$or` and for the operand of `$not`?
 *
 * The prototype check is the load-bearing half. The reduction turns "this node
 * has no predicates" into "matches every row", so any object whose own
 * enumerable keys are empty reads as TRUE. A `Date`, a `RegExp`, a `Map` or a
 * class instance all satisfy `typeof x === 'object' && !Array.isArray(x)` while
 * enumerating to nothing, and reading one as TRUE would promote garbage to
 * match-all. A filter condition always arrives as JSON or as a compiler's
 * output, i.e. a plain object, so requiring one costs nothing real.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Reduce one filter node to its boolean verdict.
 *
 * A node is the AND of its entries, so FALSE dominates and a node with no
 * entries at all is TRUE (the empty conjunction) — which is why `{}` is a TRUE
 * disjunct inside `$or` and why `{ $not: {} }` is FALSE.
 */
export function reduceFilterVerdict(
  node: Record<string, unknown>,
  options: FilterVerdictOptions = {},
): FilterVerdict {
  return reduceNode(node, options, options.path ?? '');
}

/**
 * Reduce ONE key of a filter node to its verdict.
 *
 * Exported because both SQL and MongoDB emitters consult a single key's verdict
 * while walking a node they are already inside — `if (verdict === 'true')
 * continue` is how an emitter skips a key the reduction resolved — and a second
 * entry point is cheaper than making them rebuild a one-key object.
 */
export function reduceFilterKeyVerdict(
  key: string,
  value: unknown,
  options: FilterVerdictOptions = {},
): FilterVerdict {
  return reduceKey(key, value, options, options.path ?? '');
}

function reduceNode(
  node: Record<string, unknown>,
  hooks: FilterVerdictHooks,
  path: string,
): FilterVerdict {
  let sawFalse = false;
  let sawClause = false;
  for (const [key, value] of Object.entries(node)) {
    const verdict = reduceKey(key, value, hooks, path);
    if (verdict === 'false') sawFalse = true;
    else if (verdict === 'clause') sawClause = true;
  }
  // AND over the node's keys: FALSE dominates, then a real predicate, else TRUE.
  return sawFalse ? 'false' : sawClause ? 'clause' : 'true';
}

function reduceKey(
  key: string,
  value: unknown,
  hooks: FilterVerdictHooks,
  path: string,
): FilterVerdict {
  const here = path ? `${path}.${key}` : key;

  if (key === '$and' || key === '$or') {
    hooks.assertNodeList?.(value, key, here);
    // Hookless callers reach this line with whatever the author wrote. A
    // non-array cannot be reduced, and `'clause'` is the answer that claims
    // nothing about it.
    if (!Array.isArray(value)) return 'clause';
    let sawTrue = false;
    let sawFalse = false;
    let sawClause = false;
    value.forEach((element, index) => {
      const elementPath = `${here}[${index}]`;
      hooks.assertNode?.(element, elementPath);
      const verdict = isFilterNode(element) ? reduceNode(element, hooks, elementPath) : 'clause';
      if (verdict === 'true') sawTrue = true;
      else if (verdict === 'false') sawFalse = true;
      else sawClause = true;
    });
    // `$and: []` → no FALSE, no clause → TRUE (the AND identity).
    if (key === '$and') return sawFalse ? 'false' : sawClause ? 'clause' : 'true';
    // `$or: []` → no TRUE, no clause → FALSE (the OR identity).
    return sawTrue ? 'true' : sawClause ? 'clause' : 'false';
  }

  if (key === '$not') {
    hooks.assertNode?.(value, here);
    if (!isFilterNode(value)) return 'clause';
    const inner = reduceNode(value, hooks, here);
    // NOT TRUE ≡ FALSE — so `{ $not: {} }` matches nothing.
    return inner === 'true' ? 'false' : inner === 'false' ? 'true' : 'clause';
  }

  return hooks.classifyKey?.(key, value, here) ?? 'clause';
}
