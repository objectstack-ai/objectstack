---
'@objectstack/plugin-security': patch
---

A position saved through the metadata door no longer stops an app's declared positions from being seeded

Clause-②: no

Every seeding pass copies the app's declared positions into the `sys_position` catalog: the boot's pass and, on a walled deployment, the pass each new organization gets. That seeder read one source or the other: the engine registry alone whenever it held any position besides the six built-ins, otherwise the metadata service. A position a platform administrator saves with `PUT /api/v1/meta/position/:name` lives in the registry. So after one such save, every later pass seeded that position and none of the app's own. Measured on the showcase, walled: an organization created after the save held 7 positions (the six built-ins and the saved one) instead of 17.

The seeder now reads through the security catalog read (`createSecurityCatalogReader`). It reads both sources on every pass, and for a name both hold, the registry answers first.

- **New organizations** get the built-ins, every declared position and every door-saved one. Measured on the same walled showcase: 17 positions.
- **Rows are written as before.** The door-saved position's row is unchanged: same name, label and description, `active: true`, `is_default: false`, no provenance stamp. For a name both sources hold, the registry's definition is still the one written.
- **The six built-in positions** are still written only by the built-in seeder, with `managed_by: 'platform'`. Some deployments saved a definition under a built-in name before the six were declared, and that definition still shadows the declaration when the catalog is read. This seeder skips it by name, so it never reaches a row.
- **A catalog read that fails** now writes nothing for that pass, and the boot reports it once as `[security] declared-position seeding failed`. That covers a source that cannot be read and a metadata list that lost a loader. Before, the seeder seeded whatever part it could read, without saying so.
- **No grant changes.** A principal's permissions move only if it holds a position that is newly seeded into its organization.
