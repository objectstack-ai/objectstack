---
"@objectstack/plugin-security": minor
"@objectstack/lint": patch
---

fix(plugin-security)!: a row-level policy whose compiled filter carries a `null` list member or a `null` ordering bound now fails closed on both clauses, so its read and its write check agree (#20212)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an enforcement change in the RLS compiler: no authorable key, spelling or stored shape moves, so a stored `sys_metadata` row needs no conversion. The two shapes were ruled at the shared comparand face with no ledger entry, because which explicit spelling matches the author's intent is an authoring decision no migration entry can perform. `os validate` already reports each such predicate (`rls-predicate-unenforceable`) with a rewrite. -->

**BREAKING**: this narrows what a row-level policy grants. A policy that returned rows on a read, or admitted a write, can now return no rows and refuse the write with 403. It ships as `minor` under the launch-window convention for accept-set narrowings.

`RLSCompiler.compileFilter` now runs the platform's two shared comparand faces (`assertListComparandShapes` and `normalizeFilterComparandTypes` from `@objectstack/spec/data`) on every compiled policy filter, for `using` and `check` alike. These are the functions the engine already runs on a caller's own `where`. It runs them before the middleware chain adds the RLS filter to that `where`, so until now a compiled policy filter reached the driver unjudged. A policy they refuse is dropped the way a policy with an unresolved `current_user` variable, or a list under `==`, is already dropped. When no other applicable policy compiles, the clause answers `RLS_DENY_FILTER` and logs one `[RLS] DENY (fail closed)` WARN with `reason: 'refused-comparand'`.

**Why.** The rulings refuse a `null` member of `$in` / `$nin` and a `null` comparand of `$gt` / `$gte` / `$lt` / `$lte` in every filter, because no two backends agree on what they match. On the RLS path they reached the backend, and the `check` clause of the same policy was evaluated in-process by another matcher. One policy then gave two answers. Measured with rows `open`, `closed` and a NULL status:

| predicate | `using` read before, SqlDriver / InMemoryDriver | `check` insert `closed` / `open` before | after, both clauses |
| --- | --- | --- | --- |
| `!(record.status in ['open', null])` | the NULL row / the `closed` row | admitted / 403 | no rows, 403 |
| `record.status in ['open', null]` | the `open` row / the `open` and NULL rows | 403 / admitted | no rows, 403 |
| `record.status > null` | no rows / no rows | 403 / 403 | no rows, 403 |
| `record.status <= null`, `record.status in [null]` | no rows / the NULL row | 403 / 403 | no rows, 403 |

On SqlDriver the first row's read hid the `closed` row that its own write check admitted. PostgreSQL answered as SQLite.

**What now answers differently.**

- A read (`find`, `findOne`, `count`) under such a policy returns no rows when no other applicable policy compiles, and logs the WARN. Beside another policy that compiles, this policy no longer contributes rows: the read returns what the other policies grant, with no WARN.
- A `check` (declared, or defaulted from `using`) refuses every insert and update it governs with the row-level CHECK denial, `403 PERMISSION_DENIED`, when no other applicable `check` compiles.
- `explain` reports the RLS layer as `denies` instead of `narrows`.
- Analytics: `getReadFilter` hands the deny sentinel to the analytics faces, which answer zero rows. They previously refused the whole query with `READ_SCOPE_COMPILE_FAILED` / 500.

**Who is affected.** A deployment whose stored policies carry one of these shapes, for example a policy saved without `os validate`. No policy in this repository does: every `using` / `check` string under `examples/` and `packages/` (outside tests) that names `null` is a null check (`== null`, `!= null`), which is unchanged.

**Fix.** Test for no value with `== null` and for a value with `!= null`. "One of these, or no value" is `record.status in ['open'] || record.status == null`. "Has a value" is `record.status != null`. `os validate` prints the rewrite for each finding.

**Unchanged.** A policy whose compiled filter the faces accept compiles to the same filter as before, with the same WARNs. A caller's own `where` carrying these shapes is still refused `INVALID_FILTER` / 400 by the engine. The null checks `record.f == null` / `record.f != null` lower to `$null` and are not refused.

`@objectstack/lint`: the `rls-predicate-unenforceable` finding for a `null` list member or `null` ordering bound now says what the runtime does: the policy is dropped on every request, with the clause's own fail-closed consequence. It used to say the policy survived and the backend answered.
