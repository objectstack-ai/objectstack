---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): a user's own write to their own `sys_user_preference` row no longer adds a `sys_activity` row. The `sys_audit_log` row is written as before

Clause-②: no

The console saves the user's "recently visited" list (`ui.recent`), favourites and palette recents as `sys_user_preference` rows as they navigate. The audit writer mirrored each of those writes into `sys_activity`, and the bell's Activity tab lists the newest activity rows the caller may read. So every navigation came back to the user as `Updated User Preference "ui.recent"`, and a fresh user's bell showed nothing else.

- **What changed.** For a per-user UI-state object, the writer skips the activity row when the acting user is the row's owner (`user_id`). The list of such objects is closed and declared beside the writer's exclusion list. Today it holds one object, `sys_user_preference`.
- **What stays.** The `sys_audit_log` row for the same write is written exactly as before. Another actor's write to a user's preference row keeps its activity row: an organization administrator editing it from Setup, a system write with no user, or a write that gives the row a different owner. Writes to every other object are unchanged.
- **Existing rows.** Activity rows written before this release stay where they are.
- **Nothing to migrate.** No configuration is needed.
