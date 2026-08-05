---
"@objectstack/lint": patch
---

fix(lint): report a `config.timeRelative` descriptor the sweep will refuse, at authoring time (#5496)

A flow start node declaring `config.timeRelative` got **zero** authoring-time
diagnostics when its descriptor could not parse. The two rules that look at the
slot each looked at something else: `lint-flow-patterns` decides "this is a
time-relative flow" from `timeRelative != null` alone (never the shape), and
`validate-flow-trigger-readiness`'s existing check reads only
`timeRelative.object`, to compare it against the stack's objects. So

```ts
config: { timeRelative: { object: 'task', field: 'due_at', offsetDays: -1 } }
```

— three separate schema violations: `dateField` missing, `offsetDays` declared
as an int **array** and written as a scalar, and `field` an unrecognized key —
passed `os validate` silently. `TimeRelativeTriggerSchema` does reject it, but
the only place that schema ran was **bind time**, inside
`TimeRelativeTriggerPlugin.start()`, which warns and returns: the sweep is never
installed, the flow reports itself armed, and the author's sole feedback is one
line in a server log. For an AI author that line is outside the feedback loop
entirely; `os validate` is what it reads.

**New rule — `flow-time-relative-descriptor-invalid` (warning).** A start node
whose `config.timeRelative` is present runs that same schema at authoring time,
and a failure is reported naming `config.timeRelative` with the schema's own
issue list forwarded — so the diagnostic carries the missing key, the wrong type,
and, for an unrecognized key, the "did you mean" the schema already computes
(`field` → `dateField`) plus its wrong-layer guidance (a `schedule` written
*inside* the descriptor is told it belongs beside it). The list is rendered
exactly as the bind-time warning renders it, so the two channels tell one story.

Nothing is shifted except **when** the schema runs. No shape knowledge is
re-implemented in the rule and no consumer-side tolerance is added: the verdict
and every word of its wording remain `TimeRelativeTriggerSchema`'s, so the rule
tracks the descriptor's contract as it evolves instead of drifting from a second
copy of it.

The rule and the existing object-name check decide different facts and cannot
report the same one twice — only the stack knows whether an object name exists,
and only the schema knows the descriptor's shape. A descriptor wrong in both ways
gets both findings, at their own paths. Canonical descriptors are unaffected:
every one shipped in the repo (the showcase `Task Due Reminder`, the
`content/docs` examples) parses, so this adds no diagnostic to existing apps.
