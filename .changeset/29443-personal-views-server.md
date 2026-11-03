---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

feat(platform-objects): `sys_personal_view`, a reader's own named list views (server step of the first version)

Clause-②: yes (widening)
Metadata-protocol: none

A reader can now keep named list views of their own, as user data rather than view metadata. The new platform object `sys_personal_view` holds one row per saved list:

- its owner (`user_id`);
- the object it lists (`object_name`);
- the name the owner gave it (`label`);
- the list configuration, in spec's `ListView` shape (`config`).

It is registered beside `sys_user_preference`, on the same template, and the generic data API serves it at `/api/v1/data/sys_personal_view`. Which view opens by default is not stored here: the reader's existing per-object pin holds a view id, and a personal view's id is one more value it can hold.

- **Owner only.**
  - The object declares the owner-only default row scope `user_id == current_user.id` for every operation. The table carries the organization column, so the organization wall bounds it too.
  - Another member gets nothing: no read by id (`404`), nothing listed, and no update (`404 RECORD_NOT_FOUND`).
  - A create naming another owner is refused `403 PERMISSION_DENIED`.
  - A view's owner is fixed when it is saved: an update that changes `user_id` is refused `403 PERMISSION_DENIED` for every caller but the system, platform administrators included. A save rule holds this, because for an organization member the `member_default` update floor (`created_by == current_user.id`) applies to an update in place of the object's own row scope.
- **No back door for organization administrators.** `organization_admin`, and the derived `organization_admin_no_bypass`, name the object without the wildcard's super-user bits. An organization administrator reads, writes and deletes only their own views.
- **Platform administrators are not limited.** The bare `admin_full_access` wildcard carries `viewAllRecords` and `modifyAllRecords`, so through the generic data API a platform administrator reads, edits and deletes any member's view. This is the same as `sys_user_preference` today. Whether that should change is an open question.
- **The body is a `ListView` for the row's own object, judged on every save.**
  - A create, and an update that sends `config` or `object_name`, parse the resulting body with spec's `ListViewSchema`.
  - A body that does not parse is refused `400 VALIDATION_FAILED`, with one `fields[]` entry per issue, each path under `config`.
  - A body whose `data.object` names a different object than `object_name` is refused the same way, on `config.data.object`.
  - No new error code.
- **Field security is not re-judged on save.** A view whose filter names a field the reader cannot read is still saved. The list query that applies the filter is refused `403 PERMISSION_DENIED` by the existing predicate guard.
- **Not view metadata.** `/meta` never serves a personal view, the metadata write door never writes one, and a package export never carries one. Its id is the engine's record id, so it never takes the `object.key` view syntax.
- **The owner's delete door.** `DELETE /api/v1/personal-views/:id` removes one personal view, and only the caller's own.
  - The row is read as the caller, so another member or an organization administrator gets the unknown-id `404 RECORD_NOT_FOUND`.
  - A row the caller can read but does not own is refused `403 PERMISSION_DENIED`.
  - Only then is the row removed, as the system, attributed to the caller and inside the caller's organization. Success is `200` with `{ id, deleted: true }`.
  - The door takes no query parameter (`400 VALIDATION_ERROR`) and serves signed-in callers only (`401 UNAUTHENTICATED`).
  - `AuthPlugin` mounts it on the kernel's HTTP server, in the shape of the comment-reaction unreact door.
- **Grants.**
  - `member_default` grants read, create and edit on the object, and no delete. That set is bound to the `everyone` anchor, which carries no delete bit (ADR-0090 D5).
  - A member's generic data `DELETE` on a personal view is still refused `403 PERMISSION_DENIED`. The door above grants nothing.
  - External members (`external_default`) get no grant in this version. Whether they can save views is an open question for the Console half.

`PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` (`@objectstack/spec/system`) now lists `sys_personal_view`, so lint and cross-reference checks know the name is real. The CLI's organization-ownership inventory carries the new object's row.
