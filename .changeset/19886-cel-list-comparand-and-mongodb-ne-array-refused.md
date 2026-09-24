---
"@objectstack/formula": patch
"@objectstack/driver-mongodb": patch
---

A row-level or sharing-rule predicate comparing a field against a list with `!=` / `==` no longer lowers to a filter that widens on driver-mongodb, and driver-mongodb refuses `$ne` with an array comparand (#19886).

Clause-②: no

**Security fix for RLS reads on MongoDB.** A policy written `record.status != ['closed', 'archived']` (or `!(record.status == [...])`) lowered to `{ status: { $ne: [...] } }` (or `$not` around a bare-array equality). The RLS `using` clause is composed into the query after the engine's comparand-shape check, and driver-mongodb passed the shape to the server, where it selects every scalar row: the read returned the rows the policy was written to hide.

- `@objectstack/formula`: `compileCelToFilter` now refuses `==` / `!=` whose comparand is a list literal (`unsupported`). The RLS compiler drops such a policy and fails closed (`RLS_DENY_FILTER`: reads return no rows, `check` writes are refused 403). A declared sharing rule with such a `condition` is skipped at bootstrap and never seeded. The authoring shape check (`isPushdownableCel`, `isSupportedRlsExpression`) reports it.
- `@objectstack/driver-mongodb`: `translateFilter` refuses `$ne` with an array comparand at any depth, with `INVALID_FILTER` / 400, as driver-sql and driver-memory already do.

**What to change.** "One of these values" is `record.status in ['open', 'pending']`; "none of these values" is `!(record.status in ['closed', 'archived'])`. In a raw filter, use `$in` / `$nin`. `in`, scalar `==` / `!=`, `null` and field-to-field comparisons are unchanged.
