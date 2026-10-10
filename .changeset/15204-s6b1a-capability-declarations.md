---
'@objectstack/plugin-security': minor
---

feat(plugin-security): the curated platform capabilities are declared `capability` metadata

Clause-②: no

`SecurityPlugin` now declares the nine curated platform capabilities (`PLATFORM_CAPABILITIES` in `@objectstack/spec`: `manage_users`, `manage_org_users`, `manage_metadata`, `manage_platform_settings`, `setup.access`, `setup.write`, `studio.access`, `manage_sharing`, `view_all_audit_log`) to the engine registry under its own package id, from that one spec list. The security catalog read (`createSecurityCatalogReader`) and `GET /api/v1/meta/capability` now list them beside the capabilities a stack declares, and `GET /api/v1/meta/capability/:name` answers each one's definition (`name`, `label`, `description`, `scope`) where it answered `404`. A write to one of them at the metadata door is still refused, as before: `capability` is code-only.

Nothing else changes: the `sys_capability` rows the boot seeds are identical, on a fresh database and on one already seeded, and no capability seeder reports the platform's own declarations.
