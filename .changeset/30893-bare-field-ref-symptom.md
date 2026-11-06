---
'@objectstack/skills': patch
---

docs(skills): three skills describe a bare field ref in a predicate as the fault it is today, not a silent `null`

Clause-②: no
Metadata-protocol: none

`objectstack-platform/references/operations.md`, `objectstack-data` and `objectstack-ui` said a bare field ref (`done` instead of `record.done`) "evaluates to `null`" and silently hides or never fires. It faults. On the server an `error` validation rule, a `requiredWhen` and an option `visibleWhen` refuse the write and name the rule, a `readonlyWhen` holds its field locked, and a formula reads `null` with a logged warning. In the console an action's `visible` hides it, its `disabled` greys it out, and a field `visibleWhen` shows the field, each with a console warning. The data skill no longer lists RLS / sharing predicates here: their compiler reads a bare name as the column. The prevention advice (`os validate` / `os build`, `record.<field>`) is unchanged. Growth is paid by same-file deletions of restated prose.
