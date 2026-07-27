---
"@objectstack/driver-mongodb": minor
"@objectstack/driver-sql": minor
"@objectstack/spec": minor
---

fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

`unique: true` became a **single-column global index that ignored `tenancy`
entirely**, while the autonumber sequence table is keyed by
`(object, tenant_id, field, scope)` and hands every tenant its own counter
starting at 1. Two subsystems of the same platform contradicted each other:
tenant B's `PROD-00001` was rejected by an index it could not see — **no user
did anything wrong**, the platform's left hand refused what its right hand
issued.

The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
violation told tenant B that some *other* tenant held the value, enumerable by
probing emails / codes / names.

**The contract now:**

| Declaration | Materializes as |
|---|---|
| `unique: true` + tenant column | composite `(tenantField, field)` — unique **within** the tenant |
| `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before |
| `unique: 'global'` | single-column, always platform-wide |

The tenant column comes first in the composite, so the index also serves the
`WHERE tenant = ?` prefix scans every tenant-scoped read issues.

**Declared `indexes[]` are deliberately unchanged.** They are materialized over
exactly the columns listed — no tenant column is injected. The author already
spells them out, per-tenant ones have always been written explicitly
(`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
(a DNS hostname, a reserved slug, an external provider id). `'global'` is
accepted there as a synonym of `true` so one vocabulary covers both spellings.

**Migration is automatic and cannot fail.** Legacy indexes
(`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
path) are retired inline at schema-sync time. The old global constraint is
strictly stronger than the new per-tenant one, so existing rows satisfy the
replacement by construction — no dedup, no cleanup, no data touched. It
converges at sync rather than waiting for a deliberate `os migrate` run because
a deployment that never ran migrate would otherwise stay broken.

**Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
constraint is now per tenant. Anything that must stay platform-wide has to say
so:

```ts
hostname: Field.text({ unique: 'global' })   // no two tenants may claim it
```

Note the reach: `applySystemFields` injects `organization_id` into every
registered object unless it opts out, and the driver falls back to that column
when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
provider ids (Stripe customer/subscription), device identities.

Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
`DROP INDEX` alone would have made the migration a no-op on exactly the
deployments that matter most.

`@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
indexes: it implements no row-level tenancy at all (no tenant predicate on read,
no tenant stamp on write), so a `(tenant, field)` index would advertise an
isolation it does not deliver. Tracked separately.
