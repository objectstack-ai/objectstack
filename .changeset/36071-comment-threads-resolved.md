---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): a comment thread can be marked resolved and reopened

Clause-②: yes (widening)
Metadata-protocol: none

`sys_comment` gains three columns on the top-level comment of a thread: `is_resolved` (boolean, default `false`), `resolved_by` (the user who resolved it) and `resolved_at` (when). A thread is a top-level comment together with its replies.

- **Resolve and reopen** by updating `is_resolved` on the top-level comment through the data API, or through the resolution door (`PUT /api/v1/comments/:id/resolution`, added in the same release). An update that names `is_resolved` on a reply is refused, `VALIDATION_ERROR` / 400.
- **Who may.** Anyone who may comment on the record (who can read it) may resolve and reopen its threads (maintainer ruling record 7063285032, option A). On the data API, an update that changes nothing but `is_resolved` is admitted without the author-or-record-editor rule, but the platform's row floor (`owner_only_writes`) runs first and admits a rank-and-file member's update of the rows they created alone: through the data API such a member resolves only the threads they started, and an administrator resolves any. The resolution door admits everyone who can read the thread, members included, and writes `is_resolved` alone. Any other change to a comment still needs its author or an editor of the record, and the floor. A caller who cannot read the record gets the not-visible refusal, on a reply too.
- **Platform-written.** `resolved_by` and `resolved_at` are stamped by the platform when `is_resolved` turns `true` and cleared when it turns `false`; both are read-only, so a client's value is replaced by the stamp or dropped and reported in `droppedFields`. A new comment is always unresolved.
- **A reply reopens.** A reply posted into a resolved thread sets the thread back to unresolved.
- **Reading.** Unresolved threads of one record: `object_name = OBJECT`, `record_id = ID`, `parent_id = null`, `is_resolved: { $ne: true }`; count the same filter for the record's unresolved-thread count.
- **Stored rows** need no migration: the SQL column default is `false`, and `$ne: true` also matches a row that carries no value.

Resolving or reopening writes no entry on the record's activity tab; the comment's own write is recorded in the audit ledger as every comment write is.
