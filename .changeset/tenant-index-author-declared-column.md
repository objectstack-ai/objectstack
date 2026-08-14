---
'@objectstack/objectql': patch
---

Declare the multi-tenant tenant-scope index whenever an object carries `organization_id` — whether the platform provisioned that column or the author declared it (#8459)

On a multi-tenant deployment `SecurityPlugin`'s tenant layer AND-composes `organization_id = <org>` onto essentially every read of a tenant-scoped object, and the platform declares `indexes: [{ fields: ['organization_id'] }]` so that predicate is served by an index. That declaration was gated on the column being the platform's own injected definition, byte-for-byte. An author who declared their own `organization_id` — adding a label, making it required, pointing it at their own org table — kept their column and silently lost the index on it: the deployment's hottest predicate running unindexed, reached by an additive-looking authoring move that removed a guarantee the author never knew they held. Isolation still held; it was slow, not wrong, which is why it went unreported.

The condition is lifted off the index half only. Unchanged: the platform still never overwrites an author-declared `organization_id`; an object that declares its own single-column tenant index still gets none from the platform (the opt-out for a different index shape); a single-tenant deployment still declares no tenant index at all; and an object that opts out of the tenant column (`systemFields: false`, `systemFields.tenant: false`, `tenancy.enabled: false`, `managedBy: 'better-auth'`) still gets neither column nor index. The declared column's TYPE is not inspected — a `text` org code is indexed too.

**DDL-bearing on the next `syncSchema`** for deployments that carry author-declared `organization_id` columns: the driver will create an index it did not create before. Index creation is additive and idempotent — no data migration, no column change, and re-running it is a no-op.
