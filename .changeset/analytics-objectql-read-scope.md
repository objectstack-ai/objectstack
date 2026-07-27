---
"@objectstack/service-analytics": patch
---

fix(analytics): ObjectQLStrategy now enforces the read scope (RLS + tenant) (#3597)

`ObjectQLStrategy` never consumed `getReadScope`, so any analytics query served by
that path ran with **no RLS or tenant predicate** — an authenticated caller
received aggregates computed over every tenant's rows.

Both belts were off at once. The strategy dropped the pre-resolved read scope, and
the engine could not compensate: the `executeAggregate` bridge passes no
`ExecutionContext`, so plugin-security's principal-less fall-open skipped its own
RLS injection. Only `NativeSQLStrategy` was ever wired for ADR-0021 D-C.

The exposure was **not** limited to exotic drivers. `NativeSQLStrategy` declines —
handing the query to this path — on any date-bucketed query
(`timeDimensions[].granularity`, the most common dashboard shape, on Postgres and
SQLite too), on `RAW_SQL_UNSUPPORTED` (in-memory driver), and on federated objects.

The scope is composed with `$and`, never by key merge, so a caller filter naming
the same field (e.g. `organization_id`) cannot displace the security predicate.

**Behaviour change to be aware of:** a query that references a **joined** object
carrying its own read scope is now REJECTED on this path rather than run
partially-scoped. `engine.aggregate`'s `where` addresses the base object, so a
per-join predicate cannot be expressed there; failing closed matches the posture
already taken by `resolveReadScopes` and `compileScopedFilterToSql`. Such a query
previously returned results that omitted the joined object's tenant predicate.
Run it on a native-SQL driver (`NativeSQLStrategy` scopes each join), or drop the
cross-object dimension/measure.

Deployments with no read-scope provider configured are unaffected — that path
stays unscoped by documented contract.
