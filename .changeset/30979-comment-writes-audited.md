---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): a comment write leaves a ledger row and an activity row, stamped when the author was impersonated

Clause-②: no
Metadata-protocol: none

`sys_comment` is no longer on the audit writer's skip list. Creating, editing and deleting a comment now writes one `sys_audit_log` row and one `sys_activity` row, exactly like a write to any other object, and a comment written from an impersonation session carries the administrator in `metadata.impersonated_by` (and `impersonated_by_name` on the activity row). Before, such a comment could not be told from one the user wrote.

The rows name the comment as their parent (`object_name: 'sys_comment'`, `record_id`: the comment's id), so a record's own activity timeline does not show the comment twice; they appear in the object-agnostic feeds (the recent-activity feed, the Audit Logs list). A reader is served them only when it can read the comment, which means reading the record the comment is on: the activity and ledger read gates now enumerate `sys_comment` as a parent and ask the comment's own read gate. A holder of the ledger's audit capability keeps reading every ledger row of the organization, as before. Comments written before this change have no rows; nothing is backfilled.
