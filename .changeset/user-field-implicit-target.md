---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(spec,objectql,metadata-protocol): a `user` field carries its target in the TYPE — bare `{type:'user'}` is not targetless

`field.zod` defines `user` as "a lookup specialized to the `sys_user` system
object … target fixed to the `sys_user` system object", and `Field.user()` —
unlike `Field.lookup(reference, …)` — takes no target argument and writes
`reference: 'sys_user'` itself. The target is a constant of the type.

Two callers read `field.reference` raw and so disagreed: the protocol's expand
gate refused `?expand=<a bare user field>` with `400 INVALID_FIELD … declares no
target object`, and objectql's expand loop skipped it. Metadata authored without
the redundant `reference` — hand-written JSON, an AI author, a Studio form — was
read as under-specified when it was complete. Live capture (cloud#983): an
AI-built app's very first screen rendered an error page over that 400.

New: `referenceTargetOf` in `@objectstack/spec/data` — the single arbiter of
"what does this reference field point at", next to `REFERENCE_VALUE_TYPES` (the
set those same two callers already share for "is this a reference at all"). Both
halves of the expand path read it, so the gate can no longer refuse a field the
engine would have expanded, nor bless one it skips.
