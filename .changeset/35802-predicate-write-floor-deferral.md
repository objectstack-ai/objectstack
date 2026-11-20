---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a predicate update or delete now writes the rows a Modify All holder, a non-creator owner or an edit-share target can write by id, instead of only the rows they created

Clause-②: yes (widening)
Metadata-protocol: none

A predicate write (`update(object, data, { where, multi: true })`, `delete(object, { where, multi: true })`) by a business user used to match only the rows that user had created (`created_by == current_user.id`), even when the same user could update or delete the other matching rows one at a time by id: a manager holding `modifyAllRecords` on the object, a row's owner who did not create it, and, for an update, the target of an `edit`-level record share. The write answered success and changed fewer rows than its predicate matched. The platform's own ownership floor (`owner_only_writes` / `owner_only_deletes` in `member_default`) was applied to the predicate write as an unconditional condition, while a write by id lets the record-sharing service's `allow` verdict replace it.

The predicate write now makes the by-id decision for each matched row: a row the floor would refuse is written when a write of that row by id would be, because the sharing service answers `allow` for it (ownership at the caller's write depth, an `edit` share for an update, or Modify All). A row the service abstains on (an object with no `owner_id`, a public object) or denies keeps the floor. The row-level `check` on each updated row follows the same decision.

What does not change:

- The rows a predicate write can reach are still only the rows its predicate matches that the caller can read, and a predicate matching more than 10,000 of them is still refused before anything is written.
- An app-authored row-level policy still binds every row, and Modify All still does not bypass row-level security on an ordinary business object.
- An `edit` share still widens update and never delete.
- The tenant wall is unchanged, and so is a write made on another user's behalf, which keeps the floor for both principals as its by-id write does.
- A `controlled_by_parent` detail keeps the floor on a predicate write; its by-id write is decided by the master gate instead, and that half is not changed here.

No action is needed. A flow, script or server-side bulk update that relied on a predicate write skipping rows the caller did not create now writes those rows too, when the caller may write them by id.
