---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an object definition changed through the metadata door takes effect in the audit writers at once, with no restart

Clause-②: no

The audit writers kept each object's first definition for the life of the process. They now read the registered definition on every call. The registry already holds the merged definition behind its own invalidation points, so the read is two map lookups.

- **Attachments follow `enable.files`.** An object whose `enable.files` was switched on through `PUT /api/v1/meta/object/:name` kept refusing `sys_attachment` writes with 403 `FILES_DISABLED` until the server restarted, although the metadata read-back already showed `enable.files: true`. The same attachment is now admitted at once, and switching the flag off refuses it again. `enable.feeds` on comments follows the same read.
- **The ledger copy follows field changes.** A `password` field added to an already-audited object was copied into `sys_audit_log` in plaintext until a restart. It is now masked, as it is on every other read exit. The same read decides the mask for `secret` fields and the omission of `internal` ones.
- **The activity row follows the object.** `enable.activities`, `activityMilestones`, the title field and the object label are read from the current definition too.

What the metadata door accepts is unchanged.
