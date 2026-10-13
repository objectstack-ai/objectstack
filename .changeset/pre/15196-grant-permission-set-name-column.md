---
"@objectstack/plugin-security": minor
"@objectstack/plugin-auth": minor
"@objectstack/verify": minor
---

`sys_user_permission_set` gains `permission_set`, the name of the permission set a grant holds, written beside `permission_set_id` (ADR-0131 D4)

Clause-②: yes (widening)

- **The column.** `permission_set` is a read-only text column, at most 100 characters, holding the `name` of the `sys_permission_set` row that `permission_set_id` points at. It is readable everywhere the grant row is readable. A grant written before this release has `NULL` here until the backfill stage rewrites it. No reader uses the column yet: the grant is still resolved from `permission_set_id`, which stays until it is dropped in a later major (ADR-0131 D10).
- **The platform writes it, on every write that carries `permission_set_id`, for every caller.** Two `@objectstack/plugin-security` engine hooks (`beforeInsert` and `beforeUpdate` on `sys_user_permission_set`) look up the set by id and store its name. A write that sends only the id, which is how the data door and the Setup forms write, gets the name filled in.
- **A name that names a different set is refused** with `400 VALIDATION_FAILED`, `invalid_value` at `permission_set`. This covers a name that disagrees with the id written beside it, or with the id already stored when only the name is written. For a non-system caller it also covers a name beside an id that names no set this caller's organization can see. A name that agrees is accepted. A cleared name (`null`) is not stored as a clear: the derived name is written back. Before this change the column did not exist, so a write naming it was refused with `400 INVALID_FIELD`. No write that was accepted before is refused now.
- **Every platform grant writer writes both columns:** the organization-admin reconcile and the platform-admin promotion in `@objectstack/plugin-security`, the self-registration grant in `@objectstack/plugin-auth`, and the RLS probe persona in `@objectstack/verify`.
- **Nothing to migrate.** No principal's grants change. To fill the column on grants written by your own code, write the set's name as `permission_set`, or leave it out and the platform fills it in. Do not write any other value there.
