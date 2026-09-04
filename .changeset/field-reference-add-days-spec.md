---
"@objectstack/spec": minor
---

feat(spec): `FieldReferenceSchema` gains `addDays` — a whole-day offset on a field reference

A dataset measure could not express "completed by its deadline, where the deadline is a
stored date plus a grace period held in another column" (`completed_at <= due_date +
duty.grace_days`): the filter grammar had no date arithmetic, and the `{N_days_ago}` macros
are anchored to now, never to a column.

`{ $field: 'other_column' }` now accepts `addDays`: an integer literal of any sign (a
negative value subtracts — there is no `subDays`, and whole days are the only unit) or a
nested `{ $field }` reference to a numeric column (dot-path allowed, exactly as `$field`
allows it). The reference stays legal exactly where it is today — the whole comparand of a
scalar comparison operator — and list positions keep their refusal. Anything else in the
slot (a fractional number, a string, an object without `$field`) is refused at the schema
door with a message naming the working spelling, repeated at the operator slot.

The NULL semantics are stated in the schema description and pinned on both execution
paths: a NULL offset column contributes zero days; a NULL referenced column makes the
comparison false (never NULL) for every operator, so `$not` re-admits the row.

The "Execution support" docblock on `FieldReferenceSchema` is rewritten to the landed state:
SQL push-down has compiled `$field` to a column-to-column comparison since 17.x
(`driver-sql`, `driver-sqlite-wasm`), and the offset rides the same arm.
