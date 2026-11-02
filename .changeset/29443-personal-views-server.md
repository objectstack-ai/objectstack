---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

feat(platform-objects): `sys_personal_view`, a reader's own named list views (server half of the first version)

Clause-②: yes (widening)
Metadata-protocol: none

A reader can now keep named list views of their own, as user data rather than view metadata. The new platform object `sys_personal_view` holds one row per saved list: its owner (`user_id`), the object it lists (`object_name`), the name the owner gave it (`label`), the list configuration in spec's `ListView` shape (`config`), and whether it is the owner's default for that object (`is_default`). It is registered beside `sys_user_preference`, on the same template, and served by the generic data API at `/api/v1/data/sys_personal_view`.

- **Owner only.** The object declares the owner-only default row scope `user_id == current_user.id` for every operation, and the table carries the organization column, so the organization wall bounds it too. Another member reads none of a member's views by id (`404`), lists none, and updates none (`404 RECORD_NOT_FOUND`); a create naming another owner is refused `403 PERMISSION_DENIED`.
- **No admin back door for organization administrators.** `organization_admin` (and the derived `organization_admin_no_bypass`) name the object without the wildcard's super-user bits, so an organization administrator reads and writes only their own views. A platform administrator's bare `admin_full_access` wildcard still reads every row, as it does on `sys_user_preference`.
- **The body is a `ListView`, judged on every save.** A create, and an update that sends `config`, parse it with spec's `ListViewSchema`; a body that does not parse is refused `400 VALIDATION_FAILED` with one `fields[]` entry per issue, each path under `config`. No new error code.
- **At most one default per owner and object.** Saving a row with `is_default: true` clears the flag on the owner's other views of the same object in the same write.
- **Field security is not re-judged on save.** A view whose filter names a field the reader cannot read is saved; the list query that applies the filter is refused `403 PERMISSION_DENIED` by the existing predicate guard.
- **Not view metadata.** `/meta` never serves a personal view, the metadata write door never writes one, and a package export never carries one. Its id is the engine's record id, which never takes the `object.key` view syntax.
- **The owner's delete door.** `DELETE /api/v1/personal-views/:id` removes one personal view, and only the caller's own: the row is read as the caller (another member, and an organization administrator, get the unknown-id `404 RECORD_NOT_FOUND`), and a row the caller can read but does not own (a platform administrator's) is refused `403 PERMISSION_DENIED`. Only then is it removed, as the system, attributed to the caller and inside the caller's organization. Success is `200` with `{ id, deleted: true }`. The door takes no query parameter (`400 VALIDATION_ERROR`) and serves signed-in callers only (`401 UNAUTHENTICATED`). It is mounted by `AuthPlugin` on the kernel's HTTP server, the shape of the comment-reaction unreact door.
- **Grants.** `member_default` grants read, create and edit on the object, and no delete: that set is bound to the `everyone` anchor, which carries no delete bit (ADR-0090 D5). The generic data `DELETE` on a personal view stays refused `403 PERMISSION_DENIED`; the door above grants nothing.

`PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` (`@objectstack/spec/system`) lists `sys_personal_view`, so lint and cross-reference checks know the name is real. The CLI's organization-ownership inventory carries the new object's row.
