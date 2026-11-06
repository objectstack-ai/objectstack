---
'@objectstack/skills': patch
---

docs(skills): three skills describe a bare field ref in a predicate as the fault it is today, not a silent `null`

Clause-②: no
Metadata-protocol: none

`objectstack-platform/references/operations.md`, `objectstack-data` and `objectstack-ui` said a bare field ref (`done` instead of `record.done`) "evaluates to `null`" and silently hides or never fires. It faults. On the server an `error` validation rule and a `requiredWhen` refuse the write and name the rule, an option `visibleWhen` refuses only a write that picks that option (forms still offer it), a `readonlyWhen` field stays editable on the form while the server drops the change with a warning and the save succeeds, and a formula reads `null` with a logged warning. In the console an action's `visible` hides it, its `disabled` greys it out, and a field `visibleWhen` shows the field, each with a console warning. The data skill no longer lists RLS / sharing predicates here: their compiler reads a bare name as the column. The prevention advice (`os validate` / `os build`, `record.<field>`) is unchanged. Growth is paid by same-file deletions of restated prose.
