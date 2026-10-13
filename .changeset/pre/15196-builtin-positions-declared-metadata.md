---
"@objectstack/plugin-security": minor
---

feat(plugin-security)!: the six built-in positions are declared position metadata of the plugin (ADR-0131 D2)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, export or stored shape changes; the refusal is of six reserved position names at one REST door, and no stored definition is rewritten -->

**BREAKING** on one write door, shipped as `minor` under the repo's launch-window convention for breaking changes.

- **What is declared.** The identity positions `platform_admin`, `org_owner`, `org_admin` and `org_member` (ADR-0068 D2) and the audience anchors `everyone` and `guest` (ADR-0090 D5/D9) are registered with the engine registry as `position` metadata owned by `com.objectstack.plugin-security`, the way the plugin's own permission sets are. Their names, labels and descriptions come from one list built from `@objectstack/spec`'s `BUILTIN_IDENTITY_NAMES` and `BUILTIN_IDENTITY_METADATA` and the anchor text, and the built-in seeder reads that same list.
- **Rows and grants do not move.** `sys_position` is seeded exactly as before: the same names, the same organizations (one copy per organization under a walled posture, one organization-less pass under `single`), `managed_by: 'platform'`, `active: true`, `is_default: false`, and the same labels and descriptions. No principal's grants change.
- **What a client can now read.** `GET /api/v1/meta/position` lists the six beside the stack's own positions, and `GET /api/v1/meta/position/:name` answers `200` with each one's definition, where it answered `404 RESOURCE_NOT_FOUND`. The security catalog read (`createSecurityCatalogReader` in `@objectstack/core`) lists them from the engine registry.
- **What a client can no longer write.** `PUT /api/v1/meta/position/:name` naming one of the six is refused `403 NOT_OVERRIDABLE`: the name is provided by a code package, and `position` has no overlay. It was saved as an environment-wide definition before. Give an authored position a different name. `DELETE /api/v1/meta/position/:name` on one of the six still answers `200` and removes nothing.
- **The declared-positions seeder** keeps reading the engine registry first and the metadata service only when the registry holds no position. The six are left out of that decision and out of what it seeds, so stack-declared positions keep seeding and the six keep the built-in seeder as their one writer.
