---
'@objectstack/plugin-security': patch
---

fix(plugin-security): every member reads and posts comments, and reads the activity history, of the records they can read — the platform baseline `member_default` now grants `sys_comment` (read, create, edit) and `sys_activity` (read)

Clause-②: no — runtime permission behaviour (human-floor security/permission class, ruled by the maintainer), not a published accept-set or public-surface widening
Metadata-protocol: none

Comments (`enable.feeds`) and the activity timeline (`enable.activities`) are on by default on every object, but no shipped permission set named `sys_comment` or `sys_activity`. A member of an app whose permission sets name only the app's own objects — what `create-objectstack` generates — was refused both (`403` on `GET /api/v1/data/sys_comment` and `GET /api/v1/data/sys_activity`), on records they can read: the record page showed "no permission" for comments and activity, and offered no comment box. An app author no longer needs to grant the two objects by hand.

- **Which rows is unchanged.** The grant opens the two objects; plugin-audit's parent-record gates still decide the rows, so a member reads and posts comments, and reads the history, of exactly the records they can read, and nothing of any other record — a record another user owns under the app's row scope, or a record of an object the member does not read. A member edits the comments they wrote. The grant carries no delete bit (deleting a comment stays the moderation path, through a delete bit an app grants), no export and no view-all or modify-all.
- **`enable.feeds: false` still closes comments** on that object: creating a comment there, or moving one into it, answers `403 FEEDS_DISABLED`. `enable.activities: false` still writes no activity row for the object.
- **External members are not reached.** A holder of the `external` organization role does not hold the `everyone` anchor and resolves `external_default` in place of `member_default`, so a portal user still gets comments and activity only through an explicit grant, under the same two gates.
- **No log noise.** A member's activity read skips the parent objects they cannot read without reading them, so the console header's feed logs no `[Security] Access denied` line per skipped object.
- An app that already grants the two objects to its members keeps working unchanged: permission sets merge most-permissively, so its own lines (a delete bit included) still apply beside the baseline's.
