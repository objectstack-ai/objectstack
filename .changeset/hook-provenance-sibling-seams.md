---
"@objectstack/objectql": patch
---

fix(objectql): decide the `readonlyWhen` and insert-side runtime-owned strips by hook-write PROVENANCE, not `Object.is` (#14259)

#14088 replaced `Object.is(payload[k], supplied[k])` inside `stripReadonlyFields`
with a recording of the keys the before-phase hook chain actually assigned
(`recordHookPayloadWrites`). Its argument was never about `null`: value equality
cannot separate *the hook deliberately wrote the value the caller also sent* from
*the hook never touched the key*, and those two demand opposite verdicts. Two
sibling seams in the same file were left on the comparison that argument retired,
and both are repaired here off the same instrument:

- **`readonlyWhen`, update path.** `isCallerSuppliedValue` — the shared predicate
  behind `stripReadonlyWhenFields` and `stripReadonlyWhenFieldsMulti` — now
  consults the sealed record before the value test. A `beforeUpdate` hook that
  derives a `readonlyWhen`-locked field lost its write to any caller that echoed
  the same value back: the #9107 defect, surviving on the one input #9107's fix
  cannot see. The engine threads the record already sealed at its post-hook
  confluence into both call sites, so the by-id and bulk branches read one fact.
- **Runtime-owned fields, insert path.** `stripRuntimeOwnedFields` gains the same
  optional `hookWrittenKeys`, and `engine.insert` now arms one recording **per
  row** at hook-context construction and seals each immediately after that row's
  `beforeInsert` chain. A `beforeInsert` hook that re-issues or normalises a
  record number lost its write to any caller that submitted the same value —
  #6339's own argument against the key SET, applied to the values that replaced
  it.

⛔ **Not a relaxation, and the accept set for callers does not move.** A
caller-supplied value that no hook assigned is still stripped, still warns with
the same text, and still reports through `onFieldsDropped` /
`strictReadonlyWrites`. `isSystem` remains NOT an exemption on the `readonlyWhen`
seam, so #4889's frozen paid-invoice lock is untouched. What changed is only the
EVIDENCE for the hook-write exemption that already existed — a record of which
keys were assigned, instead of an inference from the values afterwards.

The forgery boundary is inherited verbatim: a caller-supplied value must never
become hook-owned. The new insert-side recording is armed after the caller's
payload has arrived and been snapshotted, sealed before any engine-owned pass
touches the row, and records that an assignment ran rather than anything about
the payload's contents — a caller cannot execute an assignment, so no key it
sends can enter the record. Per row, never per call, so a hook stamping one row
of a batch confers nothing on the next. A hook that REPLACES the payload object
leaves no attributable record and falls back to the pre-existing value test,
which over-strips: keeping the old bug is the only safe direction, because
reading a replacement's keys as hook-owned would launder a caller's forgery.
