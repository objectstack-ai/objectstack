---
'@objectstack/cli': minor
'@objectstack/runtime': minor
'@objectstack/spec': minor
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/objectql': minor
'@objectstack/plugin-webhooks': minor
'@objectstack/platform-objects': minor
'@objectstack/service-automation': minor
'@objectstack/service-settings': minor
---

feat(cli,runtime)!: `os migrate organization-ownership` upgrades a database 17.x or an 18.0 pre-release created; a server serves only a database it created or one the ceremony certified

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The data migration this change prescribes is the operator's ceremony, `os migrate organization-ownership`, stated below; the boot refusal names it. Two `@objectstack/objectql` exports are removed, `WALLED_ORGANIZATION_LESS_BRIDGE` and `isWalledOrganizationLessBridgeObject`: they named the two tables whose organization-less inserts were let through under a wall while those tables still carried an organization column, and both tables now declare none. Neither is a metadata key and no stored row or stack names them, so a caller has nothing to migrate: drop the import, since a deployment-level table is recognised by `systemFields: { tenant: false }`. -->

**BREAKING** for a database with no birth marker — one 17.x or an 18.0 pre-release (`18.0.0-next.*`) created — shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D10).

- **The ceremony is open.** `os migrate organization-ownership` runs again (the 18.0 pre-releases refused it with `NOT_IMPLEMENTED`): a bare run writes the plan, and `--apply --plan-file PLAN --backup-taken` applies that reviewed plan. Its new steps carry what an 18.0 pre-release database still owes, each selected by the rows' shape, never by a NULL organization:
  - `sibling-moves`: the global settings-audit rows move to `sys_platform_setting_audit`, and identity mail (reset, verification, account invitation, change-email notice, magic link) to `sys_identity_email`, id for id. Their queued mail jobs and their activity rows follow them. The organization invitation stays in `sys_email`.
  - `declared-webhooks`: each `sys_webhook` copy a package's seeder wrote under a name a package still declares is settled. A pristine copy is deleted once its deliveries name the declaration (`declared:NAME`), with the cipher it referenced. A copy customized only in its switch becomes the declaration's activation row. Any other edit becomes the administrator's own webhook under a new name (`NAME_custom`), and the declaration is switched off.
  - `declared-rule-copies`: each stored sharing rule under a declared rule's name becomes a clone under a new name, its grants kept, and the declaration is switched off.
  - `not-null`: after the column drops, every table the post-step plan clears takes `organization_id` NOT NULL. The ceremony owns that nullability, so the schema differ no longer reports it as `relax_not_null` drift.
- **The boot guard decides on a marker.** The first boot that creates a datastore from empty writes a birth marker (`sys_migration` row `adr-0131-organization-ownership`, `details.birth.shapeGeneration`). Every CLI data boot writes it too, so a fresh install whose first command is `os migrate apply` or `os seed` still boots. On the Turso remote face (`libsql://`), `getSchemaSyncStats` now answers what its schema doors created and found (it answered `{ created: 0, existing: 0 }` before), so a fresh remote database is observed as one and gets its marker. The ceremony's verified marker carries the same `shapeGeneration` (now `1`, `ORGANIZATION_OWNERSHIP_SHAPE_GENERATION` in `@objectstack/spec/system`). A server refuses a database with no marker (one 17.x or an 18.0 pre-release created), one certified at an older generation, or an uncertified one. The refusal names the command and no longer says to stay on 17.x. The v17-shape probe also reads `tenancy: { enabled: false }` and `systemFields: false`.
- **`sys_secret` and `sys_flow_credential` are deployment-level** (`systemFields: { tenant: false }`). Their `organization_id` is dropped by the ceremony's column-drops step. The settings service no longer writes one, and `SettingsSecretStore.insert` no longer takes it. With no organization column, their organization-less system inserts land under a walled posture on the engine's own rule, so `@objectstack/objectql` no longer exports `WALLED_ORGANIZATION_LESS_BRIDGE` or `isWalledOrganizationLessBridgeObject`, and the system-write refusal's remedy names `systemFields: { tenant: false }`.

**What an operator does.** Fresh installs are supported under every tenancy posture and need nothing. Before serving a database 17.x or an 18.0 pre-release created with this release: start this release against it once (the boot is refused, and its schema sync has already created the tables this release adds, which the ceremony moves rows into), take a backup, run `os migrate organization-ownership --out plan.json`, review the plan, then run `os migrate organization-ownership --apply --plan-file plan.json --backup-taken`, and start the server. `os dev` does this for a local SQLite development database. On a walled database, a customized copy of a declared webhook or sharing rule blocks its step, naming the row: rename it to a name no package declares, or delete it, then re-run.
