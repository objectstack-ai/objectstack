---
'@objectstack/cli': patch
'@objectstack/metadata-protocol': patch
---

fix(cli, metadata-protocol): `os migrate plan` lists the permission-set grant's package-less guard that `os migrate apply` builds (#32460)

Clause-②: yes (widening)
Metadata-protocol: none

`os migrate apply` builds `sys_user_permission_set`'s package-less guard, `uniq_sys_user_permission_set_packageless`, after it performs the schema DDL it held back for the confirmation. `os migrate plan` listed the grant table apply creates and said nothing about that index, so the plan an operator reads before applying was silent about DDL the apply then ran.

- The plan now lists it in a section of its own, after the held-back work and before the drift, the order apply performs them in: `+ sys_user_permission_set.uniq_sys_user_permission_set_packageless [unique (user_id, permission_set, organization_id) WHERE permission_set_package IS NULL]`, with `on the table created above` when the same apply creates the table. Under `--json` it is the new `schemaSyncIndexes` array, present whenever a SQL driver was found and never counted in `total`. Each entry is `{ migration, table, index, keyParts, rowScope, status, onCreatedTable?, duplicateKeys?, duplicateRows?, detail? }`, where `status` is `build`, `blocked` or `unreadable`.
- It lists only what apply builds. A guard that already stands is no step: apply's build reads the catalog first and sends no DDL, and the plan asks the build's own catalog statement. No table and none created is no step, and neither is a plan with nothing to apply, because apply then returns before the step that builds the guard. A Turso remote primary's plan lists none, because its apply builds none there.
- Rows that would collide under the guard make the step `blocked`, with the number of key values and the rows that hold them: apply's build is refused there, changes no row, and the rest of the plan is applied. `os migrate duplicates` lists those rows.
- The indexes the serving boot builds at `kernel:ready` (the activation ledger's package-less index among them) stay out of the plan, because `os migrate apply` never builds them. `os migrate duplicates` remains where what blocks them is reported.
- `@objectstack/metadata-protocol` exports `buildUserPermissionSetPackagelessIndexPresenceSql`, the guard build's own catalog statement, which the plan reads.
