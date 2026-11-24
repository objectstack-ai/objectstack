---
'@objectstack/objectql': minor
---

fix(objectql): an update whose every caller-supplied field is dropped (read-only, or locked by `readonlyWhen`) is a no-op, so the record no longer shows a last-modified edit that changed nothing and `afterUpdate` automation no longer fires for it

Clause-②: no
Metadata-protocol: semantic

An update could send only fields the engine refuses to store: a `readonly` field, or one a TRUE `readonlyWhen` locks for that record. The engine dropped them, reported them in `droppedFields`, and then still wrote the row: `updated_at` and `updated_by` were stamped, and every `afterUpdate` hook ran, so "on update" flows and triggers treated it as a real edit.

Now such an update writes nothing, on a single-record update and on a `multi: true` predicate update alike:

- no driver write, so `updated_at` / `updated_by` keep their stored values;
- `afterUpdate` does not run, no roll-up recomputes and no record-changed event is published;
- a single-record update answers the current record, and a predicate update answers `0` rows written;
- the dropped fields are still reported exactly as before (`onFieldsDropped`, and the REST `droppedFields` answer).

`beforeUpdate` still runs, as it must before the engine can know what is left. When at least one field survives (a caller field, or a field a `beforeUpdate` hook wrote), the update takes the unchanged path. An update whose fields are all kept but equal to the stored values is unchanged. `strictReadonlyWrites` still refuses a dropped field before anything is written.

What to check in an app: an `afterUpdate` hook or record-change trigger that relied on firing for an update made only of read-only or locked fields no longer runs for it. Send a writable field in that update if the automation must run.
