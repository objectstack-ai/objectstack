---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

fix(rest): report `droppedFields` from the cross-object batch, so a silent strip stops reading as a clean save (#3794)

The engine strips writes to `readonly` (#2948) and `readonlyWhen`-locked (#3042)
fields and completes the write without them. Every write path already reported
which fields it dropped (#3431/#3455) — except the cross-object transactional
batch, which never wired `onFieldsDropped` at all.

That path is the Console record form's save for a master-detail record, so it is
exactly where a *user* edits a `readonlyWhen` field: they changed it, the form
said "updated successfully", the value never moved, and nothing anywhere said
so.

`POST /batch` responses now carry a top-level `droppedFields` list, each event
tagged with the `index` of the operation that produced it (`results` entries are
bare record echoes, with no envelope to hang a per-row list on). Omitted
entirely when nothing was dropped, so the shape stays backward-compatible; the
batch still commits either way — a strip is legal semantics, not an error.

The Console half ships in objectui: the write-warning toast now fires on batch
saves too.
