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
 *    already fetched. That one is a DECISION (#4953 item 2): making it total
 *    would mean every REST read padding out all declared columns, so it stays
 *    sparse and is documented as sparse — an author on that surface guards with
 *    `has()`, not `!= null`.
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
