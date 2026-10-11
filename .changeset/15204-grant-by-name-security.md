---
'@objectstack/plugin-security': minor
---

A permission-set grant names its set by name: `sys_user_permission_set.permission_set` is the grant's one reference, and `permission_set_id` is no longer written or required

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A data-door contract change on a platform object's rows, not on any metadata schema: no key of any spec schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. Stored grants written before the name column are named by the existing one-time backfill at boot; the id column and its data are dropped by a later ADR-0131 D10 stage, not here. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING** accept-set narrowing on `sys_user_permission_set`, shipped as `minor` under the repo's launch-window convention for breaking changes. ADR-0131 D10's first step: every grant names its set, then the id column goes.

- **Before.** A grant was written with `permission_set_id`, a required lookup to a `sys_permission_set` row, and the platform derived `permission_set` (read-only) from that row. A write carrying only the id was accepted and named; a supplied name had to agree with the id's row.
- **Now.** `permission_set` is required and writable: it holds the permission set's machine name, and the set is the security catalog's definition of that name (ADR-0131 D3). `permission_set_id` is optional, and nothing writes it or derives anything from it. A grant that names no set is refused `400 VALIDATION_FAILED` (`required` at `permission_set`). A non-system write naming a set the security catalog does not hold is refused `400 VALIDATION_FAILED` (`reference_not_found` at `permission_set`), the same envelope `sys_user_position.position` answers with; a deactivated set is still a set and is accepted. System writes are not judged against the catalog.
- **The platform's own grant writers** (the platform-admin promotion and the organization-admin reconcile) write the name alone and read no `sys_permission_set` row to do it, so a database with no such rows still gets its first platform administrator and its organization administrators. A row id is read only to revoke, or not duplicate, a grant written before the name column existed, which names nothing until the one-time backfill names it. Uninstalling a package revokes the grants that name its sets.
- **Unchanged.** Grants written before this release keep their id and are named by the existing backfill; the resolver and every grant reader already read the name.

**The remedy.** A caller that wrote `{ user_id, permission_set_id: <row id> }` writes `{ user_id, permission_set: '<set name>' }`: the `name` of that set, as the metadata door (`GET /api/v1/meta/permission`) lists it.
