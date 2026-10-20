---
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/spec': patch
---

feat(driver-sql,driver-turso)!: a table the driver creates carries its tenant column NOT NULL, so a write that names no organization is refused at the database

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A storage constraint at CREATE TABLE: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type or error code is removed or renamed; `TENANT_SCOPE_FIELD_DEF` keeps its shape and only its description text is corrected. The remedy is a run-time one, stated below. -->

**BREAKING** accept-set narrowing at the database, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D1: "There is no nullable tenant column anywhere").

- **Before.** The SQL driver created a table's tenant column (`organization_id`, or a declared `tenancy.tenantField`) nullable, as the injected field's declaration says (`required: false`, no `storage`). A write that reached the driver without an organization landed a row no organization owns.
- **Now.** Every table the driver CREATES takes its tenant column `NOT NULL`, with no metadata change: the plain managed table (`initObjects`), every newly rotated shard (asked of the base table's declaration), and a table the Turso remote face creates (`syncSchema`, `syncSchemasBatch`, `initObjects`). A write with no organization on such a table is refused by the database (`NOT NULL constraint failed: <table>.organization_id`, `violates not-null constraint`, or `cannot be null`). That includes an `upsert` whose payload omits the organization: the database checks the proposed row before it resolves the conflict.
- **Unchanged.** A tenant column ADDED to a table that already exists stays nullable, and so does an existing shard or an existing remote table: a table that already holds rows is the organization-ownership ceremony's to tighten (`os migrate organization-ownership`), which reports a shard and the Turso remote face as unable to. The schema differ reports no drift over the tenant column's nullability either way. An object with no tenant column (`tenancy: { enabled: false }`, `systemFields: { tenant: false }`) is untouched, even when it carries a field named `organization_id`.
- **Who sees it.** A composed `os serve` / `os dev` / `os start` with auth stamps every write with its organization, so nothing changes there. A production `os serve` whose `AuthPlugin` did not compose (no `OS_AUTH_SECRET`) and a lean embedding (`@objectstack/objectql/core` or `createStandaloneStack` over a SQL driver, with no organization object) used to write those rows with a NULL organization; now each such write fails, loudly.

**The remedy.** Carry the organization on the write: `ql.insert(object, { ...row, organization_id: orgId })`, or `{ context: { tenantId: orgId } }`. Compose authentication (set `OS_AUTH_SECRET`) so the platform derives it. If the object's rows legitimately belong to no organization, declare it so and it has no tenant column: `systemFields: { tenant: false }` or `tenancy: { enabled: false }`.
