---
'@objectstack/objectql': patch
---

docs(objectql): the hook-wrapper docblocks state the per-row `before*` contract (#18331)

Two docblocks in `hook-wrappers.ts` stated the RETIRED batch model in the
present tense: `pickRecordPayload`'s said a predicate (`multi: true`) bulk
update's `before*` dispatch "still fires once for the batch with no prior row",
and `pickPreviousPayload`'s "when `previous` is ABSENT" list named that same
dispatch as an absence case because "it fires ONCE for N matched rows".

Ruling #16074 / ADR-0058 Addendum II (clauses D1/D2) retired that model, and the
engine already implements the replacement: `dispatchPerRowBeforeHooks` dispatches
`before*` once per matched row on the single-record shape and binds that row's
pre-image (`previous: coerceBooleanFields(schema, row)`). So both phases of a
predicate write now merge, materialise and bind `previous` exactly as a
single-record write does; what remains unbound is any update-shaped context
whose prior row is not in hand, which is what the second docblock now says.

This is published text, not an internal comment. Measured against the shipped
`@objectstack/objectql@17.4.0` tarball: the first docblock is emitted verbatim
onto the exported `hookRecordState` declaration (`dist/util-Dw5ZTIII.d.ts:8039`,
and the matching `.d.mts`), reachable from both the `.` and `./core`
entrypoints, so every consumer's editor surfaces the retired sentence on hover.
The second docblock does NOT ship — `pickPreviousPayload` is module-private and
appears in `dist/` only as an `{@link}` reference — but it is the source a
maintainer reads, and two docblocks one screen apart stating opposite contracts
is the drift this repairs.

No behaviour change and no assertion change: prose only.

Graded `patch`: the act moves published PROSE. It adds no exported symbol, no
key and no accepted value — the accept set was widened by PR #17249 in
`@objectstack/spec`, not here — so this PR declares no clause ② (`Clause-②: no`).
