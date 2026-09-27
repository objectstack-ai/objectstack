---
"@objectstack/formula": minor
"@objectstack/plugin-security": minor
"@objectstack/plugin-sharing": minor
"@objectstack/lint": minor
"@objectstack/objectql": minor
"@objectstack/spec": patch
---

A row-level or sharing-rule predicate whose comparison is handed something other than one value is refused at the CEL lowering or at the write-check evaluator, instead of admitting writes and reads it was written to refuse (#19886).

**BREAKING** — an accept-set narrowing, shipped by `@objectstack/formula`, `@objectstack/plugin-security`, `@objectstack/plugin-sharing`, `@objectstack/lint` and `@objectstack/objectql` as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is registered under protocol major 18 as `cel-predicate-one-value-comparand-refused`.

Clause-②: no (narrowing)

**Security fix for RLS write checks and reads.** Each shape below was measured through the real plugin-security on driver-sql and driver-memory:

- `!(record.status in [['closed', 'archived']])` (a list nested in an `in` list) admitted and stored every write the `check` was written to refuse, and a `using` read returned every row on driver-memory.
- `current_user.org_user_ids != 'x'` and `current_user.org_user_ids > 'a'` (a membership set on a comparison with no field) folded to "no restriction": every write admitted, every row read, on every driver.
- `record.status > ['m']` compared the list as the string `'m'`, and `record.reviewer_id > current_user` compared the whole caller object as a string; the latter admitted and stored every write.
- `record.status != record.tags`, its negation `!(record.status == record.tags)`, and the mirror `record.tags != record.status`, with `tags` a `json` field or a `multiple` lookup, admitted and stored every write.

What changes:

- `@objectstack/formula`: `compileCelToFilter` refuses, with `unsupported`, a list comparand under every comparison (the ordering operators now included, and on the constant-fold branch, whichever side), the `current_user` root or a key resolving to an object under an ordering operator, and an `in` list whose member is itself a list. The authoring shape check (`isPushdownableCel`, `isSupportedRlsExpression`) reports each literal form; a resolved value is refused per request. `matchesFilterCondition` refuses, with `INVALID_FILTER` / 400, an array under `$gt` / `$gte` / `$lt` / `$lte`, an array member of `$in` / `$nin`, and a `{ $field }` comparison (`$eq`, `$ne` or an ordering operator) whose column holds a list or an object on the record being judged, on either side. The message withholds the field, the operator and the value.
- `@objectstack/plugin-security`: the RLS compiler drops a policy the compiler refuses and fails closed when no other policy applies (`RLS_DENY_FILTER`: reads return no rows, `check` writes are refused 403, and `getReadFilter` hands the analytics read scope the deny scope). A `check` comparing a field with a list-holding column is refused 400 and stores nothing.
- `@objectstack/plugin-sharing`: a declared sharing rule with such a `condition` is skipped at bootstrap and never seeded.
- `@objectstack/lint`: the literal forms are reported as `rls-predicate-unenforceable`, and an ordering comparison against a membership set through the reference pass.
- `@objectstack/objectql`: a `having` comparison against a `{ $field }` column whose aggregated row holds a list is refused 400 where the row carries the list itself (driver-memory); driver-sql rows carry the stored JSON text and compare as before.
- `@objectstack/spec`: the migration registry carries the entry.

The stage 2a changeset's sentence that `{ $field }` references evaluate as before no longer holds for a column holding a list or an object: that comparison is now refused.

**What to change.** "One of these values" is `record.status in ['open', 'pending']`, and "none of these values" is `!(record.status in ['closed', 'archived'])`, with the list flat. An ordering takes one bound (`record.status > 'm'`); a range is two comparisons joined by `&&`. Compare against one key of the caller (`record.reviewer_id > current_user.id`). A field compared with a `json` or `multiple` field has no pushdown form: compare with a single-valued column, or move the condition into a validation rule or hook. In a raw filter, use `$in` / `$nin` with flat lists and one bound per ordering operator.

Not changed: a field compared with a `json` or `multiple` field still lowers and is not reported at authoring time, because the lowering sees the predicate's text and not the object's field types; driver-memory still answers a `{ $field }` comparison on a read without evaluating the reference.

<!-- adr-0087: registered cel-predicate-one-value-comparand-refused -->
