---
'@objectstack/plugin-security': minor
---

feat(plugin-security)!: a package's declared capabilities are served by the registry alone — the declared-capability seeder and its collision diagnostic are deleted

Clause-②: no

`SecurityPlugin` no longer seeds a `sys_capability` row for a capability a package declares (`defineCapability` / a stack's `capabilities`). The registry is that capability's one home (ADR-0131 D3): the security catalog read (`createSecurityCatalogReader`), `GET /api/v1/meta/capability` and the anchor predicates' declared-capability context read the declaration there, as they already did. The curated platform capabilities' rows still seed as before.

A capability name declared by two packages, or a package declaring a curated platform capability name, is refused at boot by the registry's one-holder rule (`SecurityCatalogNameConflictError`, `422`), which already refused it before the deleted runtime diagnostic could run.

Removed from `@objectstack/plugin-security`'s public exports, with no replacement:

- `CAPABILITY_NAME_COLLISION`
- `capabilityNameCollisionDiagnostic`
- `formatCapabilityNameCollisionDiagnostic`
- `reportCapabilityNameCollisions`
- `CapabilityNameCollisionDiagnostic` (type)

FROM → TO:

- FROM a package's declared capability materialized as a `managed_by: 'package'` `sys_capability` row at boot → TO the declaration served by the registry, with no row written. Read it with `GET /api/v1/meta/capability/:name` or the security catalog read, not from `sys_capability`.
- FROM a name collision reported at boot through `reportCapabilityNameCollisions` → TO the same collision refused by the registry's one-holder rule. Delete any import of the five names above; there is nothing to call in their place.
