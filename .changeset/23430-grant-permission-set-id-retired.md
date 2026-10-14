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
- The unique index (`user_id`, `permission_set_id`, `organization_id`) and the (`permission_set_id`) index → one unique index on (`user_id`, `permission_set`, `organization_id`). A second grant of one set to one user in one organization is refused `409 UNIQUE_VIOLATION` (the thrown error is `DuplicateRecordError`, `DUPLICATE_RECORD`). SQL keys a NULL organization apart, so the write door refuses a second platform-wide grant (organization NULL) the same way, for every writer, system writers included. Fix: keep the grant that exists; to change it, update that row.
- The boot-time grant-name backfill (`runOneTimeGrantPermissionSetNameBackfill`, the `sys_migration` entry it recorded at `kernel:bootstrapped`) → `os migrate organization-ownership --apply`. Its verified rewrite names every grant from the physical `permission_set_id` column by raw SQL, verifies each name against the security catalog, and its `column-drops` step then drops the column through the schema-drift ceremony (schema sync is additive, so an undeclared column stays until it is dropped). Fix: run the ceremony on every database upgraded from a release before the `permission_set` column existed.

What else changes:

- `os migrate organization-ownership --plan` counts a `duplicate-grants` category on `sys_user_permission_set`: the groups of grants holding one set for one user in one organization (a NULL organization groups with NULL). `--apply` deletes none of them, and its `column-drops` step does not drop `permission_set_id` while one group remains; its blocker names the count. Remove all but one grant per group, then re-run.
- The organization-administrator reconcile and its boot sweep, the platform-admin bootstrap's unnamed-grant leg (Leg C) and the catalog reference report read grants by name only. A legacy grant that names nothing confers nothing, still withholds the platform-admin promotion while it is unscoped, and is reached by no revocation until the ceremony's rewrite names it; once named, the boot sweep revokes it where its pair no longer qualifies. The report's `UnnamedGrant` entries lose `permissionSetId`.
- `GET /meta/object/sys_user_permission_set` no longer serves the hidden `permission_set_id` field.
