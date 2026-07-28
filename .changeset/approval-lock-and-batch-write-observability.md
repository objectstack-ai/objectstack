---
"@objectstack/plugin-approvals": minor
"@objectstack/spec": minor
"@objectstack/rest": minor
---

fix(approvals,rest): tell the truth about what a write did — `locks_record` on the request, `droppedFields` on the cross-object batch (#3794)

Two halves of the same complaint: in an approval flow the platform reported
record writability wrong in *both* directions — what you could change said
"locked", and what you couldn't said "updated successfully".

**`locks_record` on the approval request.** The lock hook reads one thing to
decide whether a pending approval blocks writes: the node config snapshot's
`lockRecord` (`=== false` ⇒ the update goes through). Nothing exposed that, so a
client had only "a pending request exists" and had to guess — and the Console
guessed "locked", every time. A `lockRecord: false` node exists precisely so the
approver can amend the record while deciding on it; painting "Locked for
approval" over that hides the whole feature, and approvers never try. Request
rows (`getRequest` / `listRequests`, and therefore `GET /api/v1/approvals/requests`)
now carry `locks_record`, read from the same snapshot the hook reads, with the
same default-true. Absent on rows from an older server ⇒ assume locked.

**`droppedFields` on `POST /batch`.** The engine strips writes to `readonly`
(#2948) and `readonlyWhen`-locked (#3042) fields and completes the write without
them. Every write path already reported which fields it dropped (#3431/#3455) —
except the cross-object transactional batch, which never wired
`onFieldsDropped` at all. That path is the Console record form's save for a
master-detail record, so it is exactly where a *user* edits a `readonlyWhen`
field: they changed it, the form said "updated successfully", the value never
moved, and nothing anywhere said so. The response now carries a top-level
`droppedFields` list, each event tagged with the `index` of the operation that
produced it (`results` entries are bare record echoes with no envelope to hang a
per-row list on). Omitted entirely when nothing was dropped, so the shape stays
backward-compatible; the batch still commits either way — a strip is legal
semantics, not an error.

The Console half of both fixes ships in objectui: the detail band now
distinguishes "in approval (editable)" from "locked for approval", and the
write-warning toast fires on batch saves.
