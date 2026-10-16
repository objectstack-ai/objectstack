---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the audit ledger no longer records a user's own writes to their own UI-state row (`sys_user_preference`). A deployment that exports `sys_audit_log` to a SIEM or a compliance archive stops receiving those rows from this release on, and nothing else tells that consumer.

Clause-②: no

The console saves a user's list preferences, recent items, favourites and palette recents as that user's own `sys_user_preference` rows, one write per click. Each write landed an `update` row in `sys_audit_log`, so Setup's Audit Logs opened on a run of one user's clicks, and the System Overview's "Events by User" chart counted them.

- **What changed.** When the acting user is the row's owner (`user_id`) on both sides of the write, the audit writer records neither the `sys_audit_log` row nor the `sys_activity` row. It already skipped the activity row for such a write; it now skips the ledger row by the same test. A create, an update and a delete are all covered.
- **What is still recorded.** Every other actor's write to the same rows: an administrator editing someone's preferences from Setup, a system write with no user, and a write that moves a row to another owner. `sys_user_preference` is not an excluded object, and every other object is unchanged.
- **Nothing to migrate.** Rows already in `sys_audit_log` stay.

The list of per-user UI-state objects is closed and declared inside the plugin, and today holds one object, `sys_user_preference`. No metadata key adds an object to it.
