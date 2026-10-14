---
'@objectstack/plugin-security': minor
'@objectstack/cli': minor
'@objectstack/spec': minor
---

feat(plugin-security,cli)!: `sys_user_permission_set.permission_set_id` is retired, the boot-time grant-name backfill is deleted, and a grant is unique per user, set and organization (ADR-0131 D4/D10)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ups-permission-set-id-column-retired -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.

A permission-set grant names its set by `permission_set`, its one reference (ADR-0131 D4). The legacy id column is no longer declared, and the grant's uniqueness now keys the name.

FROM → TO:

- `sys_user_permission_set.permission_set_id` → `permission_set`, the machine name of the set the grant holds. A seed row or data-door write that still carries `permission_set_id` is refused with `400 INVALID_FIELD`. Fix: delete the key and name the set, `{ user_id, permission_set: '<set name>', organization_id }`.
- The unique index (`user_id`, `permission_set_id`, `organization_id`) and the (`permission_set_id`) index → one unique index on (`user_id`, `permission_set`, `organization_id`). A second grant of one set to one user in one organization is refused `409 UNIQUE_VIOLATION` (the thrown error is `DuplicateRecordError`, `DUPLICATE_RECORD`). SQL keys a NULL organization apart, so the write door refuses a second platform-wide grant (organization NULL) the same way, for every writer, system writers included: against the stored grants, and within one batch insert or one multi-row update. Two concurrent single writes are the one case the door cannot see. Fix: keep the grant that exists; to change it, update that row.
- The boot-time grant-name backfill (`runOneTimeGrantPermissionSetNameBackfill`, the `sys_migration` entry it recorded at `kernel:bootstrapped`) → `os migrate organization-ownership --apply`. Its verified rewrite names every grant from the physical `permission_set_id` column by raw SQL, verifies each name against the security catalog, and its `column-drops` step then drops the column through the schema-drift ceremony (schema sync is additive, so an undeclared column stays until it is dropped). Fix: run the ceremony on every database upgraded from a release before the `permission_set` column existed, then restart the server: the boot's organization-administrator sweep revokes, by name, a newly named grant whose pair no longer qualifies, and a server left running across `--apply` serves it until then.

On a 17.x database every grant names nothing until `--apply` names it, so between the first v18 boot and `--apply` no grant confers anything, the platform administrator's included.

What else changes:

- `os migrate organization-ownership --plan` reports a `grants` block on `sys_user_permission_set`, keyed like the new index (a NULL organization keyed with NULL):
  - `duplicates`: groups of named grants holding one set for one user in one organization. `--apply`'s `column-drops` step does not drop `permission_set_id` while one group remains.
  - `rewriteCollisions`: legacy grants whose derived name their user already holds in the same organization — the first v18 boot creates the index, and its organization-administrator sweep writes a named grant beside each legacy one. `--apply`'s rewrite names none of them and blocks, naming both ids.
  - On a database without the `permission_set` column it counts zero and names the remedy (boot this release once), instead of refusing the plan.

  The ceremony deletes no grant: remove the one you do not keep, then re-run.
- `--apply` drops the two retired indexes before the column, in a separate earlier schema-drift apply: MySQL refuses to drop a column a key still uses.
- The organization-administrator reconcile and its boot sweep, the platform-admin bootstrap's unnamed-grant leg (Leg C) and the catalog reference report read grants by name only. A legacy grant that names nothing confers nothing, still withholds the platform-admin promotion while it is unscoped, and is reached by no revocation until the ceremony's rewrite names it; once named, the boot sweep revokes it where its pair no longer qualifies. The report's `UnnamedGrant` entries lose `permissionSetId`.
- `GET /meta/object/sys_user_permission_set` no longer serves the hidden `permission_set_id` field.
