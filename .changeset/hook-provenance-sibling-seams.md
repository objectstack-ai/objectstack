---
"@objectstack/objectql": patch
---

fix(objectql): decide the insert-side runtime-owned strip by hook-write PROVENANCE, not `Object.is` (#14259)

#14088 replaced `Object.is(payload[k], supplied[k])` inside `stripReadonlyFields`
with a recording of the keys the before-phase hook chain actually assigned
(`recordHookPayloadWrites`). Its argument was never about `null`: value equality
cannot separate *the hook deliberately wrote the value the caller also sent* from
*the hook never touched the key*, and those two demand opposite verdicts.

`stripRuntimeOwnedFields` — the INSERT-side twin — was left on the comparison
that argument retired, and #6339's own prose is the finding: it argued a key SET
made the contract true "only BY ACCIDENT" and moved to values, which is
accidental in the identical way. A `beforeInsert` hook that re-issues or
normalises a record number therefore still lost its write to any caller that
submitted the same value — the caller who omitted the key kept the hook's number,
the caller who echoed it got the sequence value, and the two differed in nothing
else.

`engine.insert` now arms one recording **per row** at hook-context construction
and seals each immediately after that row's `beforeInsert` chain, and
`stripRuntimeOwnedFields` consults the sealed record before the value test. Per
row, never per call, so a hook stamping one row of a batch confers nothing on the
next.

⛔ **Not a relaxation of #5503, and the accept set for callers does not move.** A
caller-seeded record number that no hook assigned is still stripped, still warns
with the same text, and still reports through `onFieldsDropped` /
`strictReadonlyWrites`; `isSystem` and `preserveAudit` are untouched. What
changed is only the EVIDENCE for the hook-write exemption that already existed —
a record of which keys were assigned, instead of an inference from the values
afterwards.

The forgery boundary is inherited verbatim: a caller-supplied value must never
become hook-owned. The new insert-side recording is armed after the caller's
payload has arrived and been snapshotted, sealed before any engine-owned pass
touches the row, and records that an assignment ran rather than anything about
the payload's contents — a caller cannot execute an assignment, so no key it
sends can enter the record. A hook that REPLACES the payload object leaves no
attributable record and falls back to the pre-existing value test, which
over-strips: keeping the old bug is the only safe direction, because reading a
replacement's keys as hook-owned would launder a caller's forgery.

The `readonlyWhen` sibling seam #14259 also names (`isCallerSuppliedValue`,
behind `stripReadonlyWhenFields` / `stripReadonlyWhenFieldsMulti`) is **not**
included: threading the record there was measured to let a caller's value survive
a TRUE `readonlyWhen` predicate, which is a maintainer decision rather than a
mechanical follow-through. Nothing about that seam's behaviour changes here.
