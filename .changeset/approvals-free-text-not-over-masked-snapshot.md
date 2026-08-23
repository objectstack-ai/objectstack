---
"@objectstack/plugin-approvals": patch
---

**Deliberate search-semantics change.** `ApprovalService.listRequests` /
`countRequests` no longer push a free-text predicate onto the payload snapshot
column for a caller whose view of that snapshot is masked (#11040).

Since #10749 the approval snapshot (`sys_approval_request.payload_json`, the
submitted record's row) is redacted **at serve time, per reader**: each row is
cut down to the fields that caller may read on that row's subject object. The
full row deliberately stays at rest, so the approval record remains audit
evidence of what was actually submitted.

The free-text filter, however, is evaluated by the driver against the stored
column — before anything is served, and therefore against the unmasked bytes. A
predicate over that column is a question about its contents whose answer is row
membership, so the field-level read controls #10749 enforces on the way out did
not hold on the way in. That is `declared ≠ enforced`, and the platform has
already settled the governing principle for it: under `maskingRule` (#8993) a
field a caller sees masked is non-filterable, refused loudly, because otherwise
equality probes reconstruct the hidden span. This extends that settled posture
to the snapshot column, which is reached through a different door.

**What changes.** For a caller whose view of the snapshot is masked, free-text
search matches on `process_name`, `object_name`, `record_id` and `submitter_id`
— the columns of `sys_approval_request` itself, which anyone who can see the row
reads whole — and no longer on snapshot contents. Such a caller can still find a
request by process, object, record id or submitter; they can no longer find one
by a value they may not read. Rows returned, their order and pagination are
otherwise untouched, and no query is refused: the change only ever removes one
disjunct, never denies.

**What does not change.** A caller the serve path hands the whole snapshot to
keeps today's behaviour exactly — same rows, same order. That includes every
deployment that has not wired a field-visibility authority (the seam is
late-bound, and absent it snapshots are served unredacted), and the case where a
wired authority declines to narrow. Consistency with the serve path is the rule
here rather than blanket fail-closed: where serve hands over the whole snapshot,
keeping the predicate discloses nothing serve does not already disclose.

The masked/unmasked verdict is read from **the same authority and the same
per-caller call the serve path uses**, asked as the caller. It is deliberately
not a second, independently derived notion of "redacted" — two derivations drift,
and the drift between a serve rule and a filter rule is exactly what this fixes.

Because redaction is decided per row while a filter is built before any row
exists, the predicate-time scope matters: with an `object` filter the subject
object is known and the seam is asked about it directly; without one the query
spans every object, nothing sound can be asked, and the disjunct is dropped.

Held by `approval-free-text-scope.test.ts`.
