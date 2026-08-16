// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Make a record TOTAL over an object's DECLARED fields.
 *
 * Shared by the SERVER-side places that evaluate a CEL expression against "the
 * record": object-level validation predicates + field `requiredWhen` +
 * option `visibleWhen` (`validation/rule-validator.ts`, #1871 / #4649),
 * declarative hook `condition`s (`hook-wrappers.ts`, #4770), the field
 * `readonlyWhen` strips on the write path (`validation/rule-validator.ts`
 * `readonlyWhenBindings`, #4953, PR #6454), and — since #4953's services
 * half — the flow-trigger record seeded in
 * `packages/triggers/trigger-record-change/src/record-change-trigger.ts`.
 * They used to disagree — a predicate saw a total record while a hook
 * condition saw only the fields the current write happened to carry — which
 * is precisely the drift this module exists to prevent: an author cannot be
 * expected to know that the same `record.done == true` means two different
 * things depending on which surface reads it.
 *
 * The flow-trigger seam is a STRUCTURAL MIRROR of this exact function, not an
 * import of it: `trigger-record-change` keeps zero build-time dependency on
 * `@objectstack/objectql` (the same reason it re-declares `FlowTriggerBinding`
 * locally), so it carries its own copy with the identical algorithm and
 * contract — see that file's own `materializeDeclaredFields` doc comment for
 * the duplication rationale. This doc comment stays the canonical statement
 * of the RULE; the copy defers to it rather than re-deriving.
 *
 * One binding is still sparse, and by decision rather than by gap:
 *
 *  - objectui's action `visible` / `disabled` binds whatever record the client
 *    already fetched — a record-detail read, or a LIST ROW carrying only the
 *    view's `$select` projection. That one is a DECISION (#4953 item 2):
 *    making it total would mean every REST read padding out all declared
 *    columns, so it stays sparse, permanently, and is documented as sparse.
 *
 * ## The authoring guard for that sparse face (#8975)
 *
 * **`has(record.x) && record.x != null`** — before any traversal
 * (`record.x.k`), method call (`record.x.size()`), ordering (`< <= > >=`) or
 * arithmetic use of `record.x`.
 *
 * This doc comment is the CANONICAL statement of that rule. The showcase
 * fixture (`examples/app-showcase/src/ui/actions/predicate-matrix.action.ts`)
 * and the surface ledger in `packages/lint/src/validate-null-guards.ts` defer
 * to it instead of restating it — three independently worded copies of one
 * rule is how #8975 came to exist: two of them said opposite things
 * (`has()` "not `!= null`" here, "`!= null` is the portable form" there) and
 * measured, NEITHER HALF ALONE IS A GUARD on this face.
 *
 * The reason is that two failure modes are live at once. A list row can OMIT a
 * column (absent key) and can carry a projected column holding NULL, and each
 * half covers exactly one of them. Measured against the canonical
 * `@objectstack/formula` CEL engine:
 *
 * | predicate                                           | `{}` (absent)          | `{a: null}` (projected) | `{a: 5}` |
 * |:----------------------------------------------------|:-----------------------|:------------------------|:---------|
 * | `record.a != null && record.a > 1`                  | FAULT `No such key: a` | `false`                 | `true`   |
 * | `has(record.a) && record.a > 1`                     | `false`                | FAULT `no such overload: dyn(null) > int` | `true` |
 * | `has(record.a) && record.a != null && record.a > 1` | `false`                | `false`                 | `true`   |
 *
 * Only the conjunction is safe across all three bindings. Prescribing `has()`
 * on its own does not fix the face, it MIRRORS the bug: a fault here is
 * fail-closed, the action silently vanishes, and that is indistinguishable
 * from the gate having said no — so trading a null-shaped vanish for an
 * absence-shaped one buys nothing.
 *
 * One measured exception, recorded so the platform's existing predicates are
 * not misread: a bare EQUALITY against a literal never faults on a null value
 * — CEL compares heterogeneously and answers `false` — so `has(record.a) &&
 * record.a == "high"` is already safe on all three bindings without the
 * `!= null` half. The conjunction is correct on every shape, which is why it
 * is what the rule prescribes; the exception explains why the 34 authored
 * predicates that spell only `!= null` are not uniformly broken in the same
 * way (their migration is tracked in #8990, not here).
 *
 * ⛔ Not enforced by a lint rule, and that is decided rather than pending: the
 * mirror gate was evaluated and DECLINED (#8881 / PR #8979) because sparseness
 * is a property of the view's `$select` projection and of row DATA, not of the
 * metadata a linter sees.
 *
 * CEL is strict about missing keys: `record.x` on a record that does not carry
 * the key `x` aborts the whole expression with `No such key`, which is NOT the
 * same as reading `null`. Whether a key is carried is a property of the DRIVER
 * (a driver that stores only written columns returns a record missing every
 * column the write never touched), not of the data — so without this an
 * expression's evaluability depends on storage internals the author cannot
 * see.
 *
 * Scope is deliberately the object's **declared fields only**. Materialising
 * every key an expression happens to name would paper over author typos: a
 * `record.stauts` must stay unevaluable so it is reported (fail-closed for
 * validation, #4649) rather than silently read as `null` and quietly answered
 * "no violation" / "condition false".
 *
 * `undefined` counts as absent (not just a missing key): CEL treats an own key
 * holding `undefined` exactly as it treats no key at all.
 *
 * ## Only ever call this when the record's persisted state is IN HAND
 *
 * On insert there is nothing to know — absence genuinely means "no value". On
 * update it is knowable only when the prior row was actually fetched. Without
 * it, defaulting a declared field to `null` would not be materialising an
 * absent value, it would be FABRICATING one that contradicts the stored row.
 * Callers decide; this function only applies the rule.
 *
 * ## Consequence worth knowing before writing an expression
 *
 * Because a declared field is always present afterwards, `has(record.<declared
 * field>)` is uniformly TRUE (a materialised `null` is a present key holding
 * null — CEL's own rule). `has()` therefore guards against an UNDECLARED key,
 * not against an empty value; test emptiness with `record.x != null`.
 *
 * That sentence is about the TOTAL bindings this function creates — every
 * surface listed at the top. It is not in tension with the sparse-face rule
 * above: on a total record the `has()` half is a tautology and `!= null` is
 * the whole guard, while on the sparse action face the key may genuinely be
 * absent and both halves are load-bearing. Same conjunction, one half of it
 * simply free once the record is total.
 */
export function materializeDeclaredFields<T extends Record<string, unknown>>(
  record: T,
  fields: Record<string, unknown> | undefined | null,
): T {
  if (!fields || typeof fields !== 'object') return record;
  const target = record as Record<string, unknown>;
  for (const name of Object.keys(fields)) {
    if (target[name] === undefined) target[name] = null;
  }
  return record;
}
