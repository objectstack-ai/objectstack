---
'@objectstack/core': patch
---

fix(core)!: the offboarding hand-over no longer moves the owner of a `controlled_by_parent` detail record

Clause-②: yes (narrowing) — narrowed: `GET /api/v1/security/users/USER_ID/assigned-work` no longer lists the `owner_id` of an object whose `sharingModel` is `controlled_by_parent`, and `POST /api/v1/security/users/USER_ID/assigned-work/transfer` no longer moves it, with or without `objects` naming the detail. `userAssignedWorkFields` of `@objectstack/core` leaves that field out of its roster.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is which records the hand-over counts and moves. A detail record's owner stays where it was; an administrator who wants a different owner on one edits that record. -->

**BREAKING** for an administrator handing a banned user's work to someone else. A detail object's access follows its master record (ADR-0055), so its owner records who did the work — the person on a timesheet, the spender on an expense line, the voter on a vote — not who holds it. The hand-over used to move it with everything else, so the successor appeared to have logged the leaver's hours and spent the leaver's money, and approvals and reports read wrong. Those owners now stay where they are, are not counted in the assigned-work answer, and are not part of `remaining`.

Unchanged: the detail's own user fields (an approver, an assignee) are still counted and moved, and the owner of every object whose `sharingModel` is `private`, `public_read`, `public_read_write` or unset is still counted and moved. Hand over the master record to give the successor the detail records' access.
