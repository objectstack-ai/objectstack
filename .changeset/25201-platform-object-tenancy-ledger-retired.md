---
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
---

refactor(objectql)!: the per-table platform-object tenancy ledger is retired, and the tenant-audit mute is decided by the object's schema (ADR-0131 D13)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/objectql#PLATFORM_OBJECT_TENANCY, @objectstack/objectql#classifyPlatformObjectTenancy, @objectstack/objectql#isPlatformObjectOutOfTenantAuditScope, @objectstack/objectql#tenantScopedPlatformObjects, @objectstack/objectql#PlatformObjectTenancy, @objectstack/objectql#PlatformObjectTenancyEntry) The only author-reachable removals are runtime exports of `@objectstack/objectql`'s published entry: the ledger table, its three predicates and its two types. No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** for code that imports the ledger from `@objectstack/objectql`. It ships as `patch` because the metadata protocol is unchanged.

- **`@objectstack/objectql`: the ledger and its exports are gone.** No write ever depended on them: since ADR-0131 C8 stage 8b, every object with a tenant column takes the system-write rule's derived organization or is refused, whatever its name. The ledger's last reader was the engine's tenant-audit mute, which is now read off the schema.
- **The tenant-audit mute (`bypassTenantAudit` on an elevated write) is decided by the object's schema alone.** An elevated write is muted only when the object has no tenant column (`tenancy.enabled: false`, `systemFields.tenant: false`, or no tenant field) or is federated. A platform-namespace object that has a tenant column is now audited like any other. On a walled posture (`isolated` / `group`), an elevated write on such an object that reaches the SQL driver with no `tenantId` therefore prints the `[tenant-audit]` warning, once per object and operation. Nothing a write touches changes: the mute only decides whether that line is printed.
- **`@objectstack/driver-sql`: the `[tenant-audit]` warning names both readings.** It no longer tells every unscoped write to "pass tenantId". A write that belongs to one organization should run in that organization's context. A write that crosses organizations on purpose, such as a platform admin the organization wall exempts or a system job over every organization, needs no fix, and the caller declares it with `bypassTenantAudit: true`. The line still starts `[tenant-audit] <op> on tenant-scoped object "<object>"`, and its metadata is unchanged.

**Migration** for code that imported the ledger:

- FROM `PLATFORM_OBJECT_TENANCY` TO the object's schema: an object is in tenant scope when `resolveTenantFieldName(schema)` (still exported) answers non-null. `scripts/platform-object-tenancy-census.json` in the repository lists, per platform object, the schema declaration that puts it outside.
- FROM `classifyPlatformObjectTenancy(name)` TO `resolveTenantFieldName(schema) !== null` on the registered schema.
- FROM `isPlatformObjectOutOfTenantAuditScope(name)` TO `resolveTenantFieldName(schema) === null`.
- FROM `tenantScopedPlatformObjects()` TO the census's `reach: "in"` rows.
- FROM `PlatformObjectTenancy` TO delete it: no classification exists any more.
- FROM `PlatformObjectTenancyEntry` TO delete it: no classification exists any more.
