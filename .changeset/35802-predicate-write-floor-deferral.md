---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a predicate update or delete now writes the rows a Modify All holder, a non-creator owner or an edit-share target can write by id, instead of stopping at the platform's creator-only floor

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is which rows one predicate update or delete by an organization member writes, and whether such an update is refused whole: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a predicate update (`update(object, data, { where, multi: true })`) by an organization member, on an object where record sharing enforces writes, whose predicate matches a row the member did not create but may write by id (Modify All, ownership at the member's write depth, an `edit` share or the row's queue), when that row fails a row-level `check`, a validation rule or a hook. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): no schema, key or stored value moves, so `Metadata-protocol` is `none`.

- FROM: the update matched only the rows the member created. It answered success and wrote those, and the other row was never judged.
- TO: that row is matched and judged too, and the update applies to all of its matched rows or to none. It is refused whole with `PERMISSION_DENIED` / 403 and writes nothing. A validation rule or hook that refuses that row refuses the whole update the same way, and a `readonlyWhen` lock on that row strips the field from the whole write. A write of that row by id is refused the same way, alone.

The fix for a caller: write those rows by id to get an outcome per row, or narrow the predicate to the rows that pass the check.

A predicate write (`update(object, data, { where, multi: true })`, `delete(object, { where, multi: true })`) by an organization member held the platform's own ownership floor (`owner_only_writes` / `owner_only_deletes` in `member_default`, `created_by == current_user.id`) as an unconditional condition, where record sharing enforces writes. Unless an app-authored write policy admitted a row, the write matched only the rows that member had created, even when the same user could update or delete the other matching rows one at a time by id. This affected a manager holding `modifyAllRecords` on the object, a row's owner who did not create it, and, for an update, the target of an `edit`-level record share or a member of the queue a row sits in. The write answered success and changed fewer rows than its predicate matched. A write by id lets the record-sharing service's `allow` verdict replace the floor.

The predicate write now makes the by-id decision for each matched row the floor would refuse. Such a row is written when a write of that row by id would be, because the sharing service answers `allow` for it: ownership at the caller's write depth, Modify All, or, for an update only, an `edit` share or the row's queue. A row the service abstains on (an object with no `owner_id`, a public object) or denies keeps the floor. The row-level `check` on each updated row follows the same decision.

The by-id decision costs one sharing verdict, a few store reads, for each matched row the floor does not already admit. Measured on SQLite in memory:

- A member's predicate update matching 1,000 readable rows owned by other people, every verdict `deny`: 1,000 verdicts and 2,004 store reads, about 1.1 s, against 44 ms and 3 reads before.
- The same at 10,000 rows: 10,000 verdicts and 20,004 store reads, about 5.3 s, against 47 ms before.
- A Modify All holder at 10,000 rows: 10,000 verdicts and 10,003 store reads, about 1.8 s, and it now writes the 10,000 rows. Before, it took 47 ms and wrote none of them.
- Where an app-authored `using` policy for the write applies to the caller: 0 verdicts, because a row the floor refuses fails that policy too (10,000 matched rows the floor refuses, 45 ms).

What does not change:

- The rows a predicate write can reach are still only the rows its predicate matches that the caller can read. A predicate matching more than 10,000 of them is still refused before anything is written.
- The sharing service's own bulk write scope still bounds a predicate write: the owner set at the caller's depth, plus the edit shares (at most 5,000 of them) and the queue on an update. A row that only a read share and an app `update` policy together make writable is still written by id alone.
- An app-authored row-level policy still binds every row, and Modify All still does not bypass row-level security on an ordinary business object.
- An `edit` share still widens update and never delete.
- The tenant wall is unchanged.
- A write made on another user's behalf keeps the floor for both principals, as its by-id write does.
- A `controlled_by_parent` detail keeps the floor on a predicate write. Its by-id write is decided by the master gate instead, and that half is not changed here.

A flow, script or server-side bulk update that relied on a predicate write skipping the rows its caller did not create now writes those rows too, when the caller may write them by id, and is refused whole when one of them fails a check. The fix is the one above.
