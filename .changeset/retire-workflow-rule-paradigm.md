---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

chore(automation): retire the `workflow_rule` authoring paradigm (ADR-0018 M5 dropped)

ADR-0019 already removed the Workflow-Rule → Flow compiler (Workflow Rules were
removed in #1398 and `workflow` was reclaimed for state machines), but the
`workflow_rule` paradigm tag survived in `ActionParadigmSchema` and on every
built-in node descriptor. There is no declarative Workflow-Rule authoring view
to feed, so the tag is now retired: `ActionParadigmSchema` keeps `['flow',
'approval']`, and the `http` / `notify` / `connector_action` descriptors (plus
the deprecated-alias fallback) advertise `['flow', 'approval']`. Approval
execution convergence is delivered by the ADR-0019 approval Flow node, not a
compiler. ADR-0018's status and migration table are updated to mark M3 shipped,
M4 framework-complete, and M5 dropped.
