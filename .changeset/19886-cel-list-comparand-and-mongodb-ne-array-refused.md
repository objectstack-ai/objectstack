---
"@objectstack/formula": minor
"@objectstack/driver-mongodb": minor
"@objectstack/plugin-security": minor
"@objectstack/plugin-sharing": minor
"@objectstack/lint": minor
"@objectstack/spec": patch
---

A row-level or sharing-rule predicate comparing a field against a list with `!=` / `==` is refused at the CEL lowering instead of lowering to a filter that widens on driver-mongodb, and driver-mongodb refuses `$ne` with an array comparand (#19886).

**BREAKING** — an accept-set narrowing, shipped by `@objectstack/formula`, `@objectstack/driver-mongodb`, `@objectstack/plugin-security`, `@objectstack/plugin-sharing` and `@objectstack/lint` as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is registered under protocol major 18 as `cel-predicate-list-comparand-refused`.

Clause-②: no (narrowing)

**Security fix for RLS reads on MongoDB and RLS write checks.** A policy written `record.status != ['closed', 'archived']` (or `!(record.status == [...])`, or `!=` against a `current_user` membership set) lowered to `{ status: { $ne: [...] } }` (or `$not` around a bare-array equality). The RLS `using` clause is composed into the query after the engine's comparand-shape check, and driver-mongodb passed the shape to the server, where it selects every scalar row: the read returned the rows the policy was written to hide. A `check` written `!=` against a membership set admitted every write.

- `@objectstack/formula`: `compileCelToFilter` refuses `==` / `!=` whose comparand is a list (`unsupported`): a list literal, or a `current_user` variable that resolves to an array. The authoring shape check (`isPushdownableCel`, `isSupportedRlsExpression`) reports the literal; a resolved array is refused per request.
- `@objectstack/plugin-security`: the RLS compiler drops such a policy and fails closed when no other policy applies (`RLS_DENY_FILTER`: reads return no rows, `check` writes are refused 403). A CEL-authored `check` gets this 403; the `INVALID_FILTER` / 400 of `matchesFilterCondition` remains for a filter passed to it directly.
- `@objectstack/plugin-sharing`: a declared sharing rule with such a `condition` is skipped at bootstrap and never seeded.
- `@objectstack/lint`: the list-literal form is reported (`rls-predicate-unenforceable`, `sharing-rule-unlowerable-condition`). The RLS reference pass probes each kernel-resolved `current_user` key with its runtime type.
- `@objectstack/driver-mongodb`: `translateFilter` refuses `$ne` with an array comparand at any depth, with `INVALID_FILTER` / 400, as driver-sql and driver-memory already do.
- `@objectstack/spec`: the migration registry carries the entry.

**What to change.** "One of these values" is `record.status in ['open', 'pending']`; "none of these values" is `!(record.status in ['closed', 'archived'])`. In a raw filter, use `$in` / `$nin`. `in`, scalar `==` / `!=`, `null` and field-to-field comparisons are unchanged.

<!-- adr-0087: registered cel-predicate-list-comparand-refused -->
