---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a predicate update or delete now writes the rows a Modify All holder, a non-creator owner or an edit-share target can write by id, instead of stopping at the platform's creator-only floor

Clause-②: yes (widening)
Metadata-protocol: none

A predicate write (`update(object, data, { where, multi: true })`, `delete(object, { where, multi: true })`) by an organization member held the platform's own ownership floor (`owner_only_writes` / `owner_only_deletes` in `member_default`, `created_by == current_user.id`) as an unconditional condition, where record sharing enforces writes. Unless an app-authored write policy admitted a row, the write matched only the rows that member had created, even when the same user could update or delete the other matching rows one at a time by id. This affected a manager holding `modifyAllRecords` on the object, a row's owner who did not create it, and, for an update, the target of an `edit`-level record share or a member of the queue a row sits in. The write answered success and changed fewer rows than its predicate matched. A write by id lets the record-sharing service's `allow` verdict replace the floor.

The predicate write now makes the by-id decision for each matched row the floor would refuse. Such a row is written when a write of that row by id would be, because the sharing service answers `allow` for it: ownership at the caller's write depth, Modify All, or, for an update only, an `edit` share or the row's queue. A row the service abstains on (an object with no `owner_id`, a public object) or denies keeps the floor. The row-level `check` on each updated row follows the same decision.

A predicate update still applies to all of its matched rows or to none. So a write that used to succeed on the rows the caller created can now be refused whole when a newly matched row fails a row-level `check`, a validation rule or a hook. A `readonlyWhen` lock on a newly matched row can now strip a field from the whole write. A write by id of that row is refused the same way.

The by-id decision costs one sharing verdict, a few store reads, for each matched row the floor does not already admit. None is asked where an app-authored `using` policy for the write applies to the caller, because a row the floor refuses fails that policy too. A member's predicate update that matches 10,000 readable rows owned by other people now makes 10,000 verdicts, nearly all `deny`, before it writes the rows it may. Measured on SQLite in memory, that took about 5 s, against about 50 ms before.

What does not change:

- The rows a predicate write can reach are still only the rows its predicate matches that the caller can read. A predicate matching more than 10,000 of them is still refused before anything is written.
- The sharing service's own bulk write scope still bounds a predicate write: the owner set at the caller's depth, plus the edit shares (at most 5,000 of them) and the queue on an update. A row that only a read share and an app `update` policy together make writable is still written by id alone.
- An app-authored row-level policy still binds every row, and Modify All still does not bypass row-level security on an ordinary business object.
- An `edit` share still widens update and never delete.
- The tenant wall is unchanged.
- A write made on another user's behalf keeps the floor for both principals, as its by-id write does.
- A `controlled_by_parent` detail keeps the floor on a predicate write. Its by-id write is decided by the master gate instead, and that half is not changed here.

No action is needed for a flow, script or server-side bulk update that should write every row it may. One that relied on a predicate write skipping rows the caller did not create now writes those rows too, when the caller may write them by id. If those rows fail a check, the whole write is now refused.
