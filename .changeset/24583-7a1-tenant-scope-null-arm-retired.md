---
'@objectstack/driver-sql': minor
'@objectstack/objectql': minor
---

feat(driver-sql)!: a tenant-scoped read no longer answers a row with no organization; the driver's `OR organization_id IS NULL` arm is retired

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A read-scope narrowing in the SQL driver's tenant chokepoint and the lifecycle sweep's global pass: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type or error code is added, removed or renamed. The data it stops reaching is retired by the 18.x upgrade ceremony, which certifies zero organization-less rows before a database boots. -->

**BREAKING** read-scope narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D1, D14). Step 7 of the 18.x organization-ownership line: it lands after the upgrade ceremony opens.

- **Before.** `SqlDriver.applyTenantScope` compiled a tenant scope as `(organization_id = :tenant OR organization_id IS NULL)`, and the `group` posture's union as `(organization_id IN (…) OR organization_id IS NULL)`. That was the v17 reading, in which a row with no organization stood for platform state, and every tenant's scoped read, count, update and delete reached it. The Turso remote face compiles the same scope, so it answered the same rows.
- **Now.** The scope is `organization_id = :tenant`, or `organization_id IN (…)` under `group`. NULL is not an owner: a row with no organization is no tenant's, and only an unscoped read (no tenant on the call) reaches it. The lifecycle sweep's global retention and archive pass over an `organization_id` partition is a bare `$nin` of the overriding tenants: it no longer selects organization-less rows.
- **Unchanged.** A call with no tenant context and an object with no tenant column are unscoped, as before. The `single` posture's driver reads carry no tenant scope at all (ADR-0131 D8). The `sys_audit_log` attribution partition (`tenant_id`, ADR-0131 D7) keeps its NULL arm: a deployment-level ledger row is about no organization by design, and the global pass still reaps it. Insert stamping (`injectTenantOnInsert`) is unchanged.

**Who is affected.** Only a database that still holds organization-less rows in a tenant-scoped table, and only under a walled posture (`group` / `isolated`) or a caller that passes `tenantId` to the driver itself. A certified 18.x database holds none: a v17 database is refused at boot until `os migrate organization-ownership` certifies it, and a fresh install never writes one.

**The remedy.** If a scoped read misses a row you expect, the row has no organization: run the upgrade ceremony (`os migrate organization-ownership` to review its plan, then the same command with `--apply`), which stamps each such row with its owner, or stamp it yourself (`organization_id = <the owning organization>`).
