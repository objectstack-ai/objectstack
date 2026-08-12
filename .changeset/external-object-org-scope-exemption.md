---
"@objectstack/objectql": patch
---

fix(objectql): stop injecting the org-scope predicate onto federated (external) objects (#7738)

`ObjectQL.buildDriverOptions` folded the caller's `ExecutionContext.tenantId`
into `DriverOptions.tenantId` for **every** object, including ADR-0015
federated ones. The SQL driver turns that into the platform's implicit tenant
wall — `(organization_id = :tenant OR organization_id IS NULL)` — so an
authenticated read of a correctly-bound external object issued

```sql
select * from `customers` where (`organization_id` = ? or `organization_id` is null)
-- bindings=["org_msoroxgurm6423gz"]
```

against a remote `customers` table whose columns are `id, created_at,
updated_at, name, email, region, lifetime_value`. On Postgres/MySQL that is a
remote SQL error. On SQLite it is worse: the quoted-identifier fallback
reinterprets the unresolvable identifier as the string literal
`'organization_id'`, both disjuncts go constant-false, and the object answers
**0 rows with HTTP 200** — a declared, correctly-bound federated object
silently reads empty, with nothing in the response to say so.

`tenantId` (and the `group`-posture `tenantIds` union) is now withheld for an
object with `external != null`, alongside the existing `tenancy.enabled: false`
exemption (ADR-0066 / #3249). Withholding it at the engine covers every driver
at the source rather than one driver's opt-out.

**Why the exemption is unconditional**, rather than conditioned on whether the
object carries an `organization_id` column: that column is the platform's own.
`applySystemFields` (`resolveInjectedSystemColumns`) injects `organization_id`
into every object it registers and has no `external` branch, and
`SqlDriver.registerExternalObject` is DDL-free by design and runs no
introspection — it computes the tenant column from the platform's field set,
never from the remote's. On a federated object the column's presence is
therefore always the injection and never evidence about the remote schema, so
there is no shape in which scoping by it is known-correct.

**What does not change.** An ordinary object still carries the wall for a
normal non-system caller, on every read door (`find`, `findOne`, `count`,
`aggregate`) and on the write-side stamp; the `group`-posture `tenantIds` union
is still threaded; and a `tenantId` a caller passes **by name** in the option
bag still wins under both exemptions — the exemption governs what the engine
folds in from the execution context, not what a caller asked for explicitly.
Tenant isolation for federated data remains the remote's and the layers above
(RBAC/RLS, the datasource binding).

Note this is the org-scope half only. The boot-ordering defect tracked
separately by #7737 is untouched, and this fix does not depend on it.
