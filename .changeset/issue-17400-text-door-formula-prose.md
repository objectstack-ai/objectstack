---
'@objectstack/spec': patch
---

Scope the text-operator declared-type door's `formula` prose to the judgement it
actually states. The module declared that a `formula` with a readable
`returnType` is judged as the field type its return type names, but at the
door's only consumer — the engine's field-aware seam — a filter over a formula
field never arrives: the earlier materializability door refuses every one of
them with `INVALID_FIELD` 400, whatever the `returnType`. The verdict function,
its sets, the class table and every case are unchanged; only the prose now says
the formula rows are a contract answer no consumer currently reaches, and why
they are kept rather than retired.
